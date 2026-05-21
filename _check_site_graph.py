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
PERSON_ID = f'{DOMAIN}/about#person'

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

STATIC_EXPECTED = {
    'tools.html': {
        'path': '/tools',
        'website_id': f'{DOMAIN}/#website',
        'page_types': {'WebApplication'},
        'page_id_suffix': '#webpage',
        'main_entity': '#tool-list',
        'item_list_id': '#tool-list',
    },
    'notes.html': {
        'path': '/notes',
        'website_id': f'{DOMAIN}/#website',
        'page_types': {'CollectionPage'},
        'page_id_suffix': '#webpage',
        'main_entity': '#course',
    },
    'privacy.html': {
        'path': '/privacy',
        'website_id': f'{DOMAIN}/#website',
        'page_types': {'WebPage'},
        'page_id_suffix': '#webpage',
    },
    'about.html': {
        'path': '/about',
        'website_id': f'{DOMAIN}/#website',
        'page_types': {'ProfilePage'},
        'page_id_suffix': '#profilepage',
    },
    'en/tools.html': {
        'path': '/en/tools',
        'website_id': f'{DOMAIN}/en#website',
        'page_types': {'WebApplication'},
        'page_id_suffix': '#webpage',
        'main_entity': '#tool-list',
        'item_list_id': '#tool-list',
    },
    'en/notes.html': {
        'path': '/en/notes',
        'website_id': f'{DOMAIN}/en#website',
        'page_types': {'CollectionPage'},
        'page_id_suffix': '#webpage',
        'main_entity': '#course',
    },
    'en/privacy.html': {
        'path': '/en/privacy',
        'website_id': f'{DOMAIN}/en#website',
        'page_types': {'WebPage'},
        'page_id_suffix': '#webpage',
    },
    'en/about.html': {
        'path': '/en/about',
        'website_id': f'{DOMAIN}/en#website',
        'page_types': {'ProfilePage'},
        'page_id_suffix': '#profilepage',
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


def ref_id(value) -> str:
    return str(value.get('@id') or '') if isinstance(value, dict) else str(value or '')


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


def audit_static(rel: str, expected: dict[str, object]) -> list[str]:
    path = ROOT / rel
    errors: list[str] = []
    if not path.exists():
        return [f'{rel}: file missing']
    try:
        blocks = jsonld_blocks(path)
    except Exception as exc:
        return [f'{rel}: JSON-LD parse error: {exc}']

    page_path = str(expected['path'])
    page_url = f'{DOMAIN}{page_path}'
    page_id = f"{page_url}{expected['page_id_suffix']}"
    breadcrumb_id = f'{page_url}#breadcrumb'
    page_blocks = [b for b in blocks if type_names(b) & set(expected['page_types']) and b.get('url') == page_url]
    breadcrumb = [b for b in blocks if 'BreadcrumbList' in type_names(b) and b.get('@id') == breadcrumb_id]

    if len(page_blocks) != 1:
        errors.append(f'{rel}: expected exactly one primary page schema for {page_url}')
    else:
        page = page_blocks[0]
        if page.get('@id') != page_id:
            errors.append(f'{rel}: primary page @id mismatch')
        if ref_id(page.get('isPartOf')) != expected['website_id']:
            errors.append(f'{rel}: primary page isPartOf mismatch')
        if ref_id(page.get('breadcrumb')) != breadcrumb_id:
            errors.append(f'{rel}: primary page breadcrumb should reference BreadcrumbList')
        if ref_id(page.get('publisher')) != PERSON_ID:
            errors.append(f'{rel}: primary page publisher should reference Person')
        if ref_id(page.get('reviewedBy')) != PERSON_ID:
            errors.append(f'{rel}: primary page reviewedBy should reference Person')
        if expected.get('main_entity') and ref_id(page.get('mainEntity')) != f"{page_url}{expected['main_entity']}":
            errors.append(f'{rel}: primary page mainEntity mismatch')

    if len(breadcrumb) != 1:
        errors.append(f'{rel}: expected exactly one connected BreadcrumbList')
    else:
        items = breadcrumb[0].get('itemListElement')
        if not isinstance(items, list) or len(items) < 2:
            errors.append(f'{rel}: BreadcrumbList should have at least 2 items')
        elif not isinstance(items[-1], dict) or items[-1].get('item') != page_url:
            errors.append(f'{rel}: BreadcrumbList leaf item mismatch')

    if expected.get('item_list_id'):
        item_id = f"{page_url}{expected['item_list_id']}"
        item_lists = [b for b in blocks if 'ItemList' in type_names(b) and b.get('@id') == item_id]
        if len(item_lists) != 1:
            errors.append(f'{rel}: expected exactly one connected ItemList')
        else:
            item_list = item_lists[0]
            if ref_id(item_list.get('mainEntityOfPage')) != page_id:
                errors.append(f'{rel}: ItemList mainEntityOfPage mismatch')
            if ref_id(item_list.get('isPartOf')) != expected['website_id']:
                errors.append(f'{rel}: ItemList isPartOf mismatch')

    return errors


def main() -> int:
    errors: list[str] = []
    for rel, expected in EXPECTED.items():
        errors.extend(audit(rel, expected))
    for rel, expected in STATIC_EXPECTED.items():
        errors.extend(audit_static(rel, expected))
    if errors:
        print('[FAIL] site graph audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1
    print('[OK] site graph audit passed: bilingual homepages expose WebSite.hasPart entry graph')
    return 0


if __name__ == '__main__':
    sys.exit(main())
