#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Validates _locales/ by replaying Chrome's REAL algorithm.

Why not a plain regular expression: we thought we could escape our markers as
$$NAME$$. That is wrong, and it broke loading twice in a row. Chrome's parser
(MessageBundle::ReplaceVariables) does this:

    look for '$'                       -> start of the name
    look for the next '$'              -> end of the name
    if the name is empty or invalid    -> STEP one char forward and retry
    else the name must be declared     -> otherwise: refuses to load

On $$NAME$$: the first pass reads an EMPTY name between the first two dollars,
so it goes through; the next pass restarts at the second dollar and reads NAME
between the two middle dollars. So the name really is claimed. There is no
escaping at this point.

Conclusion applied to the project: our markers use {BRACES}, never dollars.
This file checks that no dollar is left lying around.

    py -3 tools/verify_locales.py
"""
import io
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'extension', '_locales')
D = '$'


def valid_name(name):
    """Chrome's IsValidName: ASCII letters, digits, underscore, non-empty."""
    return bool(name) and all(c.isascii() and (c.isalnum() or c == '_') for c in name)


def claimed_variables(message):
    """The names Chrome will require, following its own loop."""
    claimed = []
    i = 0
    while True:
        start = message.find(D, i)
        if start < 0:
            return claimed
        start += 1
        if start >= len(message):
            return claimed
        end = message.find(D, start)
        if end < 0:
            return claimed
        name = message[start:end]
        if not valid_name(name):
            i = start          # exactly what Chrome does: step one char forward
            continue
        claimed.append(name)
        i = end + 1


def verify():
    problems = []
    keys_by_lang = {}

    for lang in sorted(os.listdir(ROOT)):
        path = os.path.join(ROOT, lang, 'messages.json')
        if not os.path.exists(path):
            continue
        msgs = json.load(io.open(path, encoding='utf-8'))
        keys_by_lang[lang] = set(msgs)

        for key, val in msgs.items():
            text = val.get('message', '')
            declared = {p.lower() for p in val.get('placeholders', {})}
            for name in claimed_variables(text):
                if name.lower() not in declared:
                    problems.append(
                        f'{lang}/{key} : Chrome will claim {D}{name}{D} -- '
                        f'use {{{name}}}, our markers are in braces')

    langs = list(keys_by_lang)
    # A single locale is almost always an accident: one has just been removed
    # and the next one has not been written yet. Without this guard the parity
    # comparison below is simply skipped, and the script announces "locales
    # are valid" when it has checked nothing at all.
    if len(langs) == 1:
        problems.append(f'only one locale ({langs[0]}): key parity has nothing to compare')
    if len(langs) > 1:
        base = keys_by_lang[langs[0]]
        for other in langs[1:]:
            for c in sorted(base ^ keys_by_lang[other]):
                problems.append(f'mismatched key between {langs[0]} and {other} : {c}')

    return problems, keys_by_lang


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    # quick check of the parser itself, on the cases that trapped us
    for sample, expected in [
        ('Cache: <b>' + D + 'N' + D + '</b>', ['N']),
        ('Cache: <b>' + D + D + 'N' + D + D + '</b>', ['N']),   # escaping fails
        ('Cache: <b>{N}</b> / {MAX}', []),
        ('price: 100' + D, []),
    ]:
        got = claimed_variables(sample)
        assert got == expected, (sample, got, expected)
    print('  parser matches Chrome (4 proven cases)')

    problems, keys = verify()
    for lang, c in keys.items():
        print(f'  {lang} : {len(c)} messages')
    if problems:
        print(f'\n  {len(problems)} PROBLEM(S) -- Chrome will refuse to load the extension:')
        for p in problems:
            print('    ' + p)
        sys.exit(1)
    print('  locales are valid')
