#!/usr/bin/env python3
"""Replicate the PWA client's extractColors() (recognize.js) on generated test
images, then call /api/v1/recognize with exactly the signals the real app would
send, and report the candidates."""
import io, json, urllib.request
from PIL import Image, ImageDraw

BASE = 'http://localhost:3000/api/v1/recognize'

def extract_colors(img, top_n=4):
    """Mirror of public/js/recognize.js extractColors: 32x32, alpha>=120,
    5-bit-per-channel buckets, top-N by count, averaged bucket color."""
    im = img.convert('RGBA').resize((32, 32))
    px = im.load()
    buckets = {}
    for y in range(32):
        for x in range(32):
            r, g, b, a = px[x, y]
            if a < 120:
                continue
            key = (r >> 5) << 10 | (g >> 5) << 5 | (b >> 5)
            e = buckets.get(key) or {'n': 0, 'r': 0, 'g': 0, 'b': 0}
            e['n'] += 1; e['r'] += r; e['g'] += g; e['b'] += b
            buckets[key] = e
    top = sorted(buckets.values(), key=lambda e: -e['n'])[:top_n]
    return ['#%02x%02x%02x' % (round(e['r']/e['n']), round(e['g']/e['n']), round(e['b']/e['n'])) for e in top]

def make_image(spec, size=480):
    """spec: list of (color, fraction) — draws horizontal bands, like a photo
    where the background dominates and the object takes part of the frame."""
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    y = 0
    for color, frac in spec:
        h = int(size * frac)
        d.rectangle([0, y, size, y + h], fill=color)
        y += h
    return img

def recognize(signals, label):
    body = json.dumps({'signals': signals, 'lat': 6.5244, 'lng': 3.3792}).encode()
    req = urllib.request.Request(BASE, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        res = json.load(r)
    print(f"\n=== {label}")
    print(f"    signals: colors={signals.get('colors')} filename={signals.get('filename')!r} text={signals.get('text')!r} barcode={signals.get('barcode')}")
    if not res['candidates']:
        print("    -> NO CANDIDATES (app shows 'no confident match, add a hint')")
    for c in res['candidates']:
        print(f"    {c['confidence']*100:>3.0f}%  {c['product']['name']:<38} matched_on={','.join(c['matched_on']) or '-'}")
    return res

# --- realistic photo scenarios (background-heavy, like real phone photos) ---
sneaker_photo = make_image([('#f2f2f2', 0.55), ('#d64545', 0.30), ('#1a1a1a', 0.15)])   # white sneaker w/ red + black sole
ankara_photo  = make_image([('#e87b29', 0.45), ('#2fbcc7', 0.30), ('#232c5c', 0.25)])    # orange/teal/navy print
rice_photo    = make_image([('#f5f0e0', 0.70), ('#efe9d8', 0.30)])                        # cream/beige bag of rice
phone_photo   = make_image([('#101010', 0.70), ('#7c6bc8', 0.20), ('#f5f5f5', 0.10)])     # black phone, purple case/screen
random_photo  = make_image([('#3aa655', 0.40), ('#111111', 0.35), ('#f5f5f5', 0.25)])     # green jersey-ish

for img, label in [(sneaker_photo, 'PHOTO: white/red/black sneaker (expect: UrbanRun Sneakers p7)'),
                   (ankara_photo,  'PHOTO: orange+teal+navy fabric (expect: Ankara Print Shirt p8)'),
                   (rice_photo,    'PHOTO: cream/beige item (expect: Rice/Semovita)'),
                   (phone_photo,   'PHOTO: black+purple device (expect: Tecno X5 p28)'),
                   (random_photo,  'PHOTO: green+black+white jersey (expect: Super Eagles Jersey p10)')]:
    colors = extract_colors(img)
    recognize({'filename': 'IMG_20260915_104503.jpg', 'text': '', 'colors': colors, 'barcode': None}, label)

# --- other input modes for completeness ---
recognize({'filename': '', 'text': '', 'colors': [], 'barcode': '6151000000011'}, 'BARCODE: 6151000000011 (expect: Wireless Earbuds p1)')
recognize({'filename': '', 'text': 'wireless earbuds', 'colors': [], 'barcode': None}, 'TEXT: wireless earbuds')
recognize({'filename': 'ankara shirt.jpg', 'text': '', 'colors': [], 'barcode': None}, 'FILENAME: ankara shirt.jpg')

# --- edge cases ---
pink_photo = make_image([('#ff69b4', 0.6), ('#f5f5f5', 0.4)])  # nothing pink in catalog
recognize({'filename': 'IMG_001.jpg', 'text': '', 'colors': extract_colors(pink_photo), 'barcode': None},
          'PHOTO: pink item — nothing pink in catalog (expect: NO candidates)')
recognize({'filename': '', 'text': 'rice', 'colors': [], 'barcode': None},
          'TEXT single keyword: rice (expect: Parboiled Rice)')
recognize({'filename': 'photo.jpg', 'text': '', 'colors': ['#e87b29', '#2fbcc7', '#232c5c'], 'barcode': None},
          'PHOTO + noise filename: ankara palette, filename "photo.jpg" (expect: Ankara Print Shirt)')
recognize({'filename': '', 'text': 'watch', 'colors': ['#111111', '#c9a26b'], 'brand': 'oraimo', 'category': 'electronics', 'barcode': None},
          'HINTS: colors + brand + category for a watch (expect: Smart Watch S9)')
