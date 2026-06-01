#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit that only genuinely translated English mirrors enter discovery."""

from __future__ import annotations

import html
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOMAIN = "https://hsiao.chendermatologist.com"
DISCOVERY_ARTIFACTS = [
    ROOT / "sitemap.xml",
    ROOT / "blog" / "atom.xml",
    ROOT / "blog" / "feed.json",
    ROOT / "llms.txt",
    ROOT / "assets" / "search-index.json",
]


def slug_set(js: str, name: str) -> set[str]:
    match = re.search(rf"DN\.{re.escape(name)}\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    return set(re.findall(r"'([^']+)'", match.group(1))) if match else set()


def catalog() -> tuple[set[str], set[str]]:
    js = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    match = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.S)
    slugs = set(re.findall(r"slug:\s*'([^']+)'", match.group(1))) if match else set()
    return slugs - slug_set(js, "STUB_SLUGS"), slug_set(js, "EN_STUB_SLUGS")


class VisibleText(HTMLParser):
    SKIP = {"script", "style", "svg", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key.lower(): (value or "") for key, value in attrs}
        style = attr_map.get("style", "").replace(" ", "").lower()
        if self.skip_depth or tag in self.SKIP or "display:none" in style or "hidden" in attr_map:
            self.skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)


def visible_cjk_ratio(src: str) -> float:
    parser = VisibleText()
    parser.feed(src)
    text = html.unescape(" ".join(parser.parts))
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return cjk / max(1, cjk + latin)


def robots(src: str) -> str:
    match = re.search(r'<meta\s+name="robots"\s+content="([^"]*)"', src, re.I)
    return (match.group(1) if match else "").lower()


def canonical(src: str) -> str:
    match = re.search(r'<link\s+rel="canonical"\s+href="([^"]*)"', src, re.I)
    return match.group(1) if match else ""


def main() -> int:
    published, en_stubs = catalog()
    errors: list[str] = []
    artifact_text = "\n".join(path.read_text(encoding="utf-8") for path in DISCOVERY_ARTIFACTS if path.exists())

    for slug in sorted(en_stubs - published):
        errors.append(f"{slug}: EN_STUB_SLUGS entry is not a published Chinese article")

    for slug in sorted(published):
        zh_path = ROOT / "blog" / f"{slug}.html"
        en_path = ROOT / "en" / "blog" / f"{slug}.html"
        if not zh_path.exists() or not en_path.exists():
            errors.append(f"{slug}: missing ZH or EN article file")
            continue
        zh = zh_path.read_text(encoding="utf-8")
        en = en_path.read_text(encoding="utf-8")
        en_url = f"{DOMAIN}/en/blog/{slug}"
        ratio = visible_cjk_ratio(en)

        if canonical(en) != en_url:
            errors.append(f"{slug}: EN canonical should remain self-referencing")

        if slug in en_stubs:
            if "noindex" not in robots(en):
                errors.append(f"{slug}: untranslated EN mirror must be noindex")
            if 'hreflang="' in en:
                errors.append(f"{slug}: untranslated EN mirror should not advertise hreflang")
            if f'hreflang="en" href="{en_url}"' in zh:
                errors.append(f"{slug}: ZH page should not advertise untranslated EN hreflang")
            if en_url in artifact_text:
                errors.append(f"{slug}: untranslated EN URL leaked into discovery artifacts")
            if ratio < 0.08:
                errors.append(f"{slug}: EN mirror now looks translated ({ratio:.3f}); remove it from EN_STUB_SLUGS")
        else:
            if "noindex" in robots(en):
                errors.append(f"{slug}: publishable EN mirror is unexpectedly noindex")
            if f'hreflang="en" href="{en_url}"' not in zh or f'hreflang="en" href="{en_url}"' not in en:
                errors.append(f"{slug}: publishable EN mirror is missing reciprocal EN hreflang")
            if ratio > 0.12:
                errors.append(f"{slug}: EN mirror is Chinese-heavy ({ratio:.3f}); add it to EN_STUB_SLUGS or translate it")

    if errors:
        print("[FAIL] English publishability audit failed:")
        for error in errors:
            print("  - " + error)
        return 1

    print(f"[OK] English publishability audit passed: {len(published) - len(en_stubs)} translated mirrors indexed, {len(en_stubs)} gated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
