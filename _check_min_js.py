#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — guard that blog/blog-shared.min.js is present and not stale
relative to its readable source blog/blog-shared.js.

Why: pages ship the esbuild-minified blog-shared.min.js (≈177 KB vs the
300 KB source). The readable blog-shared.js stays committed because every
generator/checker parses DN.ARTICLES out of it with regexes that rely on
the un-minified formatting. If someone edits blog-shared.js (e.g. adds an
article to DN.ARTICLES) but forgets to run `npm run minify`, the served
bundle goes stale.

This is a pure-Python proxy check (CI's drift job has no esbuild): it does
NOT re-minify. It asserts the min bundle exists, is meaningfully smaller,
carries the SAME DN.ARTICLES slugs + DN.STUB_SLUGS as the source, and
still contains the key DN.* entry points. That catches the common
"edited source, forgot to regen" mistake. After editing blog-shared.js,
run:  npm run minify
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'blog', 'blog-shared.js')
MIN = os.path.join(ROOT, 'blog', 'blog-shared.min.js')

# Quote-agnostic: esbuild may rewrite '...' to "..." in the minified file.
SLUG_RE = re.compile(r'slug:["\']([a-z0-9-]+)["\']')
STUB_RE = re.compile(r'(?<!EN_)STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([^\]]*)\]', re.DOTALL)
EN_STUB_RE = re.compile(r'EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([^\]]*)\]', re.DOTALL)
# Property names survive esbuild minification (only the local `DN` alias is
# renamed, e.g. DN.ARTICLES → n.ARTICLES), so check bare property identifiers.
KEY_SYMBOLS = ('.ARTICLES', 'initBlog', 'applyTextOnly', 'injectBreadcrumb', 'window.DN')


def slugs(text: str) -> set[str]:
    return set(SLUG_RE.findall(text))


def stub_slugs(text: str, pattern: re.Pattern[str] = STUB_RE) -> set[str]:
    m = pattern.search(text)
    return set(re.findall(r'["\']([a-z0-9-]+)["\']', m.group(1))) if m else set()


def main() -> int:
    errors = []

    if not os.path.exists(SRC):
        print('[FAIL] blog/blog-shared.js (source) missing')
        return 1
    if not os.path.exists(MIN):
        print('[FAIL] blog/blog-shared.min.js missing — run: npm run minify')
        return 1

    src = open(SRC, encoding='utf-8').read()
    mn = open(MIN, encoding='utf-8').read()
    src_sz, min_sz = len(src.encode('utf-8')), len(mn.encode('utf-8'))

    # 1) Minified must be meaningfully smaller (sanity: real minification ran).
    if min_sz >= src_sz * 0.9:
        errors.append(
            f'min.js ({min_sz} B) is not meaningfully smaller than source '
            f'({src_sz} B) — minification may not have run')

    # 2) DN.ARTICLES slug set must match (catches "added article, forgot regen").
    s_slugs, m_slugs = slugs(src), slugs(mn)
    if s_slugs != m_slugs:
        missing = s_slugs - m_slugs
        extra = m_slugs - s_slugs
        errors.append(
            f'DN.ARTICLES slugs differ source↔min — STALE min bundle. '
            f'Run: npm run minify  (missing in min: {sorted(missing)}; '
            f'extra in min: {sorted(extra)})')

    # 3) STUB_SLUGS set must match too.
    if stub_slugs(src) != stub_slugs(mn):
        errors.append('DN.STUB_SLUGS differ source↔min — run: npm run minify')

    # 4) EN_STUB_SLUGS set must match too.
    if stub_slugs(src, EN_STUB_RE) != stub_slugs(mn, EN_STUB_RE):
        errors.append('DN.EN_STUB_SLUGS differ source/min - run: npm run minify')

    # 5) Key entry points survived minification.
    for sym in KEY_SYMBOLS:
        if sym not in mn:
            errors.append(f'min.js missing key symbol {sym!r} — bad minify output')

    if errors:
        print('[FAIL] blog-shared.min.js audit failed:')
        for e in errors:
            print(f'  - {e}')
        return 1

    print(f'[OK] blog-shared.min.js audit passed — '
          f'{min_sz // 1024} KB min vs {src_sz // 1024} KB source, '
          f'{len(m_slugs)} articles in sync')
    return 0


if __name__ == '__main__':
    sys.exit(main())
