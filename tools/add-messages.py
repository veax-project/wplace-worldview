#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Adds labels to the _locales/ files, without touching anything else.

Goes through a script rather than by hand to guarantee that every language
stays aligned: a key present in English but missing from another locale gives
an empty string in the interface, and chrome.i18n reports nothing.

The extension follows the site's languages: English (the default language) and
Brazilian Portuguese. Adding an entry here means adding the key in ALL the
locales of the NEW_MESSAGES dictionary in one go.

Preserves the CRLF line endings of existing files: otherwise every addition
rewrites the whole file and makes the diff unreadable.

    py -3 tools/add-messages.py
"""
import io
import json
import os
from collections import OrderedDict

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'extension', '_locales')

NEW_MESSAGES = {
    'en': {
        'safetyNet': 'Safety net',
        'safetyNetHelp': 'Keeps our layer underneath wplace’s own, at every zoom. Invisible '
                     'while theirs works — it takes over if their drawings stop showing. '
                     'Costs no extra requests: it reuses the tiles wplace already downloaded.',
    },
    'pt_BR': {
        'safetyNet': 'Rede de segurança',
        'safetyNetHelp': 'Entra sozinha quando os tiles do wplace param de carregar: nossa '
                     'camada fica embaixo da deles e mostra os desenhos do arquivo em vez '
                     'de um mapa vazio, e sai assim que o wplace volta. Não custa nada '
                     'enquanto está tudo bem. Ligue aqui para deixá-la sempre ativa.',
    },
}


def main():
    keys_by_lang = {}
    for lang, additions in NEW_MESSAGES.items():
        path = os.path.join(ROOT, lang, 'messages.json')
        raw = io.open(path, encoding='utf-8', newline='').read()
        newline = '\r\n' if '\r\n' in raw else '\n'
        msgs = json.loads(raw, object_pairs_hook=OrderedDict)

        for key, text in additions.items():
            msgs[key] = OrderedDict([('message', text)])

        out = json.dumps(msgs, ensure_ascii=False, indent=2) + '\n'
        io.open(path, 'w', encoding='utf-8', newline=newline).write(out)
        keys_by_lang[lang] = set(msgs)
        print(f'  {lang} : {len(msgs)} messages (+{len(additions)})')

    # Generic gap: whatever is not in ALL the languages at once. Does not
    # assume there are exactly two of them -- the day we add one, the check
    # keeps working all by itself.
    in_all = set.intersection(*keys_by_lang.values()) if keys_by_lang else set()
    in_any = set().union(*keys_by_lang.values()) if keys_by_lang else set()
    gap = in_any - in_all
    print(f'  the {len(keys_by_lang)} languages are aligned' if not gap
          else f'  [!] mismatched keys : {sorted(gap)}')


if __name__ == '__main__':
    main()
