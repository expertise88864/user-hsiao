#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit OpenSearch discovery metadata for public pages."""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
OPENSEARCH = ROOT / 'opensearch.xml'
LINK = '<link rel="search" type="application/opensearchdescription+xml" title="HsiaoEye Search" href="/opensearch.xml" />'


def parse_catalog() -> list[str]:
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('[FAIL] DN.ARTICLES not found')
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return [slug for slug in re.findall(r"slug:\s*'([^']+)'", m.group(1)) if slug not in stubs]


def public_html_files() -> list[Path]:
    static = [
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
    paths = [ROOT / rel for rel in static]
    for slug in parse_catalog():
        paths.append(ROOT / 'blog' / f'{slug}.html')
        paths.append(ROOT / 'en' / 'blog' / f'{slug}.html')
    return [path for path in paths if path.exists()]


def main() -> int:
    errors: list[str] = []
    if not OPENSEARCH.exists():
        errors.append('opensearch.xml missing')
    else:
        try:
            root = ET.fromstring(OPENSEARCH.read_text(encoding='utf-8'))
        except ET.ParseError as exc:
            errors.append(f'opensearch.xml parse error: {exc}')
            root = None
        if root is not None:
            ns = {'os': 'http://a9.com/-/spec/opensearch/1.1/'}
            short = root.findtext('os:ShortName', default='', namespaces=ns).strip()
            desc = root.findtext('os:Description', default='', namespaces=ns).strip()
            search_form = root.findtext('os:SearchForm', default='', namespaces=ns).strip()
            urls = root.findall('os:Url', ns)
            html_urls = [u for u in urls if u.get('type') == 'text/html']
            if short != 'HsiaoEye':
                errors.append('opensearch.xml ShortName should be HsiaoEye')
            if len(desc) < 40:
                errors.append('opensearch.xml Description is too short')
            if search_form != f'{DOMAIN}/blog':
                errors.append('opensearch.xml SearchForm should point to /blog')
            if not html_urls:
                errors.append('opensearch.xml missing text/html Url template')
            elif html_urls[0].get('template') != f'{DOMAIN}/blog?q={{searchTerms}}':
                errors.append('opensearch.xml text/html template should use /blog?q={searchTerms}')

    for path in public_html_files():
        src = path.read_text(encoding='utf-8')
        rel = path.relative_to(ROOT).as_posix()
        if LINK not in src:
            errors.append(f'{rel}: missing rel=search OpenSearch link')
        if src.count('rel="search"') != 1:
            errors.append(f'{rel}: expected exactly one rel=search link')

    if errors:
        print('[FAIL] OpenSearch audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1

    print(f'[OK] OpenSearch audit passed: {len(public_html_files())} public pages advertise /opensearch.xml')
    return 0


if __name__ == '__main__':
    sys.exit(main())
