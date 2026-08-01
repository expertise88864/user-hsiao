#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard A-01: a skip link must lead somewhere on the page it sits on.

`_apply_i_series.py` injects the same skip nav everywhere, and its output is
SENTINEL-frozen, so a page that never had #hs-related kept a keyboard focus stop
that goes nowhere. `_normalize_skiplinks.py` prunes them; this makes the pruning
stick.

WHY NOT JUST WIDEN _check_dead_anchors.py
    That checker allow-lists `hs-related` and a dozen other ids, and the
    allow-list is CORRECT for its scope: those anchors are injected by
    blog-shared.js at runtime, so a whole-document anchor check would false-
    positive on every article. This check is narrower on purpose — it looks ONLY
    inside the skip nav, where the static HTML of the article pages does carry
    `id="hs-related"`, so there is no dynamic-injection ambiguity to resolve.

Matching note: the nav is matched without assuming attribute ORDER, because
_gen_en_pages.py re-serialises the /en/ mirrors through BeautifulSoup and the
attributes come back in a different order. A pattern anchored on `class` being
first silently skipped all 11 /en/ pages while reporting success.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAV_RE = re.compile(r'<nav\b[^>]*\bclass="hs-skiplinks"[^>]*>([\s\S]*?)</nav>', re.I)
LINK_RE = re.compile(r'<a\s[^>]*href="#([A-Za-z0-9_-]+)"', re.I)
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'tests', '_cms'}


def main() -> int:
    errors: list[str] = []
    navs = links = 0

    files = [p for p in sorted(ROOT.rglob('*.html'))
             if not any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts)]
    for path in files:
        html = path.read_text(encoding='utf-8')
        rel = path.relative_to(ROOT).as_posix()
        for nav in NAV_RE.finditer(html):
            navs += 1
            for target in LINK_RE.findall(nav.group(1)):
                links += 1
                if not re.search(rf'id="{re.escape(target)}"', html):
                    errors.append(f'{rel}: skip link points at #{target}, which this '
                                  f'page does not contain — a keyboard user tabs to a '
                                  f'stop that goes nowhere (run _normalize_skiplinks.py)')

    if not navs:
        print('[FAIL] found no hs-skiplinks nav at all — this check would pass '
              'vacuously, so treat it as a failure')
        return 1

    if errors:
        print('[FAIL] skip-link audit found dead targets:')
        for e in errors[:30]:
            print(' -', e)
        if len(errors) > 30:
            print(f' ... {len(errors) - 30} more')
        return 1

    print(f'[OK] skip links: {links} link(s) across {navs} nav(s) in {len(files)} '
          f'files, every target present on its own page')
    return 0


if __name__ == '__main__':
    sys.exit(main())
