"""
Generate ProfilePage JSON-LD for the author/about pages.

The site already exposes a Person/Physician entity. ProfilePage connects the
public author page itself to that entity, which helps crawlers distinguish
"this is the profile page about the medical reviewer" from ordinary site
metadata.
"""
from __future__ import annotations

import html
import json
import _jsonld  # M-13: JSON-LD must be escaped for <script> embedding
import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
PERSON_ID = f'{DOMAIN}/about#person'
AUTO_RE = re.compile(
    r'\n?<script\s+type="application/ld\+json"\s+data-profile-auto>[\s\S]*?</script>\n?',
    re.I,
)


def meta_content(src: str, key: str, attr: str = 'name') -> str:
    m = re.search(rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else ''


def title_text(src: str) -> str:
    m = re.search(r'<title>([^<]+)</title>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else 'About HsiaoEye'


def image_object(page_url: str, name: str) -> dict[str, object]:
    return {
        '@type': 'ImageObject',
        '@id': f'{page_url}#primaryimage',
        'url': f'{DOMAIN}/SUNN1302.jpg',
        'contentUrl': f'{DOMAIN}/SUNN1302.jpg',
        'name': name,
        'caption': name,
    }


def profile_schema(src: str, path: str, lang: str, website_id: str) -> dict[str, object]:
    page_url = f'{DOMAIN}{path}'
    title = title_text(src)
    desc = meta_content(src, 'description')
    return {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        '@id': f'{page_url}#profilepage',
        'url': page_url,
        'name': title,
        'description': desc,
        'inLanguage': lang,
        'isPartOf': {'@id': website_id},
        'mainEntity': {'@id': PERSON_ID},
        'about': {'@id': PERSON_ID},
        'primaryImageOfPage': image_object(page_url, title),
        'publisher': {'@id': PERSON_ID},
        'reviewedBy': {'@id': PERSON_ID},
    }


def upsert_profile(path: Path, canonical_path: str, lang: str, website_id: str) -> bool:
    src = path.read_text(encoding='utf-8')
    block = (
        '<script type="application/ld+json" data-profile-auto>'
        + _jsonld.dumps(profile_schema(src, canonical_path, lang, website_id), ensure_ascii=False, separators=(',', ':'))
        + '</script>'
    )
    cleaned = AUTO_RE.sub('\n', src)
    if block in cleaned:
        return False

    # Keep ProfilePage near the existing Person schema for easier review.
    person_match = re.search(
        r'(<script\s+type="application/ld\+json"[^>]*>[\s\S]*?"@type"\s*:\s*\[[\s\S]*?"Physician"[\s\S]*?</script>)',
        cleaned,
        re.I,
    )
    if person_match:
        out = cleaned[:person_match.end()] + '\n' + block + cleaned[person_match.end():]
    else:
        out = cleaned.replace('</head>', block + '\n</head>', 1)

    if out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def main() -> int:
    changed = []
    targets = [
        (ROOT / 'about.html', '/about', 'zh-Hant-TW', f'{DOMAIN}/#website'),
        (ROOT / 'en' / 'about.html', '/en/about', 'en', f'{DOMAIN}/en#website'),
    ]
    for path, canonical_path, lang, website_id in targets:
        if path.exists() and upsert_profile(path, canonical_path, lang, website_id):
            changed.append(path.relative_to(ROOT).as_posix())

    print(f'Generated ProfilePage schema in {len(changed)} file(s)')
    for rel in changed:
        print(f'  - {rel}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
