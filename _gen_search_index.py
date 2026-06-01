#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate the public bilingual search index -> assets/search-index.json."""

from __future__ import annotations

import html as html_lib
import io
import json
import os
import re
import sys
from html.parser import HTMLParser


sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "assets", "search-index.json")
CATALOG = os.path.join(ROOT, "blog", "blog-shared.js")


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(value or "")).strip()


def strip_site_suffix(value: str) -> str:
    return re.sub(r"\s*\|\s*HsiaoEye.*$", "", value or "").strip()


def parse_catalog() -> list[dict[str, str]]:
    js = open(CATALOG, "r", encoding="utf-8").read()
    articles_match = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not articles_match:
        raise SystemExit("DN.ARTICLES not found")

    stub_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stub_match.group(1))) if stub_match else set()
    en_stub_match = re.search(r"DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    en_stubs = set(re.findall(r"'([^']+)'", en_stub_match.group(1))) if en_stub_match else set()

    def field(body: str, key: str) -> str:
        match = re.search(rf"{key}\s*:\s*'([^']*)'", body)
        return html_lib.unescape(match.group(1)).strip() if match else ""

    articles: list[dict[str, str]] = []
    for obj in re.finditer(r"\{([\s\S]*?)\}", articles_match.group(1)):
        body = obj.group(1)
        slug = field(body, "slug")
        if not slug or slug in stubs:
            continue
        date = field(body, "date")
        articles.append({
            "slug": slug,
            "date": date,
            "updated": field(body, "updated") or date,
            "tag": field(body, "tag"),
            "tag_en": field(body, "tag_en"),
            "cat": field(body, "cat"),
            "has_en": slug not in en_stubs,
        })
    articles.sort(key=lambda a: (a["updated"], a["date"], a["slug"]), reverse=True)
    return articles


def meta_content(page_html: str, key: str, attr: str = "name") -> str:
    match = re.search(
        rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>',
        page_html,
        re.I,
    )
    return clean_text(match.group(1)) if match else ""


def html_title(page_html: str) -> str:
    match = re.search(r"<title>([^<]+)</title>", page_html, re.I)
    return strip_site_suffix(clean_text(match.group(1))) if match else ""


class VisibleTextExtractor(HTMLParser):
    """Extract visible heading and paragraph text without reading attributes."""

    TEXT_TAGS = {"h1", "h2", "h3", "p"}
    SKIP_TAGS = {"script", "style", "svg", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.current: list[object] | None = None
        self.items: list[tuple[str, str]] = []

    def _is_hidden(self, tag: str, attrs: list[tuple[str, str | None]]) -> bool:
        attr_map = {name.lower(): (value or "") for name, value in attrs}
        style = attr_map.get("style", "").replace(" ", "").lower()
        return (
            tag in self.SKIP_TAGS
            or "display:none" in style
            or "hidden" in attr_map
            or attr_map.get("aria-hidden", "").lower() == "true"
        )

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.skip_depth:
            self.skip_depth += 1
            return
        if self._is_hidden(tag, attrs):
            self.skip_depth = 1
            return
        if tag in self.TEXT_TAGS and self.current is None:
            self.current = [tag, []]

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if self.current and tag == self.current[0]:
            text = clean_text("".join(self.current[1]))  # type: ignore[arg-type]
            if text:
                self.items.append((tag, text))
            self.current = None

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and self.current is not None:
            self.current[1].append(data)  # type: ignore[index,union-attr]

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth and self.current is not None:
            self.current[1].append(f"&{name};")  # type: ignore[index,union-attr]

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth and self.current is not None:
            self.current[1].append(f"&#{name};")  # type: ignore[index,union-attr]


def extract_visible(page_html: str) -> dict[str, object]:
    out: dict[str, object] = {}
    parser = VisibleTextExtractor()
    parser.feed(page_html)
    parser.close()

    h1 = next((text for tag, text in parser.items if tag == "h1"), "")
    if h1:
        out["h1"] = h1[:140]

    headings = [text for tag, text in parser.items if tag in {"h2", "h3"} and len(text) <= 90]
    if headings:
        out["h"] = headings[:20]

    snippet = next((text for tag, text in parser.items if tag == "p" and len(text) >= 40), "")
    if snippet:
        out["snippet"] = snippet[:240]
    return out


def build_entry(article: dict[str, str], lang: str) -> dict[str, object]:
    slug = article["slug"]
    if lang == "en":
        rel_path = os.path.join("en", "blog", f"{slug}.html")
        url = f"/en/blog/{slug}"
        tag = article["tag_en"] or article["tag"]
    else:
        rel_path = os.path.join("blog", f"{slug}.html")
        url = f"/blog/{slug}"
        tag = article["tag"] or article["tag_en"]

    path = os.path.join(ROOT, rel_path)
    if not os.path.exists(path):
        raise SystemExit(f"Missing search-index source page: {rel_path}")

    page_html = open(path, "r", encoding="utf-8").read()
    visible = extract_visible(page_html)
    title = html_title(page_html) or str(visible.get("h1", ""))
    snippet = meta_content(page_html, "description") or str(visible.get("snippet", ""))

    return {
        "slug": slug,
        "lang": "en" if lang == "en" else "zh-Hant-TW",
        "title": title[:140],
        "h": visible.get("h", []),
        "snippet": snippet[:240],
        "date": article["date"],
        "updated": article["updated"],
        "tag": tag,
        "cat": article["cat"],
        "url": url,
    }


def main() -> None:
    entries: list[dict[str, object]] = []
    for article in parse_catalog():
        entries.append(build_entry(article, "zh"))
        if article["has_en"]:
            entries.append(build_entry(article, "en"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    size = os.path.getsize(OUT)
    print(f"Wrote {len(entries)} bilingual entries -> assets/search-index.json ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
