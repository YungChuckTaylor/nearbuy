#!/usr/bin/env python3
"""Generate Android launcher icons + splash wordmark from the PWA assets.

Sources (kept single-source-of-truth with the web app):
  public/assets/icon-512.png  — full-bleed navy square with the logo mark
  public/assets/logo.jpg      — 605×331 wordmark

Outputs into android/app/src/main/res/:
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png            (legacy, rounded)
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png (adaptive, 72/108 safe zone)
  drawable-nodpi/logo_wordmark.png                       (white rounded card for splash)
Run: python3 android/tools/make-icons.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SRC_ICON = os.path.join(ROOT, 'public', 'assets', 'icon-512.png')
SRC_LOGO = os.path.join(ROOT, 'public', 'assets', 'logo.jpg')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

DENSITIES = {  # dpi folder → (legacy px, adaptive canvas px)
    'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216),
    'xxhdpi': (144, 324), 'xxxhdpi': (192, 432),
}

def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out

def main():
    icon = Image.open(SRC_ICON).convert('RGBA')
    for dpi, (legacy, canvas) in DENSITIES.items():
        d = os.path.join(RES, f'mipmap-{dpi}')
        os.makedirs(d, exist_ok=True)
        # Legacy launcher icon (API < 26): rounded full-bleed square
        rounded(icon.resize((legacy, legacy), Image.LANCZOS), max(4, legacy // 12)).save(os.path.join(d, 'ic_launcher.png'))
        # Adaptive foreground: mark occupies the 72/108dp safe zone on transparent canvas
        fg = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        inner = int(round(canvas * 72 / 108))
        fg.paste(icon.resize((inner, inner), Image.LANCZOS), ((canvas - inner) // 2, (canvas - inner) // 2))
        fg.save(os.path.join(d, 'ic_launcher_foreground.png'))
        print(f'  mipmap-{dpi}: ic_launcher {legacy}px, foreground {canvas}px')

    # Splash wordmark: white rounded card with the logo, for the navy splash screen
    logo = Image.open(SRC_LOGO).convert('RGB')
    pad, radius = 26, 34
    card = Image.new('RGBA', (logo.width + pad * 2, logo.height + pad * 2), (255, 255, 255, 255))
    card = rounded(card, radius)
    card.paste(logo, (pad, pad))
    outdir = os.path.join(RES, 'drawable-nodpi')
    os.makedirs(outdir, exist_ok=True)
    card.save(os.path.join(outdir, 'logo_wordmark.png'))
    print(f'  drawable-nodpi/logo_wordmark.png {card.size}')

if __name__ == '__main__':
    main()
