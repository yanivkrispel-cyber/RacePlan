# build/pwa-icons.py — regenerate the home-screen icon set in docs/ from the
# app logo. Run: python build/pwa-icons.py
#
# Source: docs/appLogo.jpg (1024x1024 circular badge on a dark ground). It is
# already composed as a square app icon, so the standard icons are a straight
# resize; the maskable icon insets it on a solid navy square so Android's
# circular/squircle mask can't clip the coin.
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "appLogo.jpg")
OUT = os.path.join(ROOT, "docs")
NAVY = (17, 21, 40)  # --rp-bg #111528

src = Image.open(SRC).convert("RGB")
S = min(src.size)
# center-crop to a perfect square first (in case it isn't exactly)
src = src.crop(((src.width - S) // 2, (src.height - S) // 2,
                (src.width - S) // 2 + S, (src.height - S) // 2 + S))


def resized(px):
    return src.resize((px, px), Image.LANCZOS)


def maskable(px, scale=0.86):
    c = Image.new("RGB", (px, px), NAVY)
    inner = int(px * scale)
    c.paste(src.resize((inner, inner), Image.LANCZOS), ((px - inner) // 2, (px - inner) // 2))
    return c


jobs = [
    ("icon-192.png",           lambda: resized(192)),
    ("icon-512.png",           lambda: resized(512)),
    ("apple-touch-icon.png",   lambda: resized(180)),
    ("favicon-64.png",         lambda: resized(64)),
    ("icon-maskable-512.png",  lambda: maskable(512)),
]
os.makedirs(OUT, exist_ok=True)
for name, make in jobs:
    path = os.path.join(OUT, name)
    make().save(path, optimize=True, quality=90)
    print(f"{name:24} {os.path.getsize(path) // 1024} KB")
