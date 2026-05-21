#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit auto-generated FAQPage schema boundaries and payload quality."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
BLOG = ROOT / "blog"
DOMAIN = "https://hsiao.chendermatologist.com"
LANG = "zh-Hant-TW"


def parse_catalog() -> tuple[set[str], set[str]]:
    js = (BLOG / "blog-shared.js").read_text(encoding="utf-8")
    articles_match = re.search(r"DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];", js)
    slugs = set(re.findall(r"slug:\s*'([^']+)'", articles_match.group(1))) if articles_match else set()
    stubs_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stubs_match.group(1))) if stubs_match else set()
    return slugs, stubs


def is_noindex(src: str) -> bool:
    return bool(re.search(r'<meta\s+name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', src, re.I))


def page_url(path: Path) -> str | None:
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return f"{DOMAIN}/"
    if rel.startswith("blog/") and rel.endswith(".html"):
        return f"{DOMAIN}/blog/{Path(rel).stem}"
    return None


def jsonld_types(value) -> set[str]:
    if isinstance(value, list):
        out: set[str] = set()
        for item in value:
            out |= jsonld_types(item)
        return out
    if not isinstance(value, dict):
        return set()
    typ = value.get("@type")
    out = set(str(x) for x in typ) if isinstance(typ, list) else ({str(typ)} if typ else set())
    graph = value.get("@graph")
    if isinstance(graph, list):
        out |= jsonld_types(graph)
    return out


def faq_blocks(path: Path) -> list[tuple[dict, bool]]:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    out: list[tuple[dict, bool]] = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text()
        data = json.loads(raw.strip())
        if isinstance(data, dict) and "FAQPage" in jsonld_types(data):
            out.append((data, script.has_attr("data-faq-auto")))
    return out


def cjk_ratio(value: str) -> float:
    if not value:
        return 0.0
    return len(re.findall(r"[\u4e00-\u9fff]", value)) / max(len(value), 1)


def validate_block(path: Path, data: dict) -> list[str]:
    errors: list[str] = []
    rel = path.relative_to(ROOT).as_posix()
    expected_url = page_url(path)
    if data.get("@type") != "FAQPage":
        errors.append(f"{rel}: FAQPage block has unexpected @type")
    if expected_url and data.get("@id") != f"{expected_url}#faq":
        errors.append(f"{rel}: FAQPage @id should be {expected_url}#faq")
    if expected_url and data.get("url") != expected_url:
        errors.append(f"{rel}: FAQPage url should be {expected_url}")
    if data.get("inLanguage") != LANG:
        errors.append(f"{rel}: FAQPage inLanguage should be {LANG}")

    entities = data.get("mainEntity")
    if not isinstance(entities, list) or len(entities) < 2:
        errors.append(f"{rel}: FAQPage needs at least 2 questions")
        return errors

    seen: set[str] = set()
    text_blob = ""
    for idx, item in enumerate(entities, start=1):
        if not isinstance(item, dict) or item.get("@type") != "Question":
            errors.append(f"{rel}: mainEntity #{idx} is not a Question")
            continue
        q = str(item.get("name") or "").strip()
        ans = item.get("acceptedAnswer")
        a = str(ans.get("text") or "").strip() if isinstance(ans, dict) else ""
        text_blob += " " + q + " " + a
        if not q or not a:
            errors.append(f"{rel}: mainEntity #{idx} has empty question/answer")
        if q in seen:
            errors.append(f"{rel}: duplicate FAQ question: {q[:60]}")
        seen.add(q)
        if "data-en=" in a or "data-zh=" in a or "<summary" in a:
            errors.append(f"{rel}: FAQ answer #{idx} contains raw HTML attribute residue")

    if cjk_ratio(text_blob) < 0.18:
        errors.append(f"{rel}: FAQPage payload does not look like Chinese page content")
    return errors


def main() -> int:
    slugs, stubs = parse_catalog()
    published = slugs - stubs
    allowed = {ROOT / "index.html"} | {BLOG / f"{slug}.html" for slug in published}
    errors: list[str] = []
    total_blocks = 0
    index_has_faq = False

    for path in sorted(ROOT.glob("*.html")) + sorted(BLOG.glob("*.html")) + sorted((ROOT / "en").glob("*.html")) + sorted((ROOT / "en" / "blog").glob("*.html")):
        src = path.read_text(encoding="utf-8")
        try:
            blocks = faq_blocks(path)
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT).as_posix()}: invalid FAQPage JSON-LD: {exc}")
            continue
        if not blocks:
            continue
        rel = path.relative_to(ROOT).as_posix()
        total_blocks += len(blocks)
        if len(blocks) > 1:
            errors.append(f"{rel}: page should not carry more than one FAQPage block")
        if path not in allowed:
            errors.append(f"{rel}: FAQPage is only allowed on indexable Chinese source pages")
        if rel.startswith("en/"):
            errors.append(f"{rel}: English mirror must not carry Chinese FAQPage schema")
        if is_noindex(src):
            errors.append(f"{rel}: noindex page must not carry FAQPage schema")
        if path == ROOT / "index.html":
            index_has_faq = True
        for data, _is_auto in blocks:
            errors.extend(validate_block(path, data))

    if not index_has_faq:
        errors.append("index.html: homepage FAQ section exists but has no FAQPage schema")

    if errors:
        print("[FAIL] FAQPage schema audit found issues:")
        for error in errors:
            print("  - " + error)
        return 1

    print(f"[OK] FAQPage schema audit passed: {total_blocks} FAQPage block(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
