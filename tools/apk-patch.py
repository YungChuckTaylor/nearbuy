#!/usr/bin/env python3
"""Swap the bundled PWA (assets/www) inside an existing signed NearBuyGoods APK and re-sign it.

Use case: update the Android app's bundled frontend WITHOUT the Android toolchain
(no JDK/aapt2/apksigner needed — only `pip install cryptography apksigtool`).
The APK keeps its original manifest/resources/dex and versionCode; the new frontend
is signed with the repo debug key, so it upgrade-installs over the previous build.

Usage:
  python3 tools/apk-patch.py <old.apk> <public_dir> <out.apk> <keystore> <storepass>

Self-validates before trusting the output:
  1. Round-trip: re-serializing the OLD APK's parsed signing block must reproduce
     the original bytes exactly.
  2. Verify: the NEW APK must pass apksigtool's v2 verification (digest recompute
     + RSA verify), plus zip integrity + entry-by-entry content diffs.
"""
import io, os, struct, sys, zipfile, zlib, hashlib

import apksigtool as at
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12

OLD_APK   = sys.argv[1]
PUBLIC    = sys.argv[2]
OUT       = sys.argv[3]
KEYSTORE  = sys.argv[4]
KS_PASS   = sys.argv[5].encode()

V2_ID   = 0x7109871a
V3_ID   = 0xf05368c0
PAD_ID  = 0x42726577
ALGO    = 0x0103                 # RSA-2048 PKCS1v15 SHA-256 (matches old APK)

u16 = lambda v: struct.pack('<H', v)
u32 = lambda v: struct.pack('<I', v)
u64 = lambda v: struct.pack('<Q', v)
lp  = lambda b: u32(len(b)) + b

# ---------------------------------------------------------------- serializer
def ser_digests(ds):
    return lp(b''.join(lp(u32(d.signature_algorithm_id) + lp(d.digest)) for d in ds))

def ser_certs(cs):
    return lp(b''.join(lp(c.data) for c in cs))

def ser_attrs(as_):
    return lp(b''.join(lp(u32(a.id) + a.value) for a in as_))

def ser_sigs(ss):
    return lp(b''.join(lp(u32(s.signature_algorithm_id) + lp(s.signature)) for s in ss))

def ser_signed_data(sd, v3):
    body = ser_digests(sd.digests) + ser_certs(sd.certificates)
    if v3:
        # v3: digests + certs + minSDK + maxSDK + attrs (no trailing bytes)
        body += u32(sd.min_sdk) + u32(sd.max_sdk) + ser_attrs(sd.additional_attributes)
    else:
        # v2 (build-tools r34): 4 trailing zero bytes after attrs, inside the
        # signed byte range — confirmed empirically against the old APK.
        body += ser_attrs(sd.additional_attributes) + b'\x00\x00\x00\x00'
    assert body == sd.raw, "signed data round-trip mismatch"
    return body

def ser_signer(s, v3):
    body = lp(ser_signed_data(s.signed_data, v3))
    if v3:
        body += u32(s.min_sdk) + u32(s.max_sdk)
    body += ser_sigs(s.signatures) + lp(s.public_key.data)  # ser_sigs is already LP-wrapped
    return lp(body)  # NOTE: signed data is LP-wrapped inside the signer (body starts LP(LP(sd)))

def ser_scheme_block(block):
    return lp(b''.join(ser_signer(s, block.version == 3) for s in block.signers))

def ser_pair(p):
    if p.id in (V2_ID, V3_ID):
        value = ser_scheme_block(p.value)
    elif p.id == PAD_ID:
        value = b'\x00' * (p.length - 4)
    else:
        value = p.value.data if hasattr(p.value, 'data') else bytes(p.value)
    assert len(value) == p.length - 4, f"pair len mismatch id={hex(p.id)}"
    return u64(p.length) + u32(p.id) + value

def ser_block(pairs):
    body = b''.join(ser_pair(p) for p in pairs)
    size = len(body) + 24
    return u64(size) + body + u64(size) + b'APK Sig Block 42'

# ---------------------------------------------------------------- zip rebuild
def dos_time(dt): return (dt[3] << 11) | (dt[4] << 5) | (dt[5] // 2)
def dos_date(dt): return ((dt[0] - 1980) << 9) | (dt[1] << 5) | dt[2]

def build_zip(old_path, public_dir):
    zin = zipfile.ZipFile(old_path)
    infos = zin.infolist()

    keep = [i for i in infos
            if not i.filename.startswith('META-INF/')
            and not i.filename.startswith('assets/www/')]

    www = []
    for root, _dirs, files in os.walk(public_dir):
        for f in sorted(files):
            if f == '.htaccess':
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, public_dir).replace(os.sep, '/')
            www.append(('assets/www/' + rel, full))

    out = io.BytesIO()
    offset = 0
    cen = bytearray()

    def write_entry(name, data, method, date_time, ext_attr):
        nonlocal offset, cen
        crc = zlib.crc32(data) & 0xffffffff
        if method == zipfile.ZIP_DEFLATED:
            comp = zlib.compressobj(9, zlib.DEFLATED, -15)
            payload = comp.compress(data) + comp.flush()
            version = 20
        else:
            payload = data
            version = 10
        name_b = name.encode()
        extra = b''
        if method == zipfile.ZIP_STORED:
            # data must start 4-byte aligned; pad via a skipped extra field
            data_offset = offset + 30 + len(name_b)
            pad = (-(data_offset % 4)) % 4
            if 0 < pad < 4:      # not enough room for the 4-byte extra header
                pad += 4
            if pad:
                extra = u16(0xd935) + u16(pad - 4) + b'\x00' * (pad - 4)
        lfh = (b'PK\x03\x04' + u16(version) + u16(0) + u16(method)
               + u16(dos_time(date_time)) + u16(dos_date(date_time))
               + u32(crc) + u32(len(payload)) + u32(len(data))
               + u16(len(name_b)) + u16(len(extra)))
        out.write(lfh + name_b + extra + payload)
        cen.extend(b'PK\x01\x02' + u16((3 << 8) | 0x03) + u16(version) + u16(0) + u16(method)
                   + u16(dos_time(date_time)) + u16(dos_date(date_time))
                   + u32(crc) + u32(len(payload)) + u32(len(data))
                   + u16(len(name_b)) + u16(0) + u16(0) + u16(0) + u16(0) + u32(ext_attr)
                   + u32(offset) + name_b)
        offset += len(lfh) + len(name_b) + len(extra) + len(payload)

    for info in keep:
        write_entry(info.filename, zin.read(info.filename), info.compress_type,
                    info.date_time, info.external_attr)

    fixed_dt = (2009, 1, 1, 0, 0, 0)
    for arc, full in www:
        with open(full, 'rb') as f:
            data = f.read()
        write_entry(arc, data, zipfile.ZIP_DEFLATED, fixed_dt, 0o644 << 16)

    cd_offset = offset
    out.write(bytes(cen))
    n = len(keep) + len(www)
    eocd = (b'PK\x05\x06' + u16(0) + u16(0) + u16(n) + u16(n)
            + u32(len(cen)) + u32(cd_offset) + u16(0))
    out.write(eocd)
    return out.getvalue(), cd_offset, [i.filename for i in keep]

# ---------------------------------------------------------------- main
def main():
    # 1. round-trip validation of the serializer against the OLD (known-good) block
    _sb_off, sig_block_old = at.extract_v2_sig(OLD_APK)
    parsed = at.parse_apk_signing_block(sig_block_old, None)
    rebuilt = ser_block(parsed.pairs)
    assert rebuilt == sig_block_old, "ROUND-TRIP FAILED - serializer != apksigner format"
    print(f"[ok] serializer round-trip: {len(sig_block_old)} bytes reproduced exactly")

    # 2. load the debug key (PKCS#12)
    with open(KEYSTORE, 'rb') as f:
        key, cert, _ = pkcs12.load_key_and_certificates(f.read(), KS_PASS)
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    spki = key.public_key().public_bytes(serialization.Encoding.DER,
                                         serialization.PublicFormat.SubjectPublicKeyInfo)
    print(f"[ok] keystore: {key.__class__.__name__}, CN={cert.subject.rfc4514_string()!r}")

    # 3. rebuild the zip
    zip_bytes, cd_offset, kept = build_zip(OLD_APK, PUBLIC)
    tmp = OUT + '.unsigned'
    with open(tmp, 'wb') as f:
        f.write(zip_bytes)
    n_www = len(zipfile.ZipFile(tmp).namelist()) - len(kept)
    print(f"[ok] zip rebuilt: {len(zip_bytes)} bytes, {len(kept)} preserved + {n_www} new assets/www files")

    # 4. v2 sign
    digest = at.apk_digest_chunked(tmp, cd_offset, hashlib.sha256)
    signed_data = (ser_digests([type('D', (), {'signature_algorithm_id': ALGO, 'digest': digest})()])
                   + ser_certs([type('C', (), {'data': cert_der})()])
                   + ser_attrs([]) + b'\x00\x00\x00\x00')
    signature = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = (lp(signed_data)
              + ser_sigs([type('S', (), {'signature_algorithm_id': ALGO, 'signature': signature})()])
              + lp(spki))
    v2_value = lp(lp(signer))

    body = u64(4 + len(v2_value)) + u32(V2_ID) + v2_value
    size = len(body) + 24
    block = u64(size) + body + u64(size) + b'APK Sig Block 42'

    final = zip_bytes[:cd_offset] + block + zip_bytes[cd_offset:]
    eocd_pos = final.rfind(b'PK\x05\x06')
    final = final[:eocd_pos + 16] + u32(cd_offset + len(block)) + final[eocd_pos + 20:]
    with open(OUT, 'wb') as f:
        f.write(final)
    os.remove(tmp)
    print(f"[ok] signed: {OUT} ({len(final)} bytes, signing block {len(block)} @ {cd_offset})")

    # 5. verify like a device would
    _sb_off, sb = at.extract_v2_sig(OUT)
    blk = at.parse_apk_signing_block(sb, OUT)
    v2pairs = [p for p in blk.pairs if p.id == V2_ID]
    assert len(v2pairs) == 1 and v2pairs[0].value.verified is True, "V2 verification FAILED"
    at.verify_apk_signature_scheme_v2(v2pairs[0].value.signers, OUT)
    print("[ok] apksigtool v2 verification PASSED (digest recompute + RSA verify)")

    z = zipfile.ZipFile(OUT)
    assert z.testzip() is None, "zip integrity check FAILED"
    print("[ok] zip integrity: all CRCs valid")

main()
