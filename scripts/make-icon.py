"""Draws OpenPDF's mark (see src/renderer/src/Logo.tsx) into build/icon.ico at several sizes.
Usage: python scripts/make-icon.py
"""
import os
from PIL import Image, ImageDraw

RED = (200, 50, 60, 255)
WHITE = (255, 255, 255, 255)
FOLD = (255, 255, 255, 140)

def draw(size: int) -> Image.Image:
    # Draw at 8x for smooth edges, then shrink.
    k = size * 8 / 32
    img = Image.new('RGBA', (size * 8, size * 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p = lambda pts: [(x * k, y * k) for x, y in pts]
    # The page with a cut corner.
    d.polygon(p([(5, 5), (7, 3), (19, 3), (26, 10), (26, 27), (24, 29), (7, 29), (5, 27)]), fill=RED)
    d.polygon(p([(19, 3), (19, 8), (21, 10), (26, 10)]), fill=FOLD)
    # The ring and its handle.
    r = 5.2
    cx, cy = 15.5, 19
    w = max(1, round(2.6 * k))
    d.ellipse([(cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k], outline=WHITE, width=w)
    d.line(p([(19.2, 15.3), (22.4, 12.1)]), fill=WHITE, width=w)
    return img.resize((size, size), Image.LANCZOS)

os.makedirs('build', exist_ok=True)
sizes = [16, 24, 32, 48, 64, 128, 256]
big = draw(256)
big.save('build/icon.ico', sizes=[(s, s) for s in sizes])
big.save('build/icon.png')
print('wrote build/icon.ico and build/icon.png')
