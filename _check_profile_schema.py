#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit ProfilePage JSON-LD on bilingual About pages."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
PERSON_ID = f'{DOMAIN}/about#person'


def type_names(obj: dict) -> set[str]:
    value = obj.get('@type')
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def ref_id(value) -> str:
    return str(value.get('@id') or '') if isinstance(value, dict) else str(value or '')


def jsonld_blocks(path: Path) -> list[dict]:
    src = path.read_text(encoding='utf-8')
    out = []
    for raw in re.findall(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>', src, re.S):
        data = json.loads(raw.strip())
        if isinstance(data, dict):
            out.append(data)
    return out


def audit(rel: str, canonical_path: str, lang: str, website_id: str) -> list[str]:
    path = ROOT / rel
    errors: list[str] = []
    if not path.exists():
        return [f'{rel}: file missing']
    try:
        blocks = jsonld_blocks(path)
    except Exception as exc:
        return [f'{rel}: JSON-LD parse error: {exc}']

    person = [b for b in blocks if 'Physician' in type_names(b)]
    profile = [b for b in blocks if 'ProfilePage' in type_names(b)]
    page_url = f'{DOMAIN}{canonical_path}'

    if len(person) != 1:
        errors.append(f'{rel}: expected exactly one Person/Physician schema')
    elif person[0].get('@id') != PERSON_ID:
        errors.append(f'{rel}: Person @id should be {PERSON_ID}')

    if len(profile) != 1:
        errors.append(f'{rel}: expected exactly one ProfilePage schema')
        return errors

    p = profile[0]
    if p.get('@id') != f'{page_url}#profilepage':
        errors.append(f'{rel}: ProfilePage @id mismatch')
    if p.get('url') != page_url:
        errors.append(f'{rel}: ProfilePage url mismatch')
    if p.get('inLanguage') != lang:
        errors.append(f'{rel}: ProfilePage inLanguage mismatch')
    if ref_id(p.get('mainEntity')) != PERSON_ID:
        errors.append(f'{rel}: ProfilePage mainEntity should reference Person')
    if ref_id(p.get('about')) != PERSON_ID:
        errors.append(f'{rel}: ProfilePage about should reference Person')
    if ref_id(p.get('publisher')) != PERSON_ID:
        errors.append(f'{rel}: ProfilePage publisher should reference Person')
    if ref_id(p.get('reviewedBy')) != PERSON_ID:
        errors.append(f'{rel}: ProfilePage reviewedBy should reference Person')
    if ref_id(p.get('isPartOf')) != website_id:
        errors.append(f'{rel}: ProfilePage isPartOf mismatch')
    image = p.get('primaryImageOfPage')
    if not isinstance(image, dict) or not str(image.get('url', '')).endswith('/SUNN1302.jpg'):
        errors.append(f'{rel}: ProfilePage primaryImageOfPage should point to SUNN1302.jpg')
    if len(str(p.get('description') or '')) < 50:
        errors.append(f'{rel}: ProfilePage description missing/too short')
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(audit('about.html', '/about', 'zh-Hant-TW', f'{DOMAIN}/#website'))
    errors.extend(audit('en/about.html', '/en/about', 'en', f'{DOMAIN}/en#website'))
    if errors:
        print('[FAIL] ProfilePage schema audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1
    print('[OK] ProfilePage schema audit passed: bilingual About pages connect ProfilePage to Physician entity')
    return 0


if __name__ == '__main__':
    sys.exit(main())
