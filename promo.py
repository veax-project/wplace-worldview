#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Builds the Chrome Web Store promotional images.

  - 440 x 280   small promo tile
  - 1400 x 560  marquee promo tile

The background is a REAL wplace tile, decoded with our own decoder: this is
exactly what the extension displays, not an invented illustration.

    py -3 promo.py
"""
import io
import os
import re
import struct

import zstandard as zstd
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
TILE = os.path.join(ROOT, 'tiles', '6_32_22.zst')        # Europe, very dense
OUT = os.path.join(ROOT, 'promo')

GREEN = (0, 224, 112)
BG = (17, 19, 23)


def palette():
    """The wplace palette, read from extension/decoder.js."""
    src = io.open(os.path.join(ROOT, 'extension', 'decoder.js'), encoding='utf-8').read()
    block = src[src.index('export const PALETTE = ['):]
    block = block[:block.index('];')]
    return [tuple(int(v) for v in m) for m in re.findall(r'\[(\d+),\s*(\d+),\s*(\d+)\]', block)]


def tile_to_image():
    raw = open(TILE, 'rb').read()
    version, size = struct.unpack('<II', raw[:8])
    d = zstd.ZstdDecompressor().decompress(raw[8:8 + size], max_output_size=64 << 20)
    w, h = struct.unpack('<II', d[:8])
    pal = palette()
    im = Image.new('RGB', (w, h), (255, 255, 255))
    px = im.load()
    idx = d[8:8 + w * h]
    for n, v in enumerate(idx):
        if v:
            px[n % w, n // w] = pal[v]
    return im


def font(size, bold=True):
    for name in (('segoeuib.ttf', 'arialbd.ttf') if bold else ('segoeui.ttf', 'arial.ttf')):
        path = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def most_colorful_area(world, w, h):
    """Look for the most colorful framing: that is what makes people install."""
    small = world.resize((world.width // 8, world.height // 8), Image.NEAREST)
    px = small.load()
    sw, sh = max(1, w // 8), max(1, h // 8)
    best, best_score = (0, 0), -1
    for y in range(0, small.height - sh, 8):
        for x in range(0, small.width - sw, 8):
            shades, vivid = set(), 0
            for j in range(0, sh, 3):
                for i in range(0, sw, 3):
                    c = px[x + i, y + j]
                    shades.add(c)
                    if max(c) - min(c) > 60:          # a true color, not a grey
                        vivid += 1
            score = len(shades) + vivid * 2
            if score > best_score:
                best_score, best = score, (x * 8, y * 8)
    return best


def compose(width, height, title, tagline, title_size, tagline_size):
    world = tile_to_image()
    # We aim for an area twice as large as the output then scale it down: scaling
    # 1000 px down in one go chopped the pixel art into mush. But the tile is only
    # 1000 px wide: we trim the framing so it fits, even if we scale up afterwards.
    cw, ch = width * 2, height * 2
    if cw > world.width:
        cw, ch = world.width, round(world.width * height / width)
    if ch > world.height:
        ch, cw = world.height, round(world.height * width / height)

    x0, y0 = most_colorful_area(world, cw, ch)
    x0 = max(0, min(x0, world.width - cw))
    y0 = max(0, min(y0, world.height - ch))
    cut = world.crop((x0, y0, x0 + cw, y0 + ch))
    # scaling up with nearest (pixel art owned), down with box (gentler)
    bg = cut.resize((width, height),
                    Image.NEAREST if cw < width else Image.BOX)

    # Strong darkening on the left (under the text), almost none on the right:
    # the drawings have to stay colorful, they are the whole argument.
    veil = Image.new('L', (width, height))
    dv = ImageDraw.Draw(veil)
    for x in range(width):
        t = x / width
        dv.line([(x, 0), (x, height)], fill=int(245 * max(0.0, 1 - (t / 0.78) ** 2.2)))
    bg = Image.composite(Image.new('RGB', (width, height), BG), bg, veil)

    d = ImageDraw.Draw(bg)
    margin = int(width * 0.055)
    ft, fg = font(title_size), font(tagline_size, bold=False)

    top = int(height * 0.5) - title_size
    # drop shadow: guarantees legibility even if the framing changes
    d.text((margin + 2, top + 2), title, font=ft, fill=(0, 0, 0))
    d.text((margin, top), title, font=ft, fill=(255, 255, 255))
    ty = top + int(title_size * 1.3)
    d.text((margin + 2, ty + 2), tagline, font=fg, fill=(0, 0, 0))
    d.text((margin, ty), tagline, font=fg, fill=GREEN)

    d.rectangle([0, height - max(3, height // 90), width, height], fill=GREEN)
    return bg


def main():
    os.makedirs(OUT, exist_ok=True)
    for (w, h, ts, tg, name) in [
        (440, 280, 34, 17, 'promo-440x280.png'),
        (1400, 560, 92, 40, 'promo-1400x560.png'),
    ]:
        img = compose(w, h, 'Wplace WorldView', 'See the whole map', ts, tg)
        path = os.path.join(OUT, name)
        img.convert('RGB').save(path)            # 24-bit PNG, no alpha: required by the Store
        print(f'  {name:<22} {img.size[0]}x{img.size[1]}  {os.path.getsize(path):>8,} B')


if __name__ == '__main__':
    main()
