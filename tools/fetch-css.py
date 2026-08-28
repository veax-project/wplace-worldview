#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetches the stylesheets served by wplace.live into proof/.

What it is for: Tailwind only generates the utilities ACTUALLY used in the site
sources. A perfectly plausible class (`rotate-45`, `card`, `toast-end`...) can
therefore be completely absent from their sheet -- and our interface, which
relies on their classes to blend into the site, would then be mute without any
test noticing it.

The test benches load these files to check the rendering against the real CSS,
and not against a home-made imitation that would hide exactly that flaw.

    py -3 tools/fetch-css.py            fetches
    py -3 tools/fetch-css.py --verify also lists the classes present
"""
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, 'proof')
SITE = 'https://wplace.live'
BROWSER = {'User-Agent': 'Mozilla/5.0'}

# the local file name is stable, the fingerprint in the URL is not
SHEETS = [('wplace.css', 0), ('wplace2.css', 1)]


def fetch(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=BROWSER), timeout=60).read()


def main():
    os.makedirs(OUTPUT, exist_ok=True)
    html = fetch(SITE + '/').decode('utf-8', 'replace')
    links = re.findall(r'href="(\.?/?_app/immutable/assets/[^"]+\.css)"', html)
    if not links:
        sys.exit('no stylesheet found: the home page has changed shape')

    # the first one is the global sheet (Tailwind + daisyUI), the biggest one;
    # the next ones are component sheets, we take the biggest among them
    sizes = []
    for href in links:
        url = SITE + '/' + href.lstrip('./')
        try:
            sizes.append((len(fetch(url)), url))
        except Exception as e:
            print(f'  (skipping {href}: {e})')
    sizes.sort(reverse=True)

    for (name, rank) in SHEETS:
        if rank >= len(sizes):
            continue
        size, url = sizes[rank]
        path = os.path.join(OUTPUT, name)
        with open(path, 'wb') as f:
            f.write(fetch(url))
        print(f'  {name:<14} {size:>9,} B   {url.rsplit("/", 1)[1]}')

    if '--verify' in sys.argv:
        check()


def check():
    """Lists whether the classes our interface relies on are present."""
    blob = ''
    for (name, _) in SHEETS:
        p = os.path.join(OUTPUT, name)
        if os.path.exists(p):
            blob += open(p, encoding='utf-8', errors='replace').read()

    bs = chr(92)
    start = '(?<![' + bs + 'w' + bs + bs + '-])'
    end = '(?=[' + bs + 's,{:>' + bs + '[~+' + bs + bs + '])'

    KEYS = ['btn', 'btn-sm', 'btn-square', 'btn-primary', 'btn-ghost', 'btn-circle', 'btn-active',
            'join', 'join-item', 'range', 'toggle', 'diemptyr', 'modal', 'modal-box',
            'modal-backdrop', 'rounded-xl', 'shadow-md', 'shadow-xl', 'bg-base-100',
            'bg-base-200', 'border-base-300', 'text-base-content', 'text-primary',
            'size-5', 'size-9', 'leading-snug', 'opacity-70', 'flex-1', 'shrink-0',
            'justify-end', 'justify-center', 'items-start', 'gap-3', 'p-4', 'mt-1', 'mt-3',
            'font-bold', 'text-sm', 'rotate-45']
    print('\n  classes used by our interface:')
    for c in KEYS:
        present = bool(re.search(start + re.escape('.' + c) + end, blob))
        mark = 'yes' if present else '*** MISSING ***'
        print(f'    {c:<20} {mark}')


if __name__ == '__main__':
    main()
