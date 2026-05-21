#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Ensure noindex/WIP article stubs are not linked from public source HTML."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "blog" / "blog-shared.js"


def stub_slugs() -> set[str]:
    js = CATALOG.read_text(encoding="utf-8")
    match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    return set(re.findall(r"'([^']+)'", match.group(1))) if match else set()


def is_stub_page(path: Path, slug: str) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    return rel in {f"blog/{slug}.html", f"en/blog/{slug}.html"}


def main() -> int:
    stubs = stub_slugs()
    errors: list[str] = []
    public_html = [
        *ROOT.glob("*.html"),
        *ROOT.glob("blog/*.html"),
        *ROOT.glob("en/*.html"),
        *ROOT.glob("en/blog/*.html"),
    ]
    href_re = re.compile(r"""href\s*=\s*(["']|&quot;)([^"'&]+)(?:\1|&quot;)""", re.I)

    for path in sorted(p for p in public_html if p.is_file()):
        src = path.read_text(encoding="utf-8")
        for quote, href in href_re.findall(src):
            clean = href.split("?", 1)[0].split("#", 1)[0]
            for slug in stubs:
                if is_stub_page(path, slug):
                    continue
                if clean in {f"/blog/{slug}", f"/blog/{slug}/", f"/en/blog/{slug}", f"/en/blog/{slug}/"}:
                    rel = path.relative_to(ROOT).as_posix()
                    errors.append(f"{rel}: public HTML links to noindex stub {clean}")

    if errors:
        print("[FAIL] stub exposure audit found public links to noindex/WIP pages:")
        for error in errors:
            print("  - " + error)
        return 1

    print("[OK] stub exposure audit passed: no public raw links to noindex stubs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
