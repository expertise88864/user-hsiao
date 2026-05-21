#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit WebSite hasPart graph entries on bilingual homepages."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'

EXPECTED = {
    'index.html': {
        'id': f'{DOMAIN}/#website',
        'lang': 'zh-Hant-TW',
        'paths': ['/blog', '/blog/topics', '/tools', '/notes', '/about', '/privacy'],
    },
    'en/index.html': {
        'id': f'{DOMAIN}/en#website',
        'lang': 'en',
        'paths': ['/en/blog', '/en/blog/topics', '/en/tools', '/en/notes', '/en/about', '/en/privacy'],
    },
}


def type_names(obj: dict) -> set[str]:
    value = obj.get('@type')
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def jsonld_blocks(path: Path) -> list[dict]:
    out = []
    src = path.read_text(encoding='utf-8')
    for raw in re.findall(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>', src, re.S):
        data = json.loads(raw.strip())
        if isinstance(data, dict):
            out.append(data)
    return out


def audit(rel: str, expected: dict[str, object]) -> list[str]:
    path = ROOT / rel
    errors: list[str] = []
    if not path.exists():
        return [f'{rel}: file missing']
    try:
        blocks = jsonld_blocks(path)
    except Exception as exc:
        return [f'{rel}: JSON-LD parse error: {exc}']

    website = [b for b in blocks if 'WebSite' in type_names(b) and b.get('@id') == expected['id']]
    if len(website) != 1:
        return [f'{rel}: expected exactly one matching WebSite schema']

    parts = website[0].get('hasPart')
    if not isinstance(parts, list):
        return [f'{rel}: WebSite hasPart must be a list']
    if len(parts) != len(expected['paths']):
        errors.append(f'{rel}: expected {len(expected["paths"])} hasPart entries, found {len(parts)}')

    seen_urls = []
    for item in parts:
        if not isinstance(item, dict):
            errors.append(f'{rel}: hasPart item is not an object')
            continue
        url = str(item.get('url') or '')
        seen_urls.append(url)
        if item.get('inLanguage') != expected['lang']:
            errors.append(f'{rel}: {url} inLanguage mismatch')
        if item.get('isAccessibleForFree') is not True:
            errors.append(f'{rel}: {url} should be isAccessibleForFree')
        if len(str(item.get('name') or '')) < 4:
            errors.append(f'{rel}: {url} name missing/too short')
        if len(str(item.get('description') or '')) < 20:
            errors.append(f'{rel}: {url} description missing/too short')
        if not str(item.get('@id') or '').endswith('#webpage'):
            errors.append(f'{rel}: {url} @id should end with #webpage')

    expected_urls = [f'{DOMAIN}{p}' for p in expected['paths']]
    if seen_urls != expected_urls:
        errors.append(f'{rel}: hasPart URLs mismatch ({seen_urls!r})')
    return errors


def main() -> int:
    errors: list[str] = []
    for rel, expected in EXPECTED.items():
        errors.extend(audit(rel, expected))
    if errors:
        print('[FAIL] site graph audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1
    print('[OK] site graph audit passed: bilingual homepages expose WebSite.hasPart entry graph')
    return 0


if __name__ == '__main__':
    sys.exit(main())
