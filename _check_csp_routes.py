#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Ensure directory-index pages receive CSP hashes on their deployed routes."""
from __future__ import annotations

import os
import sys

from _gen_csp_hashes import ROOT, collect_hashes_by_route, routes_for_path


def main() -> int:
    cases = {
        'index.html': {'/', '/index.html'},
        'blog/index.html': {'/blog', '/blog/', '/blog/index.html'},
        'en/index.html': {'/en', '/en/', '/en/index.html'},
        'en/blog/index.html': {'/en/blog', '/en/blog/', '/en/blog/index.html'},
    }
    errors: list[str] = []
    for rel, expected in cases.items():
        actual = set(routes_for_path(os.path.join(ROOT, *rel.split('/'))))
        if actual != expected:
            errors.append(f'{rel}: expected {sorted(expected)}, got {sorted(actual)}')
        if any(route != '__fallback__' and not route.startswith('/') for route in actual):
            errors.append(f'{rel}: route missing leading slash: {sorted(actual)}')

    hashes = collect_hashes_by_route()
    for route in ('/', '/blog', '/blog/', '/en', '/en/', '/en/blog', '/en/blog/'):
        if not hashes.get(route):
            errors.append(f'{route}: missing executable inline-script hashes')

    if errors:
        print('\n'.join(f'FAIL: {error}' for error in errors))
        return 1
    print('CSP directory-index route aliases are complete')
    return 0


if __name__ == '__main__':
    sys.exit(main())
