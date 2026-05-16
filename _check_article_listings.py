#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit that every DN.ARTICLES entry appears on the manually-maintained
listing pages — homepage cards, blog/index.html, and blog/topics.html.

Why this exists: HsiaoEye has three manual listing surfaces:
  1. index.html — homepage "最新文章" cards (chronological)
  2. blog/index.html — full article index
  3. blog/topics.html — topic-grouped article map

DN.ARTICLES (in blog/blog-shared.js) is the authoritative catalog, but
the three listing pages are hand-maintained for SEO (server-rendered
HTML, not JS-rendered). When you add a new article, all FOUR places
must be touched. This script catches the drift.

Stubs (DN.STUB_SLUGS) are intentionally not listed → not flagged.

Exit code:
  0 → all listings in sync
  1 → ≥ 1 article missing from a listing page
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parent
LISTINGS = [
    "index.html",
    "blog/index.html",
    "blog/topics.html",
]


def parse_dn_articles() -> set[str]:
    """Extract slug:'...' values from DN.ARTICLES literal in blog-shared.js."""
    src = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    m = re.search(r"DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];", src)
    if not m:
        return set()
    inner = m.group(1)
    return set(re.findall(r"slug\s*:\s*['\"]([a-z0-9][a-z0-9-]*)['\"]", inner))


def parse_dn_stubs() -> set[str]:
    """Extract DN.STUB_SLUGS values (these are intentionally not in listings)."""
    src = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    m = re.search(r"DN\.STUB_SLUGS\s*=\s*\[([^\]]+)\]", src)
    if not m:
        return set()
    return set(re.findall(r"['\"]([a-z0-9][a-z0-9-]+)['\"]", m.group(1)))


def slugs_in_listing(rel_path: str) -> set[str]:
    p = ROOT / rel_path
    if not p.exists():
        return set()
    src = p.read_text(encoding="utf-8")
    # Match href="/blog/<slug>" — accept both single and double quotes
    return set(re.findall(r'href=["\']/blog/([a-z0-9][a-z0-9-]+)["\']', src))


def main() -> int:
    catalog = parse_dn_articles()
    stubs = parse_dn_stubs()
    expected = catalog - stubs

    if not expected:
        print("[WARN] DN.ARTICLES is empty or unparseable — skipping listing audit")
        return 0

    errors: list[str] = []
    for listing in LISTINGS:
        present = slugs_in_listing(listing)
        missing = expected - present
        if missing:
            for slug in sorted(missing):
                errors.append(f"{listing}: missing article card for slug '{slug}'")

    if errors:
        print(f"[FAIL] Article listing drift — {len(errors)} missing entries:")
        for err in errors:
            print(" - " + err)
        print()
        print(" Hint: add manual <a href=\"/blog/<slug>\"> card to the listing page(s) above.")
        print(" DN.ARTICLES (blog/blog-shared.js) is the source of truth.")
        return 1

    print(f"[OK] Article listing audit passed — {len(expected)} articles in DN.ARTICLES, all present in {len(LISTINGS)} listing pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
