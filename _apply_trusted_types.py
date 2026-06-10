#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Install the synchronous Trusted Types bootstrap on every public HTML page."""
from __future__ import annotations

import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
SCRIPT_RE = re.compile(
    r'<script\s+src="/assets/trusted-types\.js\?v=\d+"></script>',
    re.IGNORECASE,
)
CACHE_VERSION_RE = re.compile(r'\?v=(\d{8,})')
SKIP_DIRS = {'.git', '__pycache__', 'node_modules', 'astro-rewrite', 'admin'}


def patch_html(html: str) -> tuple[str, bool]:
    version_match = CACHE_VERSION_RE.search(html)
    suffix = f'?v={version_match.group(1)}' if version_match else ''
    script = f'<script src="/assets/trusted-types.js{suffix}"></script>'
    if SCRIPT_RE.search(html):
        updated = SCRIPT_RE.sub(script, html, count=1)
        return updated, updated != html

    match = re.search(r'<head\b[^>]*>', html, re.IGNORECASE)
    if not match:
        return html, False
    updated = html[:match.end()] + '\n' + script + html[match.end():]
    return updated, True


def main() -> int:
    changed = 0
    for directory, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
        for name in files:
            if not name.endswith('.html'):
                continue
            path = os.path.join(directory, name)
            with open(path, 'r', encoding='utf-8') as handle:
                source = handle.read()
            updated, modified = patch_html(source)
            if not modified:
                continue
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(updated)
            changed += 1
    print(f'Patched {changed} HTML files with the Trusted Types bootstrap')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
