"""
HsiaoEye — ensure crawler-visible related-article blocks stay in HTML.

Why: DN.addRelatedArticles() is still useful as a runtime fallback, but search
discovery should not depend on JavaScript. Each published article should ship
four contextual internal links and matching ItemList JSON-LD in the source.
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def parse_catalog():
    js = open(os.path.join(ROOT, 'blog', 'blog-shared.js'), encoding='utf-8').read()
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('[FAIL] DN.ARTICLES not found')
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1)))
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    en_stub_m = re.search(r'DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    en_stubs = set(re.findall(r"'([^']+)'", en_stub_m.group(1))) if en_stub_m else set()
    return sorted(slugs - stubs), en_stubs


def section_for(html):
    m = re.search(
        r'<section\b(?=[^>]*\bid=["\']hs-related["\'])[\s\S]*?</section>',
        html,
        re.IGNORECASE,
    )
    return m.group(0) if m else ''


def audit_file(path, slug, prefix, published, en_stubs):
    rel = os.path.relpath(path, ROOT).replace('\\', '/')
    html = open(path, encoding='utf-8').read()
    errors = []
    if '<!-- hs-static-related:start -->' not in html or '<!-- hs-static-related:end -->' not in html:
        errors.append('missing hs-static-related markers')

    sec = section_for(html)
    if not sec:
        errors.append('missing #hs-related section')
        return errors

    hrefs = re.findall(r'href=["\']([^"\']+)["\']', sec)
    related = []
    for href in hrefs:
        target = href.split('/blog/', 1)[1].strip('/') if '/blog/' in href else ''
        expected_prefix = '/blog/' if not prefix or target in en_stubs else '/en/blog/'
        if not href.startswith(expected_prefix):
            errors.append(f'bad related href locale: {href}')
            continue
        if target in published:
            related.append(target)
    if len(related) != 4:
        errors.append(f'expected 4 published related links, found {len(related)}')
    if slug in related:
        errors.append('related links include current article')
    if len(set(related)) != len(related):
        errors.append('duplicate related links')
    if 'Related ophthalmology articles' not in html:
        errors.append('missing related ItemList JSON-LD')

    return [f'{rel}: {e}' for e in errors]


def main():
    published, en_stubs = parse_catalog()
    errors = []
    for slug in published:
        errors.extend(audit_file(
            os.path.join(ROOT, 'blog', f'{slug}.html'),
            slug,
            '',
            set(published),
            en_stubs,
        ))
        errors.extend(audit_file(
            os.path.join(ROOT, 'en', 'blog', f'{slug}.html'),
            slug,
            '/en',
            set(published),
            en_stubs,
        ))

    if errors:
        print('[FAIL] Static related-article audit failed:')
        for err in errors:
            print('  - ' + err)
        return 1

    print(f'[OK] Static related-article audit passed — {len(published)} articles x 2 locales have 4 crawler-visible links')
    return 0


if __name__ == '__main__':
    sys.exit(main())
