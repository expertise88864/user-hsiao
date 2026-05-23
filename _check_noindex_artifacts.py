#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Ensure noindex pages never leak into crawler-facing discovery artifacts."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOMAIN = "https://hsiao.chendermatologist.com"

ARTIFACTS = [
    ROOT / "sitemap.xml",
    ROOT / "blog" / "feed.xml",
    ROOT / "blog" / "atom.xml",
    ROOT / "blog" / "feed.json",
    ROOT / "llms.txt",
    ROOT / "assets" / "search-index.json",
    ROOT / "assets" / "related.json",
]


def html_files() -> list[Path]:
    out: list[Path] = []
    for pattern in ("*.html", "blog/*.html", "en/*.html", "en/blog/*.html"):
        out.extend(p for p in ROOT.glob(pattern) if p.is_file())
    return sorted(out)


def is_noindex(src: str) -> bool:
    match = re.search(
        r'<meta\s+name=["\']robots["\'][^>]*content=["\']([^"\']+)["\']',
        src,
        re.I,
    )
    return bool(match and "noindex" in match.group(1).lower())


def canonical_url(src: str, path: Path) -> str:
    match = re.search(r'<link\s+rel=["\']canonical["\']\s+href=["\']([^"\']+)["\']', src, re.I)
    if match:
        return match.group(1).strip()
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return DOMAIN + "/"
    if rel.endswith("/index.html"):
        return DOMAIN + "/" + rel[:-11]
    if rel.endswith(".html"):
        return DOMAIN + "/" + rel[:-5]
    return DOMAIN + "/" + rel


def catalog_slugs() -> set[str]:
    js = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    match = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not match:
        return set()
    return set(re.findall(r"slug:\s*'([^']+)'", match.group(1)))


def noindex_pages() -> dict[str, str]:
    pages: dict[str, str] = {}
    for path in html_files():
        src = path.read_text(encoding="utf-8")
        if not is_noindex(src):
            continue
        rel = path.relative_to(ROOT).as_posix()
        pages[canonical_url(src, path)] = rel
    return pages


def artifact_mentions(path: Path, urls: dict[str, str]) -> list[str]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    rel = path.relative_to(ROOT).as_posix()
    for url, source_rel in urls.items():
        if url in text:
            errors.append(f"{rel}: contains noindex page {url} from {source_rel}")
    return errors


def search_index_mentions(urls: dict[str, str]) -> list[str]:
    path = ROOT / "assets" / "search-index.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"assets/search-index.json: invalid JSON ({exc})"]
    text = json.dumps(data, ensure_ascii=False)
    return artifact_mentions(path, urls) if text else []


def main() -> int:
    pages = noindex_pages()
    errors: list[str] = []

    for artifact in ARTIFACTS:
        if artifact.as_posix().endswith("search-index.json"):
            errors.extend(search_index_mentions(pages))
        else:
            errors.extend(artifact_mentions(artifact, pages))

    slugs = catalog_slugs()
    for url, rel in pages.items():
        match = re.search(r"/(?:en/)?blog/([^/?#]+)$", url)
        if match and match.group(1) in slugs:
            errors.append(f"blog/blog-shared.js: DN.ARTICLES includes noindex page {rel}")

    if errors:
        print("[FAIL] noindex artifact audit found crawler-facing leaks:")
        for error in errors:
            print("  - " + error)
        return 1

    print(f"[OK] noindex artifact audit passed: {len(pages)} noindex page(s) absent from discovery artifacts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
