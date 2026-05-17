"""
HsiaoEye — verify every published article ships with the standard footer.

Why: the magazine footer carries the disclaimer (legally required per Taiwan
Medical Care Act §85-86), navigation links, copyright line, and the RSS/
subscribe column. A new article scaffolded from a partial template (or
edited and accidentally truncated mid-file via the admin save flow) loses
this whole block and patients suddenly have no obvious way to return to
the homepage or read the disclaimer.

Toric article shipped without this footer on 2026-05-17 — visible bug,
no automated alert. This check closes that gap.

Required elements per published article:
  - `<footer class="mag-footer …">`  (the deep-ink editorial footer)
  - `class="mag-foot-disclaimer"`    (the Taiwan Medical Care Act block)
  - At least one of href="/" or href="/blog/"  (home / index nav)

Scope: every blog/<slug>.html that is in DN.ARTICLES and not in
DN.STUB_SLUGS. Listings (blog/index.html, blog/topics.html) and special
calculator/tool pages are out of scope.
"""
from __future__ import annotations

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP = {'index.html', 'topics.html'}


def parse_catalog():
    with open(os.path.join(ROOT, 'blog', 'blog-shared.js'), encoding='utf-8') as f:
        js = f.read()
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1))) if m else set()
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return slugs - stubs


def main():
    published = parse_catalog()
    issues = []

    for fp in sorted(glob.glob(os.path.join(ROOT, 'blog', '*.html'))):
        name = os.path.basename(fp)
        if name in SKIP:
            continue
        slug = name.replace('.html', '')
        if slug not in published:
            continue

        with open(fp, encoding='utf-8') as f:
            html = f.read()

        missing = []
        if 'class="mag-footer' not in html:
            missing.append('<footer class="mag-footer">')
        if 'class="mag-foot-disclaimer"' not in html:
            missing.append('disclaimer block (Taiwan Medical Care Act §85-86)')
        if not re.search(r'href="/"\s', html) and 'href="/" ' not in html:
            missing.append('home link (href="/")')

        if missing:
            issues.append((name, missing))

    if not issues:
        print(f'[OK] Article-footer audit passed — all {len(published)} '
              f'published articles ship the standard footer + disclaimer')
        return 0

    print(f'[FAIL] Article-footer audit: {len(issues)} article(s) missing '
          f'required footer element(s):')
    for name, miss in issues:
        print(f'  - {name}')
        for m in miss:
            print(f'      missing: {m}')
    print()
    print('Fix: copy the <footer class="mag-footer cv-auto-short">...</footer> block')
    print('     from any healthy article (e.g. blog/dry-eye-myths.html) into the')
    print('     affected file, just before the closing </body>.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
