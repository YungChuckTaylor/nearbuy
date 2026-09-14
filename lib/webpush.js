/**
 * Zero-dependency Web Push (RFC 8030 + 8291 aes128gcm + 8292 VAPID).
 * Keys persist in data/vapid.json; payloads encrypted per subscription.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, '..', 'data', 'vapid.json');
const SUBJECT = 'mailto:push@nearbuygoods.app';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

function loadOrCreateKeys() {
  if (keys) return keys;
  // On serverless (Vercel) the filesystem is ephemeral/read-only: generate in
  // memory; server.js persists the keys inside the KV state blob instead.
  const serverless = !!process.env.VERCEL;
  if (!serverless && fs.existsSync(KEY_FILE)) { keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); return keys; }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwkPub = publicKey.export({ format: 'jwk' });
  const jwkPriv = privateKey.export({ format: 'jwk' });
  keys = { crv: 'P-256', x: jwkPub.x, y: jwkPub.y, d: jwkPriv.d };
  if (!serverless) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
  }
  return keys;
}
let keys = null;
loadOrCreateKeys();
/** Serverless only: restore the VAPID keys stored in the KV state blob. */
export function setKeys(k) { if (k && k.d) keys = k; }
export function getKeys() { return keys; }

const privateKeyObject = () => crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', ...keys } });
export function vapidPublicKeyB64u() {
  return b64u(rawPublic());
}
function rawPublic() {
  return Buffer.concat([Buffer.from([4]), pad32(fromB64u(keys.x)), pad32(fromB64u(keys.y))]);
}
const pad32 = (b) => (b.length === 32 ? b : Buffer.concat([Buffer.alloc(32 - b.length), b]));

function derToRaw(der) {
  // DER SEQUENCE INTEGER r INTEGER s → 64-byte r||s
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const readInt = () => {
    if (der[i] !== 0x02) throw new Error('bad der');
    const len = der[i + 1];
    let s = der.subarray(i + 2, i + 2 + len);
    i += 2 + len;
    if (s.length > 32) s = s.subarray(s.length - 32);
    return Buffer.concat([Buffer.alloc(32 - s.length), s]);
  };
  return Buffer.concat([readInt(), readInt()]);
}

export function vapidJwt(audience) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const data = `${head}.${body}`;
  const sig = derToRaw(crypto.createSign('SHA256').update(data).sign(privateKeyObject()));
  return `${data}.${b64u(sig)}`;
}

const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/** Encrypt a JSON payload for one subscription (aes128gcm, RFC 8291). */
export function encryptPayload(payloadJson, subKeys) {
  const clientPub = fromB64u(subKeys.p256dh);
  const authSecret = fromB64u(subKeys.auth);
  const salt = crypto.randomBytes(16);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, serverPub]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const plaintext = Buffer.concat([Buffer.from(payloadJson), Buffer.from([2])]); // final-record delimiter
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  const body = Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, ct]);
  return body;
}

/** Deliver one push; returns {ok, status}. Caller should drop subs on 404/410. */
export async function sendPush(subscription, payloadObj) {
  const body = encryptPayload(JSON.stringify(payloadObj), subscription.keys);
  const aud = new URL(subscription.endpoint).origin;
  const jwt = vapidJwt(aud);
  const pub = b64u(rawPublic());
  const headers = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: '86400',
    Urgency: 'high',
    'Content-Length': String(body.length),
  };
  const attempts = [
    { Authorization: `WebPush ${jwt}` },
    { Authorization: `vapid t=${jwt}, k=${pub}` },
  ];
  for (const auth of attempts) {
    try {
      const res = await fetch(subscription.endpoint, { method: 'POST', headers: { ...headers, ...auth }, body });
      if (res.ok || res.status === 201 || res.status === 202) return { ok: true, status: res.status };
      if (res.status === 401 || res.status === 400) continue; // retry with legacy scheme
      return { ok: false, status: res.status };
    } catch { /* network error — keep subscription */ }
  }
  return { ok: false, status: 0 };
}
