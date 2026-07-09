#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Enforce that the WYSIWYG runtime-helper strip lists stay in sync.

M-06: the admin save path strips JS-injected runtime helpers twice — once
client-side in blog/blog-admin.js (`_sanitizeForSerialize`) and once
server-side in api/admin/_save.js (`RUNTIME_HELPER_IDS`). They are two
hand-maintained copies in two runtimes (browser IIFE vs Node ESM) that
cannot share a module, so the only thing keeping them a de-facto single
source of truth is this checker. Any drift is a bug:

  * server strips X but client does not → the admin PREVIEW / OPFS draft
    keeps a stale helper that the committed file will strip (preview lies).
  * client strips X but server does not → a helper survives server-side into
    the commit (duplicate DOM / CLS on next load).

Invariant enforced:  client_ids − {admin-chrome} == server_ids
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SERVER = ROOT / 'api' / 'admin' / '_save.js'
CLIENT = ROOT / 'blog' / 'blog-admin.js'

# Client-only ids: the admin toolbar chrome, which the server never sees
# (it is injected only in ?admin=1 sessions and can't reach a committed file).
ADMIN_CHROME = {'hs-admin-bar', 'hs-admin-status', 'hs-admin-css'}

_ID_RE = re.compile(r'^[A-Za-z][\w-]*$')


def _extract_ids(body: str) -> list[str]:
    """Single-pass scanner that pulls id string-literals from a JS array body.

    Correctly tracks lexical state so extraction can't be fooled (codex
    GPT-5.5 review, M-06):
      * `// 'hs-foo',`            → skipped (line comment), never counted;
      * `/* 'hs-foo', */`         → skipped (block comment);
      * unterminated `/* ...`     → consumed to EOF (ids after it stay OUT,
                                     which is the safe direction — they read
                                     as commented-out, never a false-pass);
      * `//` or `/*` INSIDE a string → treated as string content, so a real
                                       id is never dropped by a stray comment
                                       marker on a nearby line.
    A plain regex strip can't do all four (ordering + unterminated-comment
    cases), which is why prior regex attempts were rejected.
    """
    ids: list[str] = []
    i, n = 0, len(body)
    while i < n:
        ch = body[i]
        # line comment → skip to end of line
        if ch == '/' and i + 1 < n and body[i + 1] == '/':
            nl = body.find('\n', i + 2)
            i = n if nl == -1 else nl + 1
            continue
        # block comment → skip to closing */ (or EOF if unterminated)
        if ch == '/' and i + 1 < n and body[i + 1] == '*':
            end = body.find('*/', i + 2)
            i = n if end == -1 else end + 2
            continue
        # string literal → capture, honouring backslash escapes
        if ch == "'" or ch == '"':
            quote = ch
            i += 1
            start = i
            closed = False
            while i < n:
                c = body[i]
                if c == '\\':
                    i += 2
                    continue
                if c == quote:
                    closed = True
                    break
                i += 1
            if closed:
                lit = body[start:i]
                if _ID_RE.match(lit):
                    ids.append(lit)
                i += 1  # step past the closing quote
            else:
                i = n   # unterminated string → stop scanning
            continue
        i += 1
    return ids


def _dupes(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    dup: list[str] = []
    for i in ids:
        if i in seen and i not in dup:
            dup.append(i)
        seen.add(i)
    return dup


def parse_server(src: str) -> list[str]:
    m = re.search(r'RUNTIME_HELPER_IDS\s*=\s*\[([^\[\]]*)\]', src)
    if not m:
        raise ValueError('RUNTIME_HELPER_IDS array not found in api/admin/_save.js')
    return _extract_ids(m.group(1))


def parse_client(src: str) -> list[str]:
    # The strip array is the bracket pair immediately before `.forEach(function (id)`.
    # `[^\[\]]*` forbids nested brackets, so it captures exactly that inner list.
    matches = re.findall(
        r'\[([^\[\]]*)\]\s*\.forEach\(\s*function\s*\(\s*id\s*\)',
        src,
    )
    if len(matches) != 1:
        raise ValueError(
            f'expected exactly 1 strip-loop array in blog/blog-admin.js, found {len(matches)}'
        )
    return _extract_ids(matches[0])


def main() -> None:
    errors: list[str] = []
    try:
        server_list = parse_server(SERVER.read_text(encoding='utf-8'))
        client_list = parse_client(CLIENT.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        print('[FAIL] runtime-helper strip-list sync')
        print(' - ' + str(exc))
        sys.exit(1)

    if not server_list:
        errors.append('server RUNTIME_HELPER_IDS parsed to an empty list')
    if not client_list:
        errors.append('client strip array parsed to an empty list')

    for label, ids in (
        ('server RUNTIME_HELPER_IDS', server_list),
        ('client _sanitizeForSerialize', client_list),
    ):
        dup = _dupes(ids)
        if dup:
            errors.append(f'{label} has duplicate id(s): ' + ', '.join(dup))

    server = set(server_list)
    client = set(client_list)

    missing_chrome = ADMIN_CHROME - client
    if missing_chrome:
        errors.append(
            'client strip array no longer covers admin chrome: '
            + ', '.join(sorted(missing_chrome))
        )

    client_runtime = client - ADMIN_CHROME
    server_only = server - client_runtime
    client_only = client_runtime - server

    for _id in sorted(server_only):
        errors.append(f'server strips "{_id}" but client (_sanitizeForSerialize) does not')
    for _id in sorted(client_only):
        errors.append(f'client strips "{_id}" but server (RUNTIME_HELPER_IDS) does not')

    if errors:
        print('[FAIL] runtime-helper strip-list sync (blog-admin.js ↔ api/admin/_save.js)')
        for err in errors:
            print(' - ' + err)
        print('   Fix: add/remove the id in BOTH lists so they stay identical.')
        sys.exit(1)

    print(f'[OK] runtime-helper strip lists in sync ({len(server)} runtime + {len(ADMIN_CHROME)} chrome ids)')


if __name__ == '__main__':
    main()
