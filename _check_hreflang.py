"""
HsiaoEye — validate hreflang pair correctness across every indexable HTML.

Why: a single broken hreflang pair drops Google's perceived language
clustering for both pages. Common regressions:
  - ZH page declares /en/<slug> alternate, but EN page doesn't echo it
  - Trailing-slash mismatch (one says /blog/, other /blog) → 308 chain
  - hreflang="x-default" missing or wrong URL
  - EN page declares hreflang="zh-Hant-TW" pointing to /en/ (wrong)

Rules enforced:
  1. Every indexable page MUST have at least one hreflang link tag.
  2. Every hreflang URL MUST be reachable as a file on disk (no 404).
  3. x-default + zh-Hant-TW must agree on the ZH canonical URL.
  4. en hreflang must point to /en/ (or be the /en/ page itself).
  5. RECIPROCITY: if A declares alternate to B, B must declare alternate
     back to A (both directions present).

Exit codes:
  0   pass
  1   fail
"""
from __future__ import annotations

import glob
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
DOMAIN = 'https://hsiao.chendermatologist.com'

SKIP_BASENAMES = {'404.html', 'offline.html', 'admin.html'}
SKIP_DIRS = {'.git', 'node_modules', '.vercel', '__pycache__', 'playwright-report', 'test-results'}


def url_to_path(url: str) -> str | None:
    """Map a hreflang URL back to its on-disk HTML file path. Returns None
    if the URL doesn't look like a same-site page we'd serve."""
    if not url.startswith(DOMAIN):
        return None
    p = url[len(DOMAIN):] or '/'
    # Strip query/fragment
    p = p.split('?', 1)[0].split('#', 1)[0]
    if p == '/':
        return 'index.html'
    if p.endswith('/'):
        return p.lstrip('/') + 'index.html'
    # No-trailing-slash: try .html, then /index.html
    if os.path.exists(os.path.join(ROOT, p.lstrip('/') + '.html')):
        return p.lstrip('/') + '.html'
    if os.path.exists(os.path.join(ROOT, p.lstrip('/'), 'index.html')):
        return p.lstrip('/') + '/index.html'
    return p.lstrip('/') + '.html'


def parse_hreflang(html: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(
        r'<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"',
        html,
    ):
        out[m.group(1)] = m.group(2)
    return out


def main():
    issues = []
    by_file = {}

    files = []
    for fp in sorted(glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)):
        rel = os.path.relpath(fp, ROOT).replace('\\', '/')
        if any(part in SKIP_DIRS for part in rel.split('/')):
            continue
        if os.path.basename(fp) in SKIP_BASENAMES:
            continue
        if rel.startswith('admin/'):
            continue
        files.append((rel, fp))

    for rel, fp in files:
        try:
            with open(fp, encoding='utf-8') as f:
                html = f.read()
        except UnicodeDecodeError:
            continue
        tags = parse_hreflang(html)
        by_file[rel] = tags

        if not tags:
            issues.append((rel, 'no hreflang declarations'))
            continue

        # Rule 3: x-default + zh-Hant-TW must agree (or x-default missing)
        if 'x-default' in tags and 'zh-Hant-TW' in tags:
            if tags['x-default'] != tags['zh-Hant-TW']:
                issues.append((rel,
                    f'x-default ({tags["x-default"]}) differs from zh-Hant-TW ({tags["zh-Hant-TW"]})'))

        # Rule 4: if this is an EN file, "en" hreflang should point inside /en/
        if rel.startswith('en/'):
            if 'en' in tags and '/en' not in tags['en']:
                issues.append((rel, f'EN page declares en={tags["en"]} but URL is not inside /en/'))

        # Rule 2: every hreflang URL must resolve to an existing file
        for lang, url in tags.items():
            target = url_to_path(url)
            if target and not os.path.exists(os.path.join(ROOT, target)):
                issues.append((rel, f'hreflang="{lang}" → {url}  (target file missing: {target})'))

    # Rule 5: reciprocity check (A says B is alternate → B must say A is alternate)
    for rel, tags in by_file.items():
        for lang, url in tags.items():
            if lang in ('x-default',):
                continue
            target = url_to_path(url)
            if not target or target not in by_file:
                continue   # unresolvable target — already flagged by rule 2 if local
            back_tags = by_file[target]
            # Does the target declare ANY alternate back to us?
            self_url = next((u for u in back_tags.values() if url_to_path(u) == rel), None)
            if not self_url:
                issues.append((rel,
                    f'reciprocity: declared {lang}={url} but {target} has no alternate back to /{rel}'))

    if not issues:
        print(f'[OK] Hreflang audit passed — {len(by_file)} indexable pages, all '
              f'declarations resolve + reciprocate')
        return 0

    print(f'[FAIL] Hreflang audit: {len(issues)} issue(s) across {len(set(i[0] for i in issues))} file(s):')
    # Group by file for readability, cap output
    by_rel = defaultdict(list)
    for rel, msg in issues:
        by_rel[rel].append(msg)
    for rel, msgs in sorted(by_rel.items())[:30]:
        print(f'  {rel}:')
        for m in msgs[:5]:
            print(f'    - {m}')
        if len(msgs) > 5:
            print(f'    ... and {len(msgs) - 5} more')
    return 1


if __name__ == '__main__':
    sys.exit(main())
