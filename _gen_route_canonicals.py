#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Normalize route URLs to the 200 OK canonical forms Vercel serves.

`vercel.json` uses trailingSlash:false, so `/blog/`, `/en/`, and `/en/blog/`
308 to `/blog`, `/en`, and `/en/blog`. Search Console treats submitted or
strongly-linked redirecting URLs as weaker index signals, so generated HTML,
XML, JSON-LD, and feed artifacts should never advertise those slash variants.
The root URL (`/`) is intentionally left untouched.
"""

from __future__ import annotations

import re
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

ABS_ROUTE_REPLACEMENTS = [
    (re.compile(rf"{re.escape(DOMAIN)}/en/blog/(?=[$\"'`<>\s,}}\]])"), f"{DOMAIN}/en/blog"),
    (re.compile(rf"{re.escape(DOMAIN)}/blog/(?=[$\"'`<>\s,}}\]])"), f"{DOMAIN}/blog"),
    (re.compile(rf"{re.escape(DOMAIN)}/en/(?=[$\"'`<>\s,}}\]])"), f"{DOMAIN}/en"),
]

ATTR_ROUTE_REPLACEMENTS = [
    (re.compile(r'(?P<attr>\b(?:href|src|action|formaction)=["\'])/en/blog/(?P<q>["\'])'), r"\g<attr>/en/blog\g<q>"),
    (re.compile(r'(?P<attr>\b(?:href|src|action|formaction)=["\'])/blog/(?P<q>["\'])'), r"\g<attr>/blog\g<q>"),
    (re.compile(r'(?P<attr>\b(?:href|src|action|formaction)=["\'])/en/(?P<q>["\'])'), r"\g<attr>/en\g<q>"),
]

ENCODED_ATTR_ROUTE_REPLACEMENTS = [
    (re.compile(r"(?P<attr>\b(?:href|src|action|formaction)=&quot;)/en/blog/(?P<q>&quot;)"), r"\g<attr>/en/blog\g<q>"),
    (re.compile(r"(?P<attr>\b(?:href|src|action|formaction)=&quot;)/blog/(?P<q>&quot;)"), r"\g<attr>/blog\g<q>"),
    (re.compile(r"(?P<attr>\b(?:href|src|action|formaction)=&quot;)/en/(?P<q>&quot;)"), r"\g<attr>/en\g<q>"),
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


def normalize_text(src: str) -> str:
    out = src
    for pattern, repl in ABS_ROUTE_REPLACEMENTS:
        out = pattern.sub(repl, out)
    for pattern, repl in ATTR_ROUTE_REPLACEMENTS:
        out = pattern.sub(repl, out)
    for pattern, repl in ENCODED_ATTR_ROUTE_REPLACEMENTS:
        out = pattern.sub(repl, out)
    return out


def main() -> int:
    changed: list[str] = []
    for path in iter_targets():
        src = path.read_text(encoding="utf-8")
        out = normalize_text(src)
        if out != src:
            path.write_text(out, encoding="utf-8")
            changed.append(path.relative_to(ROOT).as_posix())

    print(f"Normalized canonical route forms in {len(changed)} file(s)")
    for rel in changed:
        print(f"  - {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
