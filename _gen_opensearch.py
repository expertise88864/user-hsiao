"""
Generate OpenSearch discovery metadata and inject rel=search links.

OpenSearch lets browsers and search tools discover the site's article search
endpoint. It is a small crawler-facing affordance, but it keeps HsiaoEye's
public search surface explicit instead of relying only on visible UI.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
TITLE = 'HsiaoEye Search'
LINK = '<link rel="search" type="application/opensearchdescription+xml" title="HsiaoEye Search" href="/opensearch.xml" />'


def parse_catalog() -> list[str]:
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('DN.ARTICLES not found')
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    slugs = re.findall(r"slug:\s*'([^']+)'", m.group(1))
    return [slug for slug in slugs if slug not in stubs]


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


def build_xml() -> str:
    search_url = f'{DOMAIN}/blog?q={{searchTerms}}'
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
        '  <ShortName>HsiaoEye</ShortName>',
        f'  <Description>{html.escape("Search HsiaoEye ophthalmology patient-education articles")}</Description>',
        '  <Tags>ophthalmology eye health patient education dry eye myopia cataract glaucoma retina</Tags>',
        '  <InputEncoding>UTF-8</InputEncoding>',
        '  <OutputEncoding>UTF-8</OutputEncoding>',
        f'  <Image height="16" width="16" type="image/png">{DOMAIN}/icon-16.png</Image>',
        f'  <Image height="32" width="32" type="image/png">{DOMAIN}/icon-32.png</Image>',
        f'  <Url type="text/html" method="get" template="{html.escape(search_url, quote=True)}" />',
        f'  <SearchForm>{DOMAIN}/blog</SearchForm>',
        '</OpenSearchDescription>',
        '',
    ]
    return '\n'.join(lines)


def inject_link(path: Path) -> bool:
    src = path.read_text(encoding='utf-8')
    search_re = re.compile(r'\n?<link\s+rel="search"\s+type="application/opensearchdescription\+xml"[^>]*>\n?', re.I)
    cleaned = search_re.sub('\n', src)
    if LINK in cleaned:
        return False

    anchor = re.search(r'<link\s+rel="alternate"\s+type="application/atom\+xml"[^>]*>\s*', cleaned, re.I)
    if anchor:
        out = cleaned[:anchor.end()] + LINK + '\n' + cleaned[anchor.end():]
    else:
        out = cleaned.replace('</head>', LINK + '\n</head>', 1)
    if out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def main() -> int:
    xml_path = ROOT / 'opensearch.xml'
    xml = build_xml()
    changed = []
    if not xml_path.exists() or xml_path.read_text(encoding='utf-8') != xml:
        xml_path.write_text(xml, encoding='utf-8')
        changed.append('opensearch.xml')

    for path in public_html_files():
        if inject_link(path):
            changed.append(path.relative_to(ROOT).as_posix())

    print(f'Generated OpenSearch metadata; updated {len(changed)} file(s)')
    for rel in changed:
        print(f'  - {rel}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
