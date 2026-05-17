"""
HsiaoEye — flag published articles with weak/missing internal-link presence.

Why: topical authority on Google scales with how densely an article is
cross-referenced from sibling articles. An "orphan" (zero inbound static
links from other articles) loses ranking signal even when its content is
strong. Floor: each article should have at least 1 inbound static link.

Why STATIC (not JS-injected): the IntersectionObserver-lazy related-cards
rendered by `DN.addRelatedArticles()` are visible to Googlebot, but the
prerender / Bingbot / older crawlers see only the source HTML. Sustained
SEO across all crawlers requires the link to live in the source HTML.

Exit codes:
  0   pass — every published article has >= MIN_INBOUND from peers
  1   warn — one or more orphans found (non-blocking via `|| true` in CI)
"""
from __future__ import annotations

import collections
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
MIN_INBOUND = 1

LISTING_FILES = {'index.html', 'topics.html'}


def parse_catalog():
    js = open(os.path.join(ROOT, 'blog', 'blog-shared.js'), encoding='utf-8').read()
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        return set(), set()
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1)))
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return slugs - stubs, stubs


def main():
    published, stubs = parse_catalog()
    if not published:
        print('[WARN] DN.ARTICLES is empty — nothing to audit')
        return 0

    inbound = collections.defaultdict(set)
    for fp in sorted(glob.glob(os.path.join(ROOT, 'blog', '*.html'))):
        name = os.path.basename(fp)
        if name in LISTING_FILES:
            continue
        slug = name.replace('.html', '')
        try:
            html = open(fp, encoding='utf-8').read()
        except UnicodeDecodeError:
            continue
        for m in re.finditer(r'href=[\"\']/blog/([a-z0-9-]+)(?:[\"\'?#])', html):
            tgt = m.group(1)
            if tgt in published and tgt != slug and slug in published:
                inbound[tgt].add(slug)

    orphans = sorted(s for s in published if len(inbound[s]) < MIN_INBOUND)

    if not orphans:
        print(f'[OK] Link-orphan audit passed — all {len(published)} '
              f'published articles have >= {MIN_INBOUND} static inbound link(s)')
        return 0

    print(f'[FAIL] Link-orphan audit found {len(orphans)} article(s) with '
          f'< {MIN_INBOUND} static inbound link(s) from peers:')
    for s in orphans:
        print(f'  - {s}  (inbound: {len(inbound[s])})')
    print()
    print('Why this matters: pure-static crawlers (Bing, older bots) miss the')
    print('JS-injected related-cards. Add an in-body cross-reference from one')
    print('semantically-related article so the link lives in the source HTML.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
