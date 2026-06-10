"""
HsiaoEye — verify every in-page anchor `<a href="#foo">` has a matching
`id="foo"` in the same HTML file.

Why: long-form articles use anchor TOCs and inline jumps (e.g.
`<a href="#section-treatment">治療階梯</a>`). When sections get
renamed or removed the anchor goes dead silently — clicking does
nothing and the URL just gets `#section-treatment` appended. This
audit catches the drift at PR time.

Scope:
  - Every HTML file under blog/, en/blog/, plus top-level /index.html,
    /about.html, /tools.html, /notes.html, /privacy.html.
  - Skips known dynamic anchors injected by JS (#hs-related,
    #main-content — these come from blog-shared.js / scaffolded layout).

Exit codes:
  0   pass
  1   warn (non-blocking via `|| true` in CI initially)
"""
from __future__ import annotations

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# Anchors injected at runtime by JS — these IDs may not exist in the
# source HTML and that's expected (they're created by blog-shared.js).
# Same for skip-link targets and dynamic mount points.
JS_INJECTED_IDS = {
    'hs-related', 'hs-toc-float', 'hs-toc', 'dn-toc', 'dn-toc-float',
    'hs-progress', 'hs-totop', 'dn-totop', 'hs-cmdk-overlay', 'dn-cmdk-overlay',
    'hs-share', 'hs-bmc', 'hs-feedback', 'hs-author-bio', 'hs-mobile-nav',
    'hs-theme-toggle', 'hs-font-sizer', 'hs-resume-toast', 'hs-en-banner',
    'dn-en-banner', 'hs-reading-meta', 'hs-inline-cta', 'hs-related-css',
    'dn-newsletter-h',
}

# Pages outside the article scope where this check would be noisy.
SKIP_FILES = {'admin.html', 'offline.html', '404.html',
              'blog/blog-shared.js', 'tools/eye-3d.html'}


def collect_targets():
    files = []
    for pat in ('*.html', 'blog/*.html', 'en/*.html', 'en/blog/*.html', 'tools/*.html'):
        files.extend(sorted(glob.glob(os.path.join(ROOT, pat))))
    return [
        f for f in files
        if os.path.relpath(f, ROOT).replace('\\', '/') not in SKIP_FILES
    ]


def audit_file(fp):
    """Return list of (anchor, line) for dead anchors in this file."""
    with open(fp, encoding='utf-8') as f:
        text = f.read()

    # Collect all id="..." values (including ones inside SVGs, headers, etc).
    ids = set(re.findall(r'\bid=[\"\']([^\"\']+)[\"\']', text))
    # Also pick up `name="…"` legacy anchors.
    ids |= set(re.findall(r'<a[^>]+\bname=[\"\']([^\"\']+)[\"\']', text))

    dead = []
    # Same-page anchors: href="#foo" — strip the leading '#'
    for m in re.finditer(r'href=[\"\']#([^\"\']+)[\"\']', text):
        target = m.group(1)
        if not target:
            continue   # bare "#" — top-of-page, always valid
        if target in JS_INJECTED_IDS:
            continue
        if target in ids:
            continue
        line = text[:m.start()].count('\n') + 1
        dead.append((target, line))
    return dead


def main():
    issues = []
    for fp in collect_targets():
        rel = os.path.relpath(fp, ROOT).replace('\\', '/')
        dead = audit_file(fp)
        if dead:
            issues.append((rel, dead))

    if not issues:
        print('[OK] Dead-anchor audit passed — every in-page #anchor has a matching id')
        return 0

    total = sum(len(d) for _, d in issues)
    print(f'[WARN] Dead-anchor audit: {total} dead anchor(s) across {len(issues)} file(s):')
    for rel, dead in issues:
        for anchor, line in dead:
            print(f'  {rel}:{line}  #{anchor}')
    print()
    print('Fix: either rename the target section to match, or update the <a href="#…"> to a real id.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
