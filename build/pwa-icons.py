# build/pwa-icons.py — regenerate the home-screen icon set in docs/ from the
# app logo. Run: python build/pwa-icons.py
#
# Source: NewLogo.png (square RACE PLAN badge on black). It's already composed
# as an app icon; standard icons are a straight resize. The maskable icon insets
# it a little further on black so Android's circular/squircle mask can't clip
# the "by Krispel" line near the bottom edge.
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "NewLogo.png")
OUT = os.path.join(ROOT, "docs")
BG = (10, 10, 12)   # near-black, matches the badge ground

src = Image.open(SRC).convert("RGB")
S = min(src.size)
src = src.crop(((src.width - S) // 2, (src.height - S) // 2,
                (src.width - S) // 2 + S, (src.height - S) // 2 + S))


def resized(px):
    return src.resize((px, px), Image.LANCZOS)


def maskable(px, scale=0.82):
    c = Image.new("RGB", (px, px), BG)
    inner = int(px * scale)
    c.paste(src.resize((inner, inner), Image.LANCZOS), ((px - inner) // 2, (px - inner) // 2))
    return c


jobs = [
    ("icon-192.png",          lambda: resized(192)),
    ("icon-512.png",          lambda: resized(512)),
    ("apple-touch-icon.png",  lambda: resized(180)),
    ("favicon-64.png",        lambda: resized(64)),
    ("icon-maskable-512.png", lambda: maskable(512)),
]
os.makedirs(OUT, exist_ok=True)
for name, make in jobs:
    path = os.path.join(OUT, name)
    make().save(path, optimize=True, quality=90)
    print(f"{name:24} {os.path.getsize(path) // 1024} KB")
