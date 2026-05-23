"""
HsiaoEye — verify /llms.txt stays complete and crawler-safe.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
LLMS = ROOT / 'llms.txt'


def text_integrity_errors(src: str) -> list[str]:
    errors: list[str] = []
    if '\ufeff' in src:
        errors.append('contains UTF-8 BOM')
    if '\ufffd' in src:
        errors.append('contains Unicode replacement character U+FFFD')
    if '????' in src:
        errors.append('contains repeated question marks, likely encoding loss')

    private = sorted({f'U+{ord(c):04X}' for c in src if 0xE000 <= ord(c) <= 0xF8FF})
    if private:
        errors.append('contains private-use characters: ' + ', '.join(private[:6]))

    c1_controls = sorted({f'U+{ord(c):04X}' for c in src if 0x80 <= ord(c) <= 0x9F})
    if c1_controls:
        errors.append('contains C1 control characters: ' + ', '.join(c1_controls[:6]))
    return errors


def parse_catalog():
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('[FAIL] DN.ARTICLES not found')
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1)))
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return sorted(slugs - stubs), sorted(stubs)


def same_site_path(url: str) -> str | None:
    if not url.startswith(DOMAIN):
        return None
    path = url[len(DOMAIN):] or '/'
    return path.split('?', 1)[0].split('#', 1)[0]


def path_exists(path: str) -> bool:
    if path == '/':
        return (ROOT / 'index.html').exists()
    clean = path.strip('/')
    candidates = [
        ROOT / f'{clean}.html',
        ROOT / clean / 'index.html',
        ROOT / clean,
    ]
    return any(p.exists() for p in candidates)


def main() -> int:
    published, stubs = parse_catalog()
    errors = []
    if not LLMS.exists():
        print('[FAIL] llms.txt missing')
        return 1

    src = LLMS.read_text(encoding='utf-8')
    for err in text_integrity_errors(src):
        errors.append(err)
    if not src.startswith('# HsiaoEye'):
        errors.append('missing # HsiaoEye heading')
    if 'Medical disclaimer' not in src:
        errors.append('missing medical disclaimer guidance')
    if f'{DOMAIN}/sitemap.xml' not in src:
        errors.append('missing sitemap link')
    if '## Machine-Readable Feeds' not in src:
        errors.append('missing machine-readable feeds section')
    required_feeds = {
        'RSS Feed': f'{DOMAIN}/blog/feed.xml',
        'Atom Feed': f'{DOMAIN}/blog/atom.xml',
        'JSON Feed': f'{DOMAIN}/blog/feed.json',
        'OpenSearch Description': f'{DOMAIN}/opensearch.xml',
        'Bilingual Search Index': f'{DOMAIN}/assets/search-index.json',
    }
    for label, url in required_feeds.items():
        if url not in src:
            errors.append(f'missing {label} link: {url}')

    for slug in published:
        if f'{DOMAIN}/blog/{slug}' not in src:
            errors.append(f'missing canonical article URL: {slug}')
        if f'{DOMAIN}/en/blog/{slug}' not in src:
            errors.append(f'missing English article URL: {slug}')
    for slug in stubs:
        if f'/blog/{slug}' in src:
            errors.append(f'stub article leaked into llms.txt: {slug}')

    for url in re.findall(r'https://hsiao\.chendermatologist\.com[^\s)]+', src):
        path = same_site_path(url.rstrip('.,'))
        if path is None:
            continue
        if path.startswith(('/admin', '/api', '/reset-sw', '/en/reset-sw')):
            errors.append(f'private/disallowed path linked: {path}')
        if path.endswith(('.xml', '.txt', '.json')):
            continue
        if not path_exists(path):
            errors.append(f'linked path has no file: {path}')

    if errors:
        print('[FAIL] llms.txt audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1

    print(f'[OK] llms.txt audit passed — {len(published)} published articles indexed in both locales')
    return 0


if __name__ == '__main__':
    sys.exit(main())
