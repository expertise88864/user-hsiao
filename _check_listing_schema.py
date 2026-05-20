#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit Blog/Topic ItemList JSON-LD against the published article catalog."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = "https://hsiao.chendermatologist.com"


def type_names(obj: dict) -> set[str]:
    value = obj.get("@type")
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def jsonld_blocks(src: str) -> list[dict]:
    blocks: list[dict] = []
    for match in re.finditer(r'<script\s+type="application/ld\+json"[^>]*>([\s\S]*?)</script>', src, re.I):
        raw = match.group(1).strip()
        if not raw:
            continue
        data = json.loads(raw)
        if isinstance(data, dict):
            blocks.append(data)
    return blocks


def parse_catalog() -> list[dict[str, str]]:
    js = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    match = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not match:
        raise SystemExit("[FAIL] DN.ARTICLES not found")

    rows: list[dict[str, str]] = []
    for obj in re.finditer(r"\{([^{}]*)\}", match.group(1)):
        body = obj.group(1)
        row: dict[str, str] = {}
        for key in ("slug", "title", "title_en", "date", "updated"):
            found = re.search(rf"{key}\s*:\s*'([^']*)'", body)
            if found:
                row[key] = found.group(1)
        if row.get("slug") and row.get("title"):
            rows.append(row)

    stub_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stub_match.group(1))) if stub_match else set()
    return [row for row in rows if row["slug"] not in stubs]


def itemlist_block(path: Path) -> dict | None:
    src = path.read_text(encoding="utf-8")
    for block in jsonld_blocks(src):
        if "ItemList" in type_names(block) and str(block.get("@id", "")).endswith("#article-list"):
            return block
    return None


def audit_page(
    rel: str,
    page_prefix: str,
    article_prefix: str,
    expected_name: str,
    catalog: list[dict[str, str]],
    english: bool,
) -> list[str]:
    errors: list[str] = []
    path = ROOT / rel
    block = itemlist_block(path) if path.exists() else None
    if block is None:
        return [f"{rel}: missing article ItemList JSON-LD"]

    expected_id = f"{DOMAIN}{page_prefix}#article-list"
    if block.get("@id") != expected_id:
        errors.append(f"{rel}: ItemList @id mismatch ({block.get('@id')!r})")
    if block.get("name") != expected_name:
        errors.append(f"{rel}: ItemList name mismatch ({block.get('name')!r})")
    if block.get("numberOfItems") != len(catalog):
        errors.append(f"{rel}: numberOfItems should be {len(catalog)}")

    items = block.get("itemListElement")
    if not isinstance(items, list):
        return errors + [f"{rel}: itemListElement must be a list"]
    if len(items) != len(catalog):
        errors.append(f"{rel}: expected {len(catalog)} list items, found {len(items)}")

    for i, row in enumerate(catalog):
        if i >= len(items) or not isinstance(items[i], dict):
            errors.append(f"{rel}: missing ListItem at position {i + 1}")
            continue
        item = items[i]
        slug = row["slug"]
        expected_url = f"{DOMAIN}{article_prefix}/{slug}"
        expected_title = row.get("title_en") if english else row.get("title")
        expected_title = expected_title or row.get("title") or slug
        if item.get("position") != i + 1:
            errors.append(f"{rel}: {slug} position should be {i + 1}")
        if item.get("url") != expected_url:
            errors.append(f"{rel}: {slug} URL mismatch ({item.get('url')!r})")
        if item.get("name") != expected_title:
            errors.append(f"{rel}: {slug} name mismatch")

    return errors


def main() -> int:
    catalog = parse_catalog()
    checks = [
        ("blog/index.html", "/blog", "/blog", "Published ophthalmology articles", False),
        ("blog/topics.html", "/blog/topics", "/blog", "Ophthalmology topic article list", False),
        ("en/blog/index.html", "/en/blog", "/en/blog", "Published ophthalmology articles", True),
        ("en/blog/topics.html", "/en/blog/topics", "/en/blog", "Ophthalmology topic article list", True),
    ]

    errors: list[str] = []
    for rel, page_prefix, article_prefix, name, english in checks:
        errors.extend(audit_page(rel, page_prefix, article_prefix, name, catalog, english))

    if errors:
        print("[FAIL] Listing ItemList schema audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    print(f"[OK] Listing ItemList schema audit passed: {len(catalog)} articles x 4 listing pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
