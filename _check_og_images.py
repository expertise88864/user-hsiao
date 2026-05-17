"""
HsiaoEye — verify every published article has its OG card on disk.

When you add a new article and forget to run `python _gen_og_images.py`,
the `<meta property="og:image" content="…/assets/og/<slug>.png">` points
to a 404 — link previews on social platforms (Facebook, X, LINE,
Threads, Telegram, Slack) all render the broken-image placeholder.
This check catches it before the article ships.

Scope:
  - Every slug in DN.ARTICLES that is NOT in DN.STUB_SLUGS must have
    a file at /assets/og/<slug>.png
  - Static pages (/about, /tools, /blog/, etc.) get a slug-style check
    too: /assets/og/<slug>.png OR a documented site-wide fallback.

Exit codes:
  0   pass — all OG cards present
  1   fail — at least one slug missing its card
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OG_DIR = os.path.join(ROOT, 'assets', 'og')

STATIC_OG_SLUGS = ['home', 'about', 'tools', 'notes', 'privacy', 'blog', 'topics']


def parse_catalog():
    with open(os.path.join(ROOT, 'blog', 'blog-shared.js'), encoding='utf-8') as f:
        js = f.read()
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1))) if m else set()
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return sorted(slugs - stubs)


def main():
    if not os.path.isdir(OG_DIR):
        print(f'[FAIL] OG directory missing: {OG_DIR}')
        return 1

    published = parse_catalog()
    missing_article = [s for s in published if not os.path.isfile(os.path.join(OG_DIR, s + '.png'))]
    missing_static = [s for s in STATIC_OG_SLUGS if not os.path.isfile(os.path.join(OG_DIR, s + '.png'))]

    issues = 0
    if missing_article:
        print(f'[FAIL] {len(missing_article)} published article(s) missing OG card '
              f'at /assets/og/<slug>.png:')
        for s in missing_article:
            print(f'  - {s}')
        issues += len(missing_article)

    if missing_static:
        print(f'[WARN] {len(missing_static)} static page(s) missing OG card '
              f'(non-blocking, generic fallback will be used):')
        for s in missing_static:
            print(f'  - {s}')

    if not missing_article:
        print(f'[OK] OG image audit passed — all {len(published)} '
              f'published articles have /assets/og/<slug>.png on disk')

    if issues:
        print()
        print('Fix:  python _gen_og_images.py    # regenerates missing cards from templates')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
