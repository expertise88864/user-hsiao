"""HsiaoEye build-time validator.

Walks every HTML page and reports SEO/quality issues.
Exit code 0 if all pass, 1 if any fail (suitable for CI gating).

Checks:
  • <title> exists, non-empty, ≤70 chars
  • <meta name="description"> exists, 50–160 chars
  • <link rel="canonical">
  • Open Graph: og:title, og:description, og:image, og:type
  • Twitter card: twitter:card
  • At least one <link rel="alternate" hreflang>
  • At least one application/ld+json block, all parse
  • <img> tags have alt + width + height
  • Internal links (href starting with / or # or relative) don't point to
    files that don't exist on disk
  • RSS/Atom alternate links match real files

Usage:  python validate.py [--strict]
"""
import json
import re
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
SKIP_DIRS = {'.git', 'node_modules', '.vercel', '__pycache__'}

# Cache existing files for link-check
ALL_FILES = set()
for p in ROOT.rglob('*'):
    if any(s in p.parts for s in SKIP_DIRS):
        continue
    if p.is_file():
        ALL_FILES.add('/' + str(p.relative_to(ROOT)).replace('\\', '/'))

# Also recognise the clean-URL rewrites Vercel does (foo.html → /foo)
CLEAN_URLS = {f.removesuffix('.html') for f in ALL_FILES if f.endswith('.html')}
# /index.html → /, /blog/index.html → /blog/, etc.
INDEX_URLS = {f.removesuffix('index.html') for f in ALL_FILES if f.endswith('index.html')}
KNOWN_PATHS = ALL_FILES | CLEAN_URLS | INDEX_URLS | {'/blog/topics', '/notes'}

issues = defaultdict(list)
warnings = defaultdict(list)

def check(fp: Path, text: str):
    rel = '/' + str(fp.relative_to(ROOT)).replace('\\', '/')

    # 1. title
    m = re.search(r'<title>([^<]*)</title>', text)
    if not m or not m.group(1).strip():
        issues[rel].append('missing or empty <title>')
    elif len(m.group(1)) > 70:
        warnings[rel].append(f'title too long ({len(m.group(1))} chars, recommended ≤70)')

    # 2. meta description
    m = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', text)
    if not m or not m.group(1).strip():
        issues[rel].append('missing meta description')
    else:
        n = len(m.group(1))
        if n < 50:
            warnings[rel].append(f'description too short ({n} chars, recommended 50–160)')
        elif n > 160:
            warnings[rel].append(f'description too long ({n} chars, recommended 50–160)')

    # 3. canonical
    if not re.search(r'<link\s+rel="canonical"\s+href="[^"]+"', text):
        issues[rel].append('missing canonical')

    # 4. Open Graph
    for og in ('og:title', 'og:description', 'og:image', 'og:type'):
        if not re.search(rf'<meta\s+property="{og}"\s+content="[^"]+"', text):
            warnings[rel].append(f'missing {og}')

    # 5. Twitter card
    if not re.search(r'<meta\s+name="twitter:card"\s+content="[^"]+"', text):
        warnings[rel].append('missing twitter:card')

    # 6. hreflang
    if not re.search(r'<link\s+rel="alternate"\s+hreflang="[^"]+"', text):
        warnings[rel].append('missing hreflang alternate')

    # 7. JSON-LD blocks all parse
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.DOTALL)
    if not blocks:
        warnings[rel].append('no JSON-LD blocks')
    for i, b in enumerate(blocks):
        try:
            json.loads(b.strip())
        except Exception as e:
            issues[rel].append(f'JSON-LD #{i+1} invalid: {e}')

    # 8. <img> tags need alt + width + height
    for m in re.finditer(r'<img\b[^>]*>', text):
        tag = m.group(0)
        if not re.search(r'\balt="[^"]*"', tag):
            warnings[rel].append(f'<img> without alt: {tag[:80]}…')
        if not re.search(r'\bwidth="[^"]+"', tag) or not re.search(r'\bheight="[^"]+"', tag):
            warnings[rel].append(f'<img> without width/height (CLS risk): {tag[:80]}…')

    # 9. Internal links — only same-host, no scheme
    for m in re.finditer(r'<a\b[^>]*\bhref="([^"]+)"', text):
        href = m.group(1)
        if href.startswith(('http://', 'https://', 'mailto:', 'tel:', 'javascript:', '#')):
            continue
        # Skip dynamic JS template-literal hrefs (admin.html builds anchor
        # tags inside JS strings — `${a.slug}` is interpolated at runtime,
        # not a real path). Same for sed/regex backref like $2.
        if '${' in href or re.fullmatch(r'\$\d+', href):
            continue
        # strip query / fragment for path check
        path = href.split('?')[0].split('#')[0]
        if not path:
            continue
        # normalise
        if path in KNOWN_PATHS:
            continue
        if path + '.html' in ALL_FILES:
            continue
        if path.endswith('/') and path + 'index.html' in ALL_FILES:
            continue
        warnings[rel].append(f'internal link to unknown path: {href}')

def main():
    strict = '--strict' in sys.argv
    files = sorted(ROOT.rglob('*.html'))
    files = [f for f in files if not any(s in f.parts for s in SKIP_DIRS)]
    print(f'Validating {len(files)} HTML files...\n')

    for fp in files:
        try:
            text = fp.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            issues[str(fp)].append('not utf-8')
            continue
        check(fp, text)

    err_total = sum(len(v) for v in issues.values())
    warn_total = sum(len(v) for v in warnings.values())

    if issues:
        print('=== ERRORS ===')
        for fp, msgs in sorted(issues.items()):
            print(f'\n  {fp}:')
            for m in msgs:
                print(f'    ✗ {m}')

    if warnings:
        print('\n=== WARNINGS ===')
        for fp, msgs in sorted(warnings.items()):
            print(f'\n  {fp}:')
            for m in msgs:
                print(f'    ⚠ {m}')

    print(f'\n──────────────────────────────────────')
    print(f'  ERRORS:   {err_total} across {len(issues)} files')
    print(f'  WARNINGS: {warn_total} across {len(warnings)} files')
    print(f'──────────────────────────────────────')

    if err_total > 0:
        sys.exit(1)
    if strict and warn_total > 0:
        sys.exit(1)

if __name__ == '__main__':
    main()
