#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Runs bench-map.html under headless Chrome and summarizes the report.

Why headless: a tab that is not displayed composes no image, so MapLibre makes
no progress there -- there is neither requestAnimationFrame nor any tile
loading. Headless Chrome renders off screen, and --virtual-time-budget advances
the timers in one go instead of waiting in real time.

The bench POSTs its report back to /save/, which _devserve.py stores in
proof/.

    py -3 tools/measure-map.py
"""
import io
import json
import os
import subprocess
import time
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = os.path.join(ROOT, 'proof', 'rapport-carte.json')
BASE = 'http://127.0.0.1:8792/bench-map.html'
ARGS = ''.join(a for a in sys.argv[1:] if a.startswith('?'))

CHROME = next((c for c in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
) if os.path.exists(c)), None)


def run(budget=120000):
    if not CHROME:
        sys.exit('Chrome not found.')
    if os.path.exists(REPORT):
        os.remove(REPORT)
    profile = tempfile.mkdtemp(prefix='wv-carte-')
    # We let it run in REAL TIME and wait for the page to drop its report.
    # --virtual-time-budget advanced the timers so fast that Chrome closed
    # before the end of the scenario; and measuring tile loads under
    # accelerated time would make no sense anyway.
    proc = subprocess.Popen([
        CHROME, '--headless=new', '--hide-scrollbars',
        # MapLibre needs a WebGL context: headless calls for the software one
        '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
        '--enable-logging=stderr', '--v=0',
        f'--user-data-dir={profile}',
        '--window-size=1280,800',
        BASE + ARGS,
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    start = time.time()
    try:
        while time.time() - start < budget / 1000:
            if os.path.exists(REPORT):
                time.sleep(0.4)                    # let the write finishedsh
                break
            time.sleep(0.5)
    finally:
        proc.terminate()
        try:
            _, err = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            err = ''

    if not os.path.exists(REPORT):
        interesting = [l for l in (err or '').splitlines()
                       if 'CONSOLE' in l or ':ERROR:' in l]
        print('--- Chrome log ---')
        for l in interesting[:30]:
            print('  ' + l.strip()[:220])
        sys.exit(f'\nno report after {budget / 1000:.0f} s')
    return json.load(open(REPORT, encoding='utf-8'))


def summarize(r):
    print(f"\n{'step':<32} {'req.':>5}   detail")
    print('-' * 92)
    for e in r['etapes']:
        p = e['parQuoi']
        if 'msComplet' in p:
            print(f"{e['nom']:<30} {e['total']:>4} req  {p['msComplet']:>5} ms  "
                  f"thread blocked {p['filBloque']:>4} ms ({p['tachesLongues']})  "
                  f"{p['imagesVides']} blank")
        else:
            detail = '  '.join(f'{k}={v}' for k, v in sorted(p.items()))
            print(f"{e['nom']:<30} {e['total']:>4} req  {detail}")

    print('\n--- summary ---')
    for k, v in r['final'].items():
        print(f'  {k:<24} {v}')

    if r.get('errors'):
        print(f"\n--- {len(r['errors'])} error(s) ---")
        for e in r['errors'][:8]:
            print('  ' + e)
    if r.get('console'):
        print(f"\n--- {len(r['console'])} warning(s) ---")
        for c in r['console'][:8]:
            print('  ' + c)


if __name__ == '__main__':
    # the Windows console is cp1252: without this, one arrow blows it all up
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    summarize(run())
