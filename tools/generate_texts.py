#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generates extension/texts.json from extension/_locales/.

WHY THIS FILE EXISTS
--------------------
The extension shows its labels in WPLACE's language, not the browser's (see
extension/language.js). So it has to be able to read a locale that is NOT the one
chrome.i18n would hand it.

The obvious route would be to read _locales/<x>/messages.json directly. Two
uncertainties stand in the way, and neither can be settled from a dev machine:
  - `_locales/` is a folder RESERVED by Chrome, prefixed with an underscore;
  - a content script can only read a file from the package if it is declared
    in web_accessible_resources, hence exposed to the page.

Rather than gamble, we copy the same texts into an ORDINARY file. The service
worker and the popup read it without declaring anything, without exposing
anything, and without depending on how a reserved folder gets handled.

_locales/ stays the SOURCE: this file here is a product of it, never the other
way round. package.py regenerates it before every archive, and the
test-ui.html bench checks that the two agree.

    py -3 tools/generate_texts.py
"""
import io
import json
import os
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCALES = os.path.join(ROOT, 'extension', '_locales')
OUTPUT = os.path.join(ROOT, 'extension', 'texts.json')


def build():
    """{ lang: { key: text } }, in the order of the source file."""
    everything = OrderedDict()
    for lang in sorted(os.listdir(LOCALES)):
        path = os.path.join(LOCALES, lang, 'messages.json')
        if not os.path.exists(path):
            continue
        msgs = json.loads(io.open(path, encoding='utf-8').read(),
                          object_pairs_hook=OrderedDict)
        # flatten it: Chrome's { "message": ... } is of no further use here
        everything[lang] = OrderedDict((k, v['message']) for k, v in msgs.items())
    return everything


def render(everything):
    # LF and not CRLF: this file is never read by hand, and compact JSON fits
    # in the package. Indent 1 to stay readable in a diff.
    return json.dumps(everything, ensure_ascii=False, indent=1) + '\n'


def main(quiet=False):
    everything = build()
    text = render(everything)
    previous = io.open(OUTPUT, encoding='utf-8').read() if os.path.exists(OUTPUT) else None
    if previous != text:
        io.open(OUTPUT, 'w', encoding='utf-8', newline='\n').write(text)
    if not quiet:
        state = 'unchanged' if previous == text else ('created' if previous is None else 'updated')
        detail = ', '.join(f'{k} : {len(v)}' for k, v in everything.items())
        print(f'  texts.json {state} -- {detail}')
    return previous == text


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
