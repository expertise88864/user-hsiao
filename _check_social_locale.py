#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit Open Graph locale pairs for bilingual public pages."""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent

STATIC_PUBLIC = [
    'index.html',
    'about.html',
    'notes.html',
    'privacy.html',
    'tools.html',
    'blog/index.html',
    'blog/topics.html',
    'en/index.html',
    'en/about.html',
    'en/notes.html',
    'en/privacy.html',
    'en/tools.html',
    'en/blog/index.html',
    'en/blog/topics.html',
]


def parse_catalog() -> list[str]:
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('[FAIL] DN.ARTICLES not found')
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return [slug for slug in re.findall(r"slug:\s*'([^']+)'", m.group(1)) if slug not in stubs]


def meta_content(src: str, key: str) -> str:
    m = re.search(rf'<meta\s+property="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else ''


def public_files() -> list[str]:
    files = list(STATIC_PUBLIC)
    for slug in parse_catalog():
        files.append(f'blog/{slug}.html')
        files.append(f'en/blog/{slug}.html')
    return files


def main() -> int:
    errors: list[str] = []
    for rel in public_files():
        path = ROOT / rel
        if not path.exists():
            errors.append(f'{rel}: file missing')
            continue
        src = path.read_text(encoding='utf-8')
        expected_locale = 'en_US' if rel.startswith('en/') else 'zh_TW'
        expected_alt = 'zh_TW' if rel.startswith('en/') else 'en_US'
        locale = meta_content(src, 'og:locale')
        alternate = meta_content(src, 'og:locale:alternate')
        if locale != expected_locale:
            errors.append(f'{rel}: og:locale is {locale!r}, expected {expected_locale!r}')
        if alternate != expected_alt:
            errors.append(f'{rel}: og:locale:alternate is {alternate!r}, expected {expected_alt!r}')
        if src.count('property="og:locale"') != 1:
            errors.append(f'{rel}: expected exactly one og:locale tag')
        if src.count('property="og:locale:alternate"') != 1:
            errors.append(f'{rel}: expected exactly one og:locale:alternate tag')

    if errors:
        print('[FAIL] social locale audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1

    print(f'[OK] social locale audit passed: {len(public_files())} public pages expose bilingual OG locale pairs')
    return 0


if __name__ == '__main__':
    sys.exit(main())
