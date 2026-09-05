#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard M-13: JSON-LD embedded in <script> must never carry a raw `<`.

Two assertions, because either one alone rots:

  1. OUTPUT — no generated ld+json block may contain a raw `<`. This is the
     invariant that actually matters, and it is checked against the built HTML.
  2. SOURCE — no generator that emits ld+json may build that output with a bare
     `json.dumps`. Without this, the output check passes vacuously the moment a
     new generator is added whose content happens to contain none of those
     characters yet, and the gap only surfaces when a title finally does.

The source check deliberately ignores `sort_keys=True` calls: those are internal
equality comparisons in _gen_serp_meta.py / _gen_site_graph.py, and rewriting one
side of a comparison would silently break idempotence.

Scope note: the source check is a text scan for lines that both call json.dumps
and look like they embed the result (they mention `</script>`, `prefix +`,
`open_tag`, `dumped =` or `ld_json =`). A generator that assembles its block in
some other shape would not be spotted — which is why assertion 1 exists.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LD_RE = re.compile(r'<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', re.I)
EMBED_MARKERS = ('</script>', 'prefix +', 'open_tag', 'dumped =', 'ld_json =')
# ONLY `<` is load-bearing. Script content is raw text, so `&` has no special
# meaning there, and the sequences that can end a block early — `</script` and
# `<!--` — all start with `<`. An earlier version of this check also rejected `>`
# and `&`; that produced a FALSE POSITIVE on two hand-authored blocks carrying a
# perfectly legal `&`. _jsonld.py still escapes all three in the output it
# generates (harmless, and conventional for JSON-in-HTML), but the invariant this
# check enforces is the one that actually prevents injection.
UNSAFE = ('<',)


def html_files() -> list[Path]:
    out: list[Path] = []
    for pattern in ('*.html', 'blog/*.html', 'en/*.html', 'en/blog/*.html', 'tools/*.html'):
        out.extend(ROOT.glob(pattern))
    return sorted(out)


def main() -> int:
    errors: list[str] = []
    blocks = 0

    for path in html_files():
        rel = path.relative_to(ROOT).as_posix()
        for m in LD_RE.finditer(path.read_text(encoding='utf-8')):
            body = m.group(1)
            blocks += 1
            if '<' in body:
                errors.append(f"{rel}: a ld+json block contains a raw '<' — it must be "
                              f'escaped (see _jsonld.py). A literal </script> in a title '
                              f'would close the block early and inject markup')
            try:
                json.loads(body)
            except Exception as exc:
                errors.append(f'{rel}: ld+json block does not parse ({exc})')

    if not blocks:
        errors.append('found no ld+json blocks at all — this check would pass '
                      'vacuously, so treat it as a failure')

    for src in sorted(ROOT.glob('_*.py')):
        text = src.read_text(encoding='utf-8', errors='ignore')
        if 'ld+json' not in text and r'ld\+json' not in text:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if 'json.dumps(' not in line or '_jsonld' in line or 'sort_keys=True' in line:
                continue
            if any(mk in line for mk in EMBED_MARKERS):
                errors.append(f'{src.name}:{i}: builds ld+json with a bare json.dumps — '
                              f'route it through _jsonld.dumps/script_block (M-13)')

    if errors:
        print('[FAIL] JSON-LD escaping audit found issues:')
        for e in errors[:40]:
            print(' -', e)
        if len(errors) > 40:
            print(f' ... {len(errors) - 40} more')
        return 1

    print(f'[OK] JSON-LD escaping: {blocks} blocks, none carrying a raw <, '
          f'all parseable; every emitter routes through _jsonld')
    return 0


if __name__ == '__main__':
    sys.exit(main())
