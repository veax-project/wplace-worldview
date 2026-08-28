#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Builds the extension icons.

SHAPE: the exact path of the button we add to the wplace toolbar
(extension/ui.js, GLOBE constant -- the "public" icon from Material Symbols,
Apache 2.0). The Store icon and the in-game button are therefore rigorously
the same silhouette.

COLORS: wplace's own, sampled from their favicon and their 16x16 logo
(tools/wplace-palette.py). Their logo uses only five shades.

WARNING: we borrow their PALETTE, never their LOGO. Copying their pixelated
globe would be brand impersonation: the Chrome Web Store rejects it, and it
would be dishonest for an unofficial extension. Colors cannot be owned, a logo
can.

Rendering goes through Inkscape rather than a path redrawn by hand: an SVG
path with quadratic curves and an even-odd fill rule has no honest equivalent
in PIL.

    py -3 icons.py            -> comparison sheet of the ten variants
    py -3 icons.py ocean      -> installs the chosen variant in extension/icons/
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(ROOT, 'extension', 'icons')
SHEET = os.path.join(ROOT, 'proof', 'icon-variants.png')

INKSCAPE = next((c for c in (
    r'D:\Apps\Inkscape\bin\inkscape.exe',
    r'C:\Program Files\Inkscape\bin\inkscape.exe',
) if os.path.exists(c)), 'inkscape')

# --- wplace palette, sampled pixel by pixel from their favicon ---------------
BLUE = '#1C61E7'          # ocean, main shade         (17.2% of the logo)
BLUE_LIGHT = '#3172E7'    # ocean, light shade         (9.0%)
GREEN = '#4AD95B'         # continents, light shade    (9.4%)
GREEN_DARK = '#45CC55'    # continents, dark shade     (8.2%)
BLACK = '#000000'         # outline                   (14.1%)
# and two shades of our own, for the backgrounds
NIGHT = '#16181D'         # dark background, like the wplace interface
WHITE = '#FFFFFF'

# --- the glyph, copied verbatim from extension/ui.js -------------------------
GLOBE = ('M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 '
         '127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 '
         '54-127 85.5T480-80Zm-40-82v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 '
         '36q0 121 79.5 212T440-162Zm276-102q20-22 36-47.5t26.5-53q10.5-27.5 16-56.5t5.5-59q0-98-54.5-179T600-776v16q0 '
         '33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h240q17 0 28.5 11.5T600-440v120h40q26 '
         '0 47 15.5t29 40.5Z')

# The glyph is a disc of radius 400 centered at (480, -480), hollowed out in the
# shape of continents. So: a colored disc BELOW, the glyph in another color
# ON TOP, and the continents show through in the color underneath.
CX, CY, R = 480, -480, 400


def scene(margin, content):
    """Place `content` (in glyph coordinates) inside a 100-unit square."""
    e = 100 - 2 * margin
    return (f'<g transform="translate({margin},{margin}) scale({e / 960}) translate(0,960)">'
            f'{content}</g>')


def disc(color, radius=R):
    return f'<circle cx="{CX}" cy="{CY}" r="{radius}" fill="{color}"/>'


def glyph(color):
    return f'<path d="{GLOBE}" fill="{color}"/>'


def two_tone(ocean, continents, outline=None, thickness=48):
    """The globe in two shades: oceans on one side, continents on the other."""
    body = ''
    if outline:
        body += disc(outline, R + thickness)
    body += disc(continents) + glyph(ocean)
    return body


def frame(bg, radius=22):
    return f'<rect width="100" height="100" rx="{radius}" fill="{bg}"/>'


# --- the ten proposals -------------------------------------------------------
# `pixels`: rendered at that resolution then scaled up with nearest, for real
# pixel art instead of an illusion of pixel art.
VARIANTS = {
    # 1-2: the two-tone globe in wplace colors, on a dark or light background
    'ocean':        dict(svg=lambda: frame(NIGHT) + scene(12, two_tone(BLUE, GREEN))),
    'ocean-light':  dict(svg=lambda: frame(WHITE) + scene(12, two_tone(BLUE, GREEN))),

    # 3-4: the frame takes the color, the globe is knocked out (the shape you liked)
    'solid-blue':   dict(svg=lambda: frame(BLUE) + scene(13, glyph('#0B2A63'))),
    'solid-green':  dict(svg=lambda: frame(GREEN) + scene(13, glyph('#123A18'))),

    # 5: bold black outline, no frame -- the spirit of the wplace logo, our shape
    'outline':      dict(svg=lambda: scene(6, two_tone(BLUE, GREEN, BLACK, 44))),

    # --- the "outline" family, expanded: this is the direction we kept ---
    # The bold black outline is what brings our globe closest to the wplace
    # visual language without copying anything: they draw theirs on a grid of
    # 16 px, we draw ours in smooth curves. Same spirit, different shape.
    'outline-light':  dict(svg=lambda: frame(WHITE) + scene(13, two_tone(BLUE, GREEN, BLACK, 44))),
    'outline-dark':   dict(svg=lambda: frame(NIGHT) + scene(13, two_tone(BLUE, GREEN, BLACK, 44))),
    'outline-thin':   dict(svg=lambda: scene(6, two_tone(BLUE, GREEN, BLACK, 26))),
    'outline-thick':  dict(svg=lambda: scene(8, two_tone(BLUE, GREEN, BLACK, 66))),
    # the same, but rendered on a 22 px grid: the outline turns square
    'outline-pixel':  dict(svg=lambda: scene(5, two_tone(BLUE, GREEN, BLACK, 44)), pixels=22),

    # 6-7: the same glyph, but rendered on a 22 px grid then scaled up
    'pixel':        dict(svg=lambda: scene(4, two_tone(BLUE, GREEN, BLACK, 44)), pixels=22),
    'pixel-frame':  dict(svg=lambda: frame(NIGHT, 18) + scene(11, two_tone(BLUE, GREEN, BLACK, 40)),
                         pixels=22),

    # 8: the two blue shades of their logo, as a vertical gradient on the ocean
    'shade':        dict(svg=lambda:
                         '<defs><linearGradient id="o" x1="0" y1="0" x2="0" y2="1">'
                         f'<stop offset="0" stop-color="{BLUE_LIGHT}"/>'
                         f'<stop offset="1" stop-color="{BLUE}"/></linearGradient></defs>'
                         + frame(NIGHT) + scene(12,
                         disc(GREEN_DARK) + disc(GREEN, R * 0.94) + glyph('url(#o)'))),

    # 9: green -> blue gradient on the ocean, light continents
    'gradient':     dict(svg=lambda:
                         '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
                         f'<stop offset="0" stop-color="{GREEN}"/>'
                         f'<stop offset=".55" stop-color="{BLUE_LIGHT}"/>'
                         f'<stop offset="1" stop-color="{BLUE}"/></linearGradient></defs>'
                         + frame(WHITE) + scene(12, disc('#E8F0FF') + glyph('url(#g)'))),

    # 10: maximum contrast -- this is what holds up best at 16 px
    'inverse':      dict(svg=lambda: frame(BLUE) + scene(12, disc(WHITE) + glyph(BLUE))),
}


def render(variant, size, out):
    """Rasterize a variant. If it is pixelated, render small then scale up."""
    body = variant['svg']()
    pix = variant.get('pixels')
    rsize = min(pix, size) if pix else size

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
           f'width="{rsize}" height="{rsize}">{body}</svg>')
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False, encoding='utf-8') as f:
        f.write(svg)
        tmp = f.name
    try:
        r = subprocess.run(
            [INKSCAPE, tmp, '--export-type=png', f'--export-filename={out}',
             f'--export-width={rsize}', f'--export-height={rsize}'],
            capture_output=True, text=True)
        if not os.path.exists(out):
            raise RuntimeError(f'Inkscape failed:\n{r.stdout}\n{r.stderr}')
    finally:
        os.unlink(tmp)

    if rsize != size:
        # nearest: the squares must stay crisp, definitely not smoothed
        Image.open(out).resize((size, size), Image.NEAREST).save(out)


def font(size):
    for name in ('segoeui.ttf', 'arial.ttf'):
        c = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name)
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def sheet(names=None, out=None, per_row=5):
    """The variants at the three real sizes, straddling light and dark.

    An icon has to hold up in both Chrome themes, and that is exactly where a
    failed icon shows itself."""
    tmpdir = tempfile.mkdtemp()
    names = names or list(VARIANTS)
    col_w, row_h = 200, 196
    rows = (len(names) + per_row - 1) // per_row

    im = Image.new('RGB', (col_w * per_row, row_h * rows), (20, 22, 26))
    d = ImageDraw.Draw(im)
    for r in range(rows):
        d.rectangle([0, r * row_h + row_h // 2, im.width, (r + 1) * row_h], fill=(238, 240, 244))
    f = font(15)

    for i, name in enumerate(names):
        x0 = (i % per_row) * col_w
        y0 = (i // per_row) * row_h
        for size, dx, dy in ((128, 20, 10), (48, 20, 96), (16, 80, 112)):
            p = os.path.join(tmpdir, f'{name}-{size}.png')
            render(VARIANTS[name], size, p)
            v = Image.open(p).convert('RGBA')
            im.paste(v, (x0 + dx, y0 + dy), v)
        d.text((x0 + 20, y0 + row_h - 24), f'{i + 1}. {name}', font=f, fill=(60, 66, 76))

    path = out or SHEET
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print(f'sheet : {path}   ({len(names)} variants)')


def sheet16(names=None, out=None):
    """The ten variants at 16 px, scaled x7: this is the size that decides.

    An icon that is beautiful at 128 px and unreadable at 16 is worthless -- 16
    px is what Chrome shows in its toolbar, where the user actually sees it. We
    show it at its real size AND scaled up, on both backgrounds."""
    tmpdir = tempfile.mkdtemp()
    names = names or list(VARIANTS)
    F = 7
    col_w, row_h = 16 * F + 26, 16 * F + 68
    im = Image.new('RGB', (col_w * len(names), row_h * 2), (20, 22, 26))
    d = ImageDraw.Draw(im)
    d.rectangle([0, row_h, im.width, row_h * 2], fill=(238, 240, 244))
    f = font(12)

    for i, name in enumerate(names):
        p = os.path.join(tmpdir, f'{name}-16.png')
        render(VARIANTS[name], 16, p)
        v = Image.open(p).convert('RGBA')
        big = v.resize((16 * F, 16 * F), Image.NEAREST)
        x = i * col_w + 13
        for row, color in ((0, (170, 176, 190)), (1, (60, 66, 76))):
            y = row * row_h + 10
            im.paste(big, (x, y), big)
            im.paste(v, (x + 16 * F // 2 - 8, y + 16 * F + 8), v)   # real size
            d.text((x, y + 16 * F + 28), f'{i + 1}. {name}', font=f, fill=color)

    path = out or os.path.join(ROOT, 'proof', 'icons-16px.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print(f'sheet 16 px : {path}')


def install(name):
    v = VARIANTS[name]
    os.makedirs(ICONS, exist_ok=True)
    for t in (16, 48, 128):
        p = os.path.join(ICONS, f'icon{t}.png')
        render(v, t, p)
        print(f'  icon{t}.png       {os.path.getsize(p):>7,} B')

    # The Store recommends a 96 px visual centered in a 128 px canvas with a
    # transparent margin: without it, the icon looks bigger than its
    # neighbours in the Store grid.
    #
    # We measure the drawing instead of assuming it. Rendering at 96 then
    # pasting at (16,16) did NOT give a 96 px visual: every variant already
    # carries its own margin in the viewBox (scene(6, ...), scene(13, ...)),
    # and the globe does not fill its whole frame. Measured result: 78 px
    # instead of 96, an icon visibly smaller than its neighbours. Starting
    # from the 128 px render and cropping to the real box, it works for every
    # variant.
    p = os.path.join(ROOT, 'proof', 'store-128.png')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    render(v, 128, p)
    full = Image.open(p).convert('RGBA')
    box = full.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox()
    art = full.crop(box)
    side = max(art.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(art, ((side - art.size[0]) // 2, (side - art.size[1]) // 2), art)
    small = square.resize((96, 96), Image.LANCZOS)     # downscale: no loss
    bg = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    bg.paste(small, (16, 16), small)
    bg.save(p)
    print(f'  store-128.png    {os.path.getsize(p):>7,} B   (96 px centered, transparent margin)')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--family':
        prefix = sys.argv[2]
        names = [n for n in VARIANTS if n.startswith(prefix)]
        if not names:
            sys.exit(f'no variant starts with "{prefix}"')
        sheet(names, os.path.join(ROOT, 'proof', f'famille-{prefix}.png'), len(names))
        sheet16(names, os.path.join(ROOT, 'proof', f'famille-{prefix}-16px.png'))
    elif len(sys.argv) > 1:
        choice = sys.argv[1]
        if choice not in VARIANTS:
            sys.exit(f'unknown variant: {choice}\navailable: {", ".join(VARIANTS)}')
        install(choice)
    else:
        sheet()
        sheet16()
