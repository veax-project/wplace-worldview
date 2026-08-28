#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Enlarges a region of a screenshot, to judge a detail down to the pixel.

    py -3 tools/zoom.py preview-bubble.png zoom.png  x y width height [factor]
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROOFS = os.path.join(ROOT, 'proof')

src, dst, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
f = int(sys.argv[7]) if len(sys.argv) > 7 else 4

im = Image.open(os.path.join(PROOFS, src)).convert('RGB')
z = im.crop((x, y, x + w, y + h)).resize((w * f, h * f), Image.NEAREST)
z.save(os.path.join(PROOFS, dst))
print(f'  {dst}  {z.size[0]}x{z.size[1]}  (x{f})')
