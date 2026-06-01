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
PERSON_ID = f"{DOMAIN}/about#person"


def type_names(obj: dict) -> set[str]:
    value = obj.get("@type")
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def ref_value(value) -> str:
    return str(value.get("@id") or "") if isinstance(value, dict) else str(value or "")


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
    en_stub_match = re.search(r"DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    en_stubs = set(re.findall(r"'([^']+)'", en_stub_match.group(1))) if en_stub_match else set()
    for row in rows:
        row["has_en"] = "true" if row.get("slug") not in en_stubs else ""
    return [row for row in rows if row["slug"] not in stubs]


def itemlist_block(path: Path) -> dict | None:
    src = path.read_text(encoding="utf-8")
    for block in jsonld_blocks(src):
        if "ItemList" in type_names(block) and str(block.get("@id", "")).endswith("#article-list"):
            return block
    return None


def breadcrumb_block(path: Path) -> dict | None:
    src = path.read_text(encoding="utf-8")
    for block in jsonld_blocks(src):
        if "BreadcrumbList" in type_names(block) and str(block.get("@id", "")).endswith("#breadcrumb"):
            return block
    return None


def page_block(path: Path, expected_url: str) -> dict | None:
    src = path.read_text(encoding="utf-8")
    for block in jsonld_blocks(src):
        if type_names(block) & {"Blog", "CollectionPage"} and block.get("url") == expected_url:
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
    if ref_id := (block.get("mainEntityOfPage") or {}):
        actual = ref_id.get("@id") if isinstance(ref_id, dict) else ref_id
        if actual != f"{DOMAIN}{page_prefix}#webpage":
            errors.append(f"{rel}: ItemList mainEntityOfPage should point at page #webpage")
    else:
        errors.append(f"{rel}: ItemList missing mainEntityOfPage")
    is_part_of = block.get("isPartOf")
    expected_site = f"{DOMAIN}/en#website" if english else f"{DOMAIN}/#website"
    actual_site = is_part_of.get("@id") if isinstance(is_part_of, dict) else is_part_of
    if actual_site != expected_site:
        errors.append(f"{rel}: ItemList isPartOf should point at {expected_site}")

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
        nested_english = english and bool(row.get("has_en"))
        expected_url = f"{DOMAIN}{article_prefix}/{slug}" if nested_english or not english else f"{DOMAIN}/blog/{slug}"
        expected_title = row.get("title_en") if nested_english else row.get("title")
        expected_title = expected_title or row.get("title") or slug
        if item.get("position") != i + 1:
            errors.append(f"{rel}: {slug} position should be {i + 1}")
        if item.get("url") != expected_url:
            errors.append(f"{rel}: {slug} URL mismatch ({item.get('url')!r})")
        if item.get("name") != expected_title:
            errors.append(f"{rel}: {slug} name mismatch")
        nested = item.get("item")
        if not isinstance(nested, dict):
            errors.append(f"{rel}: {slug} ListItem.item must be an Article object")
            continue
        expected_site = f"{DOMAIN}/en#website" if nested_english else f"{DOMAIN}/#website"
        expected_lang = "en" if nested_english else "zh-Hant-TW"
        expected_image = f"{DOMAIN}/assets/og/{slug}.png"
        expected_modified = row.get("updated") or row.get("date")
        if "MedicalScholarlyArticle" not in type_names(nested):
            errors.append(f"{rel}: {slug} nested item should be MedicalScholarlyArticle")
        if nested.get("@id") != f"{expected_url}#article":
            errors.append(f"{rel}: {slug} nested Article @id mismatch")
        if nested.get("url") != expected_url:
            errors.append(f"{rel}: {slug} nested Article URL mismatch")
        if nested.get("headline") != expected_title or nested.get("name") != expected_title:
            errors.append(f"{rel}: {slug} nested Article title mismatch")
        if nested.get("inLanguage") != expected_lang:
            errors.append(f"{rel}: {slug} nested Article inLanguage mismatch")
        if nested.get("datePublished") != row.get("date"):
            errors.append(f"{rel}: {slug} nested Article datePublished mismatch")
        if nested.get("dateModified") != expected_modified:
            errors.append(f"{rel}: {slug} nested Article dateModified mismatch")
        if nested.get("image") != expected_image or nested.get("thumbnailUrl") != expected_image:
            errors.append(f"{rel}: {slug} nested Article image mismatch")
        for key in ("author", "publisher"):
            if ref_value(nested.get(key)) != PERSON_ID:
                errors.append(f"{rel}: {slug} nested Article {key} should reference {PERSON_ID}")
        if ref_value(nested.get("isPartOf")) != expected_site:
            errors.append(f"{rel}: {slug} nested Article isPartOf should point at {expected_site}")

    return errors


def audit_page_entity(rel: str, page_prefix: str, english: bool) -> list[str]:
    errors: list[str] = []
    path = ROOT / rel
    expected_url = f"{DOMAIN}{page_prefix}"
    block = page_block(path, expected_url) if path.exists() else None
    if block is None:
        return [f"{rel}: missing Blog/CollectionPage JSON-LD"]
    expected_site = f"{DOMAIN}/en#website" if english else f"{DOMAIN}/#website"
    expected = {
        "@id": f"{expected_url}#webpage",
        "mainEntity": f"{expected_url}#article-list",
        "breadcrumb": f"{expected_url}#breadcrumb",
        "isPartOf": expected_site,
    }
    if block.get("@id") != expected["@id"]:
        errors.append(f"{rel}: page @id mismatch ({block.get('@id')!r})")
    for key in ("mainEntity", "breadcrumb", "isPartOf"):
        value = block.get(key)
        actual = value.get("@id") if isinstance(value, dict) else value
        if actual != expected[key]:
            errors.append(f"{rel}: page {key} should point at {expected[key]}")
    return errors


def audit_breadcrumb_page(
    rel: str,
    page_prefix: str,
    expected: list[tuple[str, str]],
) -> list[str]:
    errors: list[str] = []
    path = ROOT / rel
    block = breadcrumb_block(path) if path.exists() else None
    if block is None:
        return [f"{rel}: missing BreadcrumbList JSON-LD"]

    expected_id = f"{DOMAIN}{page_prefix}#breadcrumb"
    if block.get("@id") != expected_id:
        errors.append(f"{rel}: BreadcrumbList @id mismatch ({block.get('@id')!r})")

    items = block.get("itemListElement")
    if not isinstance(items, list):
        return errors + [f"{rel}: breadcrumb itemListElement must be a list"]
    if len(items) != len(expected):
        errors.append(f"{rel}: expected {len(expected)} breadcrumb items, found {len(items)}")

    for i, (name, path_prefix) in enumerate(expected):
        if i >= len(items) or not isinstance(items[i], dict):
            errors.append(f"{rel}: missing breadcrumb ListItem at position {i + 1}")
            continue
        item = items[i]
        if item.get("position") != i + 1:
            errors.append(f"{rel}: breadcrumb position should be {i + 1}")
        if item.get("name") != name:
            errors.append(f"{rel}: breadcrumb name mismatch at {i + 1} ({item.get('name')!r})")
        if item.get("item") != f"{DOMAIN}{path_prefix}":
            errors.append(f"{rel}: breadcrumb URL mismatch at {i + 1} ({item.get('item')!r})")

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
        errors.extend(audit_page_entity(rel, page_prefix, english))
        errors.extend(audit_page(rel, page_prefix, article_prefix, name, catalog, english))

    breadcrumb_checks = [
        ("blog/index.html", "/blog", [("首頁", "/"), ("眼科文章", "/blog")]),
        ("blog/topics.html", "/blog/topics", [("首頁", "/"), ("眼科文章", "/blog"), ("主題地圖", "/blog/topics")]),
        ("en/blog/index.html", "/en/blog", [("Home", "/en"), ("Ophthalmology Articles", "/en/blog")]),
        ("en/blog/topics.html", "/en/blog/topics", [("Home", "/en"), ("Articles", "/en/blog"), ("Ophthalmology Topic Map", "/en/blog/topics")]),
    ]
    for rel, page_prefix, expected in breadcrumb_checks:
        errors.extend(audit_breadcrumb_page(rel, page_prefix, expected))

    if errors:
        print("[FAIL] Listing schema audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    print(f"[OK] Listing schema audit passed: {len(catalog)} articles x 4 listing pages, with breadcrumbs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
