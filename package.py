#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Builds the .zip to upload to the Chrome Web Store.

The Store expects manifest.json AT THE ROOT of the archive: so we zip the
CONTENTS of extension/, not the folder itself.

    py -3 package.py
"""
import io
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(ROOT, 'extension')
sys.path.insert(0, os.path.join(ROOT, 'tools'))


def check():
    """The checks Chrome runs at load time, run BEFORE packaging.

    An unescaped $MARKER$ in _locales/ makes the WHOLE extension fail to load,
    with "Could not load manifest file" as the only message -- without saying
    which one. That already cost us a broken release: better to catch it
    here."""
    # texts.json is a PRODUCT of _locales/: we regenerate it rather than
    # trust whatever copy is lying around. A locale edited without a rebuild
    # would ship a half-translated interface, and nothing would say so.
    from generate_texts import main as generate_texts
    generate_texts()

    from verify_locales import verify
    errors, _ = verify()
    if errors:
        print('  INVALID LOCALES -- Chrome will refuse to load the extension:')
        for f in errors:
            print('    ' + f)
        sys.exit(1)

    for f in ('manifest.json', 'sw.js', 'content-main.js', 'content-iso.js',
              'ui.js', 'worker.js', 'image.js', 'decoder.js', 'language.js',
              'texts.json'):
        if not os.path.exists(os.path.join(SOURCE, f)):
            sys.exit(f'  missing file: {f}')

    m = json.load(io.open(os.path.join(SOURCE, 'manifest.json'), encoding='utf-8'))
    declared = set(m.get('web_accessible_resources', [{}])[0].get('resources', []))
    for f in ('worker.js', 'image.js', 'decoder.js', 'vendor/fzstd.js'):
        if f not in declared:
            sys.exit(f'  {f} is not in web_accessible_resources: the worker pool will not start')
    print('  checks: locales valid, files present, resources declared\n')


def main():
    check()
    manifest = json.load(io.open(os.path.join(SOURCE, 'manifest.json'), encoding='utf-8'))
    version = manifest['version']
    output = os.path.join(ROOT, f'wplace-worldview-{version}.zip')
    if os.path.exists(output):
        os.remove(output)

    print(f"  {manifest['name']} v{version}\n")
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(SOURCE):
            for f in sorted(files):
                path = os.path.join(folder, f)
                inner = os.path.relpath(path, SOURCE).replace(os.sep, '/')
                z.write(path, inner)
                print(f'    {inner:<34} {os.path.getsize(path):>8,} B')

    with zipfile.ZipFile(output) as z:
        names = z.namelist()
    print()
    print(f'  -> {os.path.basename(output)} : {os.path.getsize(output):,} bytes')
    print(f'     manifest.json at the root : {"manifest.json" in names}')
    print(f'     no stray parent folder    : {not any(n.startswith("extension/") for n in names)}')


if __name__ == '__main__':
    main()
