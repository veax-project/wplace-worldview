#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Captures a page from the test server with Chrome in headless mode.

Why Chrome rather than a screenshot from the built-in browsing tool: a tab that
is not displayed composes no image, so there is neither a screenshot nor any
CSS animation. Headless Chrome, on the other hand, renders off screen and
`--virtual-time-budget` advances the timers in one go -- which avoids waiting
for the interface delays (1.5 s before the bubble, then a poll every 400 ms).

    py -3 tools/capture.py preview-welcome.html preview-bubble.png
    py -3 tools/capture.py preview-welcome.html preview-bubble.png 1400 900
"""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, 'proof')
BASE = 'http://127.0.0.1:8792/'

CHROME = next((c for c in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    os.path.join(os.environ.get('LOCALAPPDATA', ''), r'Google\Chrome\Application\chrome.exe'),
) if os.path.exists(c)), None)


def capture(page, name, width=1360, height=440, budget=9000):
    if not CHROME:
        sys.exit('Chrome not found.')
    os.makedirs(OUTPUT, exist_ok=True)
    target = os.path.join(OUTPUT, name)
    # throwaway profile: without it Chrome refuses to start if an instance is running
    profile = tempfile.mkdtemp(prefix='wv-chrome-')
    r = subprocess.run([
        CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
        f'--user-data-dir={profile}',
        f'--window-size={width},{height}',
        f'--virtual-time-budget={budget}',
        f'--screenshot={target}',
        BASE + page,
    ], capture_output=True, text=True, timeout=120)
    if not os.path.exists(target):
        sys.exit(f'screenshot failed:\n{r.stdout}\n{r.stderr}')
    print(f'  {name}  {width}x{height}  {os.path.getsize(target):,} B')
    return target


if __name__ == '__main__':
    a = sys.argv[1:]
    capture(a[0] if a else 'preview-welcome.html',
            a[1] if len(a) > 1 else 'preview.png',
            int(a[2]) if len(a) > 2 else 1360,
            int(a[3]) if len(a) > 3 else 440,
            # The virtual time budget matters: it runs by much faster than real
            # time, so an element that closes on its own may already have
            # vanished before the screenshot.
            int(a[4]) if len(a) > 4 else 9000)
