#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
How heavy is the archive pyramid, zoom level by zoom level?

That is the question that decides whether "download the whole map" is realistic,
and up to which level. We do not guess: we sample.

Method: for the levels where the grid is small, we walk it in full; beyond that,
we draw a random sample and extrapolate. Missing tiles (ocean, empty desert)
answer 404 and count as zero -- that is precisely what makes the total far
smaller than 4^z times the average weight.

We stay polite: few threads, and we stop as soon as we have enough to conclude.

    py -3 tools/weigh-archive.py
"""
import random
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ARCHIVE = 'https://wplace.eralyon.net'
HOURS_PER_WEEK = 7 * 24
THREADS = 12
SAMPLE = 80                 # tiles drawn per level when the grid is large


def current_version():
    import re
    html = urllib.request.urlopen(
        urllib.request.Request(ARCHIVE + '/en/', headers={'User-Agent': 'Mozilla/5.0'}),
        timeout=60).read().decode('utf-8', 'replace')
    found = re.findall(r"\{version: '(\d+)', date: '([^']*)'\}", html)
    if not found:
        sys.exit('version not found')
    return int(found[-1][0]), found[-1][1]


def weigh(args):
    week, z, x, y = args
    url = f'{ARCHIVE}/tiles/{week}/{z}/{x}/{y}.zst'
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60)
        return len(r.read())
    except urllib.error.HTTPError as e:
        return 0 if e.code == 404 else None      # None = glitch, we discard it
    except Exception:
        return None


def main():
    version, date = current_version()
    week = version // HOURS_PER_WEEK
    print(f'archive version {version} ({date}), week {week}\n')
    print(f"{'level':>6} {'tiles':>9} {'probed':>8} {'present':>10} "
          f"{'avg. KB':>9} {'EST. TOTAL':>14}")
    print('-' * 62)

    grand_total = 0
    rng = random.Random(20260825)
    for z in range(0, 9):
        n = 4 ** z
        side = 2 ** z
        if n <= 256:
            targets = [(week, z, x, y) for x in range(side) for y in range(side)]
        else:
            seen = set()
            while len(seen) < SAMPLE:
                seen.add((rng.randrange(side), rng.randrange(side)))
            targets = [(week, z, x, y) for (x, y) in seen]

        with ThreadPoolExecutor(THREADS) as ex:
            sizes = list(ex.map(weigh, targets))

        valid = [t for t in sizes if t is not None]
        if not valid:
            print(f'{z:>6} {n:>9} {"--":>8}   (no usable response)')
            continue
        present = [t for t in valid if t > 0]
        share = len(present) / len(valid)
        average = (sum(present) / len(present)) if present else 0
        total = n * share * average
        grand_total += total
        print(f'{z:>6} {n:>9} {len(valid):>8} {share * 100:>9.0f}% '
              f'{average / 1024:>8.0f} {total / 1048576:>11.0f} MB')

    print('-' * 62)
    print(f'{"total z0-z8":>26} {grand_total / 1073741824:>32.2f} GB')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
