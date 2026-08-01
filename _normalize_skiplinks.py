#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Drop skip-nav links whose target does not exist on the page. (A-01)

WHY
    `_apply_i_series.py` injects the same skip navigation into every page —
    "跳至主要內容", "跳至相關文章" (#hs-related), "跳至訂閱" (#dn-newsletter).
    Only article pages have #hs-related, so on the homepage, /about, /privacy,
    /notes, /tools and the /en/ mirrors a keyboard user tabs to a skip link that
    goes nowhere. Measured: 25 pages for #hs-related, 3 for #dn-newsletter.

WHY A NORMALIZER RATHER THAN A GENERATOR FIX
    `_apply_i_series.patch()` returns early when its SENTINEL is present, so the
    nav is written once and frozen. Making that function conditional would fix
    only pages processed AFTER the change — every existing page keeps its dead
    link. Pruning here, as a chain step that runs over the built HTML, fixes the
    existing pages and any future one, from a single enforcement point.

WHAT IT WILL NOT DO
    It only ever REMOVES a link whose `id` is absent from the same document. It
    never adds, reorders, or rewrites text, and it leaves the nav element in
    place even if it empties out — an empty `<nav>` is inert, whereas deleting
    the element would change the DOM shape other code may rely on.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Attribute ORDER is not stable. _gen_en_pages.py runs the /en/ mirrors through
# BeautifulSoup, which re-serialises the nav with its attributes in a different
# order, so a pattern anchored on `class` being the FIRST attribute silently
# skipped all 11 /en/ pages — the pipeline reshapes the very markup the pattern
# assumed. Match `class` wherever it lands.
SKIP_NAV_RE = re.compile(r'(<nav\b[^>]*\bclass="hs-skiplinks"[^>]*>)([\s\S]*?)(</nav>)', re.I)
LINK_RE = re.compile(r'<a\s[^>]*href="#([A-Za-z0-9_-]+)"[^>]*>[\s\S]*?</a>', re.I)
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'tests', '_cms'}


def html_files() -> list[Path]:
    out = []
    for p in ROOT.rglob('*.html'):
        if any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts):
            continue
        out.append(p)
    return sorted(out)


def prune(html: str) -> tuple[str, int]:
    removed = 0

    def fix_nav(m: re.Match) -> str:
        nonlocal removed

        def drop_if_dead(link: re.Match) -> str:
            nonlocal removed
            target = link.group(1)
            # The id must exist somewhere in the document — anywhere, since the
            # browser scrolls to it regardless of where it sits.
            if re.search(rf'id="{re.escape(target)}"', html):
                return link.group(0)
            removed += 1
            return ''

        return m.group(1) + LINK_RE.sub(drop_if_dead, m.group(2)) + m.group(3)

    return SKIP_NAV_RE.sub(fix_nav, html), removed


def main() -> int:
    files = html_files()
    if not files:
        print('[FAIL] no HTML files found — refusing to report success on an empty sweep')
        return 1

    touched = total = 0
    for path in files:
        src = path.read_text(encoding='utf-8')
        out, removed = prune(src)
        if removed and out != src:
            path.write_text(out, encoding='utf-8')
            touched += 1
            total += removed

    print(f'[OK] skip-links: removed {total} dead link(s) across {touched} file(s) '
          f'of {len(files)} scanned')
    return 0


if __name__ == '__main__':
    sys.exit(main())
