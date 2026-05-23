"""
HsiaoEye — fail when public search/social snippets are missing or unusable.

Search engines may rewrite snippets, but pages should still expose a sensible
fallback meta description plus OpenGraph/Twitter descriptions for sharing.
"""
from __future__ import annotations

import html
import importlib.util
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'

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


def parse_catalog():
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('[FAIL] DN.ARTICLES not found')
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1)))
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return sorted(slugs - stubs)


def meta_content(src: str, key: str, attr: str = 'name') -> str:
    m = re.search(rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else ''


def unusable(value: str, min_len: int, max_len: int) -> str:
    if not value:
        return 'missing'
    if len(value) < min_len:
        return f'too short ({len(value)} chars)'
    if len(value) > max_len:
        return f'too long ({len(value)} chars)'
    if value.count('?') >= 8 or '????' in value:
        return 'contains mojibake question-mark run'
    return ''


def unusable_image_alt(value: str) -> str:
    if not value:
        return 'missing'
    if len(value) < 8:
        return f'too short ({len(value)} chars)'
    if len(value) > 240:
        return f'too long ({len(value)} chars)'
    if '\ufffd' in value or value.count('?') >= 8 or '????' in value:
        return 'contains mojibake'
    return ''


def social_image_errors(src: str, rel: str) -> list[str]:
    errors = []
    og_image = meta_content(src, 'og:image', attr='property')
    twitter_image = meta_content(src, 'twitter:image', attr='name')
    if not og_image:
        errors.append(f'{rel}: og:image missing')
    elif not og_image.startswith(DOMAIN + '/'):
        errors.append(f'{rel}: og:image must be an absolute same-origin HTTPS URL')

    if not twitter_image:
        errors.append(f'{rel}: twitter:image missing')
    elif og_image and twitter_image != og_image:
        errors.append(f'{rel}: twitter:image must match og:image')

    if meta_content(src, 'og:image:width', attr='property') != '1200':
        errors.append(f'{rel}: og:image:width must be 1200')
    if meta_content(src, 'og:image:height', attr='property') != '630':
        errors.append(f'{rel}: og:image:height must be 630')

    og_alt_msg = unusable_image_alt(meta_content(src, 'og:image:alt', attr='property'))
    if og_alt_msg:
        errors.append(f'{rel}: og:image:alt {og_alt_msg}')
    twitter_alt_msg = unusable_image_alt(meta_content(src, 'twitter:image:alt', attr='name'))
    if twitter_alt_msg:
        errors.append(f'{rel}: twitter:image:alt {twitter_alt_msg}')
    return errors


def audit_file(rel: str, is_article: bool) -> list[str]:
    path = ROOT / rel
    if not path.exists():
        return [f'{rel}: file missing']
    src = path.read_text(encoding='utf-8')
    errors = []
    limits = {
        'description': (70, 220) if is_article else (50, 220),
        'og:description': (70, 240) if is_article else (50, 240),
        'twitter:description': (70, 240) if is_article else (50, 240),
    }
    checks = [
        ('description', 'name'),
        ('og:description', 'property'),
        ('twitter:description', 'name'),
    ]
    for key, attr in checks:
        msg = unusable(meta_content(src, key, attr=attr), *limits[key])
        if msg:
            errors.append(f'{rel}: {key} {msg}')
    if meta_content(src, 'twitter:card') != 'summary_large_image':
        errors.append(f'{rel}: twitter:card must be summary_large_image')
    errors.extend(social_image_errors(src, rel))
    return errors


def audit_generator_fallbacks() -> list[str]:
    path = ROOT / '_gen_serp_meta.py'
    spec = importlib.util.spec_from_file_location('_gen_serp_meta_for_audit', path)
    if not spec or not spec.loader:
        return ['_gen_serp_meta.py: unable to import generator']
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    errors = []
    try:
        published = {row['slug'] for row in module.read_catalog()}
    except Exception as exc:
        errors.append(f'_gen_serp_meta.py: unable to read article catalog ({exc})')
        published = set()

    article_keys = set(getattr(module, 'ARTICLE_SNIPPETS', {}).keys())
    if published:
        missing = sorted(published - article_keys)
        extra = sorted(article_keys - published)
        for slug in missing:
            errors.append(f'_gen_serp_meta.py: ARTICLE_SNIPPETS missing published slug {slug!r}')
        for slug in extra:
            errors.append(f'_gen_serp_meta.py: ARTICLE_SNIPPETS has non-published slug {slug!r}')

    static_keys = set(getattr(module, 'STATIC_SNIPPETS', {}).keys())
    required_static = {'index.html', 'about.html', 'notes.html', 'privacy.html', 'tools.html', 'blog/index.html', 'blog/topics.html'}
    for rel in sorted(required_static - static_keys):
        errors.append(f'_gen_serp_meta.py: STATIC_SNIPPETS missing {rel!r}')

    for dict_name, is_article in (('ARTICLE_SNIPPETS', True), ('STATIC_SNIPPETS', False)):
        values = getattr(module, dict_name, {})
        if not isinstance(values, dict):
            errors.append(f'_gen_serp_meta.py: {dict_name} is not a dict')
            continue
        min_len, max_len = (70, 240) if is_article else (50, 240)
        for key, value in values.items():
            msg = unusable(str(value), min_len, max_len)
            if msg:
                errors.append(f'_gen_serp_meta.py: {dict_name}[{key!r}] {msg}')
    return errors


def main() -> int:
    errors = []
    errors.extend(audit_generator_fallbacks())
    for rel in STATIC_PUBLIC:
        errors.extend(audit_file(rel, is_article=False))
    for slug in parse_catalog():
        errors.extend(audit_file(f'blog/{slug}.html', is_article=True))
        errors.extend(audit_file(f'en/blog/{slug}.html', is_article=True))

    if errors:
        print('[FAIL] SERP/social snippet audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1

    print('[OK] SERP/social snippet audit passed — public pages have usable meta, OG, and Twitter descriptions')
    return 0


if __name__ == '__main__':
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(main())
