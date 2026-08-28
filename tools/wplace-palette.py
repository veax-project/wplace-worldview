"""Reads off the exact palette of the wplace logo and favicon."""
import os
from collections import Counter

from PIL import Image

for name in ('wp_favicon.ico', 'wp_logo.png', 'wp_og-image.png'):
    if not os.path.exists(name):
        continue
    im = Image.open(name)
    print(f'--- {name}  {im.size}  {im.mode}  ({os.path.getsize(name):,} B)')
    if name.endswith('.ico'):
        # a .ico holds several sizes: we take the largest one
        try:
            im.size = max(im.ico.sizes())
            im = im.ico.getimage(im.size)
        except Exception:
            pass
        print(f'    size kept: {im.size}')
    im = im.convert('RGBA')
    c = Counter(im.getdata())
    total = sum(n for _, n in c.items())
    for color, n in c.most_common(12):
        r, g, b, a = color
        if a < 30:
            label = 'transparent'
        else:
            label = f'#{r:02X}{g:02X}{b:02X}'
        print(f'    {label:<14} a={a:<4} {n * 100 / total:5.1f} %')
    print()
