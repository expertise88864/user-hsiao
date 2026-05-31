#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Static performance guardrails for first-paint/CWV-sensitive assets."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".git", "node_modules", ".next", "out", "dist", "__pycache__", "playwright-report", "test-results"}

# Served minified bundle size ceiling (raw KB). Kept consistent with the
# size-budget.yml budget for blog/blog-shared.min.js. The historical 72 KB
# target assumed an aggressive per-feature code-split (blog-hub / blog-diagrams
# / blog-calculators …) that was scaffolded but never shipped; until/unless
# that split lands, the single esbuild-minified runtime is the served bundle.
MIN_BUNDLE_KB_MAX = 200

BLOG_SHARED_PRELOAD_RE = re.compile(
    r'<link\s+rel="(?:modulepreload|preload)"(?:\s+as="script")?\s+href="[^"]*blog-shared(?:\.min)?\.js',
    re.I,
)
BLOG_SHARED_SCRIPT_RE = re.compile(
    r'<script\b[^>]+\bsrc="[^"]*/blog/blog-shared(?:\.min)?\.js[^"]*"[^>]*></script>',
    re.I,
)
BLOG_SHARED_VERSION_RE = re.compile(r'/blog/blog-shared\.min\.js\?v=(\d+)')
BLOG_DIAGRAMS_EAGER_RE = re.compile(
    r'<(?:script|link)\b[^>]+\b(?:src|href)="[^"]*/blog/blog-diagrams(?:\.min)?\.js[^"]*"',
    re.I,
)
BLOG_CALCULATORS_EAGER_RE = re.compile(
    r'<(?:script|link)\b[^>]+\b(?:src|href)="[^"]*/blog/blog-calculators(?:\.min)?\.js[^"]*"',
    re.I,
)
BLOG_HUB_EAGER_RE = re.compile(
    r'<(?:script|link)\b[^>]+\b(?:src|href)="[^"]*/blog/blog-hub(?:\.min)?\.js[^"]*"',
    re.I,
)
BLOG_ARTICLE_READING_EAGER_RE = re.compile(
    r'<(?:script|link)\b[^>]+\b(?:src|href)="[^"]*/blog/blog-article-reading(?:\.min)?\.js[^"]*"',
    re.I,
)
BLOG_ARTICLE_VISUALS_EAGER_RE = re.compile(
    r'<(?:script|link)\b[^>]+\b(?:src|href)="[^"]*/blog/blog-article-visuals(?:\.min)?\.js[^"]*"',
    re.I,
)
BLOG_ARTICLE_FOOTER_EAGER_RE = re.compile(
    r'<(?:script|link)\b[^>]+\b(?:src|href)="[^"]*/blog/blog-article-footer(?:\.min)?\.js[^"]*"',
    re.I,
)
PRELOAD_GOOGLE_FONTS_RE = re.compile(
    r'<link\s+rel="preload"\s+as="style"\s+href="https://fonts\.googleapis\.com/css2\?[^"]+"',
    re.I,
)
FONT_PRECONNECT_RE = re.compile(
    r'<link\s+rel="preconnect"\s+href="https://fonts\.(googleapis|gstatic)\.com"',
    re.I,
)


def iter_html_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*.html"):
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        files.append(path)
    return files


def _detect_asset_version() -> str | None:
    """Single source of truth for the blog-shared cache-bust version: whatever
    the homepage references. The check enforces that EVERY page agrees with the
    homepage, rather than hard-coding a literal that goes stale on every
    ?v= bump. Returns None if the homepage has no min.js ref yet."""
    home = ROOT / "index.html"
    if home.exists():
        m = BLOG_SHARED_VERSION_RE.search(home.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    return None


def main() -> int:
    errors: list[str] = []

    asset_version = _detect_asset_version()

    minified = ROOT / "blog" / "blog-shared.min.js"
    if minified.exists():
        size_kb = minified.stat().st_size / 1024
        if size_kb > MIN_BUNDLE_KB_MAX:
            errors.append(f"blog/blog-shared.min.js is {size_kb:.1f}KB; keep the shared runtime under {MIN_BUNDLE_KB_MAX}KB or split features")

    sw_path = ROOT / "sw.js"
    if sw_path.exists():
        sw_src = sw_path.read_text(encoding="utf-8")
        for bundle in (
            "blog-hub",
            "blog-article-reading",
            "blog-diagrams",
            "blog-calculators",
            "blog-article-visuals",
            "blog-article-footer",
        ):
            if f"'/blog/{bundle}.min.js'" in sw_src or f'"/blog/{bundle}.min.js"' in sw_src:
                errors.append(f"sw.js: {bundle}.min.js should be runtime-cached on demand, not precached during install")

    for path in iter_html_files():
        rel = path.relative_to(ROOT).as_posix()
        src = path.read_text(encoding="utf-8")
        if BLOG_SHARED_PRELOAD_RE.search(src):
            errors.append(f"{rel}: do not head-preload the large deferred blog-shared runtime")
        if asset_version is not None:
            for version in BLOG_SHARED_VERSION_RE.findall(src):
                if version != asset_version:
                    errors.append(f"{rel}: blog-shared asset version is {version}, expected {asset_version} (matches homepage)")
        if BLOG_DIAGRAMS_EAGER_RE.search(src):
            errors.append(f"{rel}: blog-diagrams should stay dynamically loaded only on article pages that need it")
        if BLOG_CALCULATORS_EAGER_RE.search(src):
            errors.append(f"{rel}: blog-calculators should stay dynamically loaded only when calculators are injected")
        if BLOG_HUB_EAGER_RE.search(src):
            errors.append(f"{rel}: blog-hub should stay dynamically loaded only on hub/spotlight pages")
        if BLOG_ARTICLE_READING_EAGER_RE.search(src):
            errors.append(f"{rel}: blog-article-reading should stay dynamically loaded only on article pages")
        if BLOG_ARTICLE_VISUALS_EAGER_RE.search(src):
            errors.append(f"{rel}: blog-article-visuals should stay dynamically loaded only on article pages")
        if BLOG_ARTICLE_FOOTER_EAGER_RE.search(src):
            errors.append(f"{rel}: blog-article-footer should stay dynamically loaded only on article pages")
        if PRELOAD_GOOGLE_FONTS_RE.search(src):
            errors.append(f"{rel}: Google Fonts CSS preload is unused unless the same URL is applied as a stylesheet")
        font_hints: dict[str, int] = {}
        for hint in FONT_PRECONNECT_RE.findall(src):
            font_hints[hint] = font_hints.get(hint, 0) + 1
        for host, count in font_hints.items():
            if count > 1:
                errors.append(f"{rel}: duplicate fonts.{host}.com preconnect appears {count} times")
        script_count = len(BLOG_SHARED_SCRIPT_RE.findall(src))
        is_noindex = bool(re.search(r'<meta\s+name="robots"\s+content="[^"]*\bnoindex\b', src, re.I))
        if script_count > 1:
            errors.append(f"{rel}: blog-shared runtime is loaded {script_count} times")
        # A noindex page that ships the 177 KB runtime should actually use it.
        # Full pages call DN.initBlog; lightweight pages (e.g. 404) legitimately
        # call only DN.applyTextOnly(DN.detectLang()) to swap bilingual text —
        # both count as real usage.
        uses_runtime = ("DN.initBlog" in src) or ("DN.applyTextOnly" in src)
        if is_noindex and "blog-shared.min.js" in src and not uses_runtime:
            errors.append(f"{rel}: noindex page references blog-shared without calling DN.initBlog or DN.applyTextOnly")

    if errors:
        print("[FAIL] Performance budget audit found issues:")
        for error in errors[:160]:
            print(" - " + error)
        if len(errors) > 160:
            print(f" ... {len(errors) - 160} more")
        return 1

    print("[OK] Performance budget audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
