"""
HsiaoEye — flag inline SVG figures with missing accessibility attributes.

Why: medical articles are richly illustrated with custom SVG diagrams
(淚腺解剖, 視網膜剝離示意, etc.). When these lack `<title>` / `<desc>`
or `role="img"`:

  - Screen readers either skip them (no info) or read individual <path>
    elements (worse — pure noise).
  - Google Image Search can't index them (no alt text).
  - Bing / Naver image SERP same.

This audit only WARNS (the fix is per-figure and needs the author's
domain knowledge). It distinguishes:

  - Decorative icons (no title, no aria-*) → should add `aria-hidden="true"`
  - Meaningful figures (has <title>) without `<desc>` → should add a
    descriptive `<desc>` for image SERP indexing.
  - Meaningful figures without `role="img"` → screen readers may parse
    children individually.

Scope: only inline `<svg>` inside blog/*.html article files.
"""
from __future__ import annotations

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def main():
    issues = []
    for fp in sorted(glob.glob(os.path.join(ROOT, 'blog', '*.html'))):
        name = os.path.basename(fp)
        if name in ('index.html', 'topics.html'):
            continue
        try:
            with open(fp, encoding='utf-8') as f:
                html = f.read()
        except UnicodeDecodeError:
            continue

        # Only inspect real inline SVG elements in article DOM. CSS can embed
        # SVG data URIs (for example the language select chevron); those are
        # decorative background images and should not be treated as figures.
        scan_html = re.sub(r'<(style|script)\b[^>]*>[\s\S]*?</\1>', '', html, flags=re.IGNORECASE)

        decorative_missing_hidden = 0
        meaningful_missing_desc = 0
        meaningful_missing_role = 0

        for m in re.finditer(r'<svg\b[^>]*>([\s\S]*?)</svg>', scan_html):
            svg_open = re.match(r'<svg\b[^>]*>', m.group(0)).group(0)
            body = m.group(1)
            has_title = '<title' in body
            has_desc = '<desc' in body
            has_aria_hidden = 'aria-hidden' in svg_open
            has_aria_label = ('aria-label' in svg_open) or ('aria-labelledby' in svg_open)
            has_role_img = re.search(r'role=[\"\']img[\"\']', svg_open) is not None

            if not has_title and not has_aria_label and not has_aria_hidden:
                decorative_missing_hidden += 1
            elif has_title and not has_desc:
                meaningful_missing_desc += 1
                if not has_role_img:
                    meaningful_missing_role += 1

        if decorative_missing_hidden or meaningful_missing_desc:
            issues.append((name, decorative_missing_hidden,
                          meaningful_missing_desc, meaningful_missing_role))

    if not issues:
        print('[OK] SVG a11y audit passed')
        return 0

    print(f'[WARN] SVG a11y audit: {len(issues)} file(s) have SVG ax/SEO gaps:')
    grand_decor = grand_desc = grand_role = 0
    for name, dec, des, rol in issues:
        notes = []
        if dec: notes.append(f'{dec} decorative SVG missing aria-hidden')
        if des: notes.append(f'{des} figure SVG missing <desc>')
        if rol: notes.append(f'{rol} figure SVG missing role="img"')
        print(f'  - {name}: ' + '; '.join(notes))
        grand_decor += dec; grand_desc += des; grand_role += rol
    print()
    print(f'Totals: {grand_decor} decorative+hidden / {grand_desc} +desc / {grand_role} +role=img')
    print()
    print('Fix per figure:')
    print('  - Decorative icon : add `aria-hidden="true"` to the <svg> tag')
    print('  - Meaningful figure: ensure both <title> AND <desc>; set `role="img"`')
    return 1


if __name__ == '__main__':
    sys.exit(main())
