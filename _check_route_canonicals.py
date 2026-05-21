#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit that crawler-facing artifacts do not advertise redirecting routes."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOMAIN = "https://hsiao.chendermatologist.com"

TEXT_GLOBS = [
    "*.html",
    "blog/*.html",
    "en/*.html",
    "en/blog/*.html",
    "sitemap.xml",
    "blog/feed.xml",
    "blog/atom.xml",
    "llms.txt",
    "opensearch.xml",
]

FORBIDDEN = [
    (re.compile(rf"{re.escape(DOMAIN)}/en/blog/(?=[$\"'`<>\s,}}\]])"), "absolute /en/blog/ route"),
    (re.compile(rf"{re.escape(DOMAIN)}/blog/(?=[$\"'`<>\s,}}\]])"), "absolute /blog/ route"),
    (re.compile(rf"{re.escape(DOMAIN)}/en/(?=[$\"'`<>\s,}}\]])"), "absolute /en/ route"),
    (re.compile(r'\b(?:href|src|action|formaction)=["\']/en/blog/["\']'), "attribute /en/blog/ route"),
    (re.compile(r'\b(?:href|src|action|formaction)=["\']/blog/["\']'), "attribute /blog/ route"),
    (re.compile(r'\b(?:href|src|action|formaction)=["\']/en/["\']'), "attribute /en/ route"),
    (re.compile(r'\b(?:href|src|action|formaction)=&quot;/en/blog/&quot;'), "encoded /en/blog/ route"),
    (re.compile(r'\b(?:href|src|action|formaction)=&quot;/blog/&quot;'), "encoded /blog/ route"),
    (re.compile(r'\b(?:href|src|action|formaction)=&quot;/en/&quot;'), "encoded /en/ route"),
]


def iter_targets() -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for pattern in TEXT_GLOBS:
        for path in ROOT.glob(pattern):
            if path.is_file() and path not in seen:
                seen.add(path)
                out.append(path)
    return sorted(out)


def main() -> int:
    errors: list[str] = []
    for path in iter_targets():
        src = path.read_text(encoding="utf-8")
        for pattern, label in FORBIDDEN:
            match = pattern.search(src)
            if match:
                line = src.count("\n", 0, match.start()) + 1
                rel = path.relative_to(ROOT).as_posix()
                errors.append(f"{rel}:{line}: {label} should use no-trailing-slash canonical form")

    if errors:
        print("[FAIL] route canonical audit found redirecting route signals:")
        for error in errors[:80]:
            print("  - " + error)
        if len(errors) > 80:
            print(f"  ... {len(errors) - 80} more")
        return 1

    print("[OK] route canonical audit passed: no /en/, /blog/, or /en/blog/ redirect signals")
    return 0


if __name__ == "__main__":
    sys.exit(main())
