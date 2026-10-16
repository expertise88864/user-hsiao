#!/usr/bin/env python
"""Copy the homepage header and footer onto every other public page.

Owner decision 2026-10-17: every page shows exactly the same sticky header
(衛教文章 / 眼科專科醫師考試 / 量表 / 關於我 + search + language select, with the
theme toggle and mobile menu injected by blog-shared.js) and the same magazine
footer (full-width disclaimer) as the homepage. ``index.html`` is the single
source of truth: edit the header or footer there, then run the build chain.

The step is idempotent and runs right after ``_gen_exam.py`` (which also
renders exam pages from this module) and before ``_gen_en_pages.py`` so the
English mirrors inherit the same chrome. The new-article scaffolds
(``api/admin/_new.js``, ``new-article.py``) are kept in step as well.
``tests/python/test_site_chrome.py`` fails if any page drifts from the homepage.

Pages without site chrome by design (never rewritten):
  - admin.html   — the CMS shell has its own toolbar
  - 404.html     — a self-contained centred error card
  - offline.html — the service-worker fallback must not depend on other pages
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = 'index.html'
EXCLUDED = {'index.html', 'admin.html', '404.html', 'offline.html'}
PAGE_GLOBS = ('*.html', 'blog/*.html', 'tools/**/*.html', 'exam/**/*.html')
# New-article scaffolds embed the same chrome so a fresh draft needs no rewrite.
# Characters that would break each template's string syntax are refused.
TEMPLATES = {
    'api/admin/_new.js': ('`', '${'),   # JS template literal
    'new-article.py': ('{', '}'),        # Python f-string
}

HEADER_RE = re.compile(r'<header\b[^>]*>.*?</header>', re.S)
FOOTER_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)


def _single(pattern: re.Pattern, text: str, what: str, where: str) -> re.Match | None:
    found = list(pattern.finditer(text))
    if len(found) > 1:
        raise ValueError(f'{where}: expected at most one {what}, found {len(found)}')
    return found[0] if found else None


def home_chrome(root: Path = ROOT) -> tuple[str, str]:
    """Return the homepage (header, footer) markup, normalised to LF."""
    text = (root / SOURCE).read_text(encoding='utf-8').replace('\r\n', '\n')
    header = _single(HEADER_RE, text, '<header>', SOURCE)
    footer = _single(FOOTER_RE, text, '<footer>', SOURCE)
    if not header or not footer:
        raise ValueError(f'{SOURCE}: the homepage must contain one <header> and one <footer>')
    return header.group(0), footer.group(0)


def home_header(root: Path = ROOT) -> str:
    return home_chrome(root)[0]


def home_footer(root: Path = ROOT) -> str:
    return home_chrome(root)[1]


def apply(html: str, header: str, footer: str, where: str = 'page') -> str:
    """Return ``html`` with its header/footer replaced by the homepage's."""
    crlf = '\r\n' in html
    text = html.replace('\r\n', '\n')
    found = _single(HEADER_RE, text, '<header>', where)
    if not found:
        raise ValueError(f'{where}: no <header> to replace')
    text = text[:found.start()] + header + text[found.end():]
    found = _single(FOOTER_RE, text, '<footer>', where)
    if found:
        text = text[:found.start()] + footer + text[found.end():]
    else:
        main_end = text.rfind('</main>')
        if main_end == -1:
            raise ValueError(f'{where}: no <footer> and no </main> to place one after')
        cut = main_end + len('</main>')
        text = text[:cut] + '\n\n' + footer + text[cut:]
    return text.replace('\n', '\r\n') if crlf else text


def pages(root: Path = ROOT) -> list[Path]:
    seen: set[Path] = set()
    for pattern in PAGE_GLOBS:
        for path in root.glob(pattern):
            rel = path.relative_to(root).as_posix()
            if rel in EXCLUDED or rel.startswith(('en/', 'node_modules/')):
                continue
            seen.add(path)
    return sorted(seen)


def main(root: Path = ROOT) -> int:
    header, footer = home_chrome(root)
    changed = 0
    for path in pages(root):
        rel = path.relative_to(root).as_posix()
        raw = path.read_bytes().decode('utf-8')
        new = apply(raw, header, footer, rel)
        if new != raw:
            path.write_bytes(new.encode('utf-8'))
            changed += 1
    for rel, forbidden in TEMPLATES.items():
        bad = [token for token in forbidden if token in header or token in footer]
        if bad:
            raise ValueError(f'{SOURCE}: header/footer contain {bad}, which cannot be embedded in {rel}')
        path = root / rel
        raw = path.read_bytes().decode('utf-8')
        new = apply(raw, header, footer, rel)
        if new != raw:
            path.write_bytes(new.encode('utf-8'))
            changed += 1
    print(f'[OK] site chrome: {changed} page(s) updated from {SOURCE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
