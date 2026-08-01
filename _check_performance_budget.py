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
# The hs:siteVer forced-reset stamp. Written as `var T='…'` on content pages and
# `TARGET = '…'` in admin.html; both spellings must track the ?v= epoch. Either
# quote style is accepted so a reformat cannot silently disable the check.
SITE_VER_TARGET_RE = re.compile(r"""(?:\bvar\s+T|\bTARGET)\s*=\s*['"](\d{6,})['"]""")
SITE_VER_MARKER = 'hs:siteVer'
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

    # Round-2 review: the version check below only ever read HTML files, so a
    # cache-bust `?v=` HARD-CODED INSIDE blog-shared.js was an unguarded
    # coupling — `DN.initAdminMode()` pins `/blog/blog-admin.js?v=<version>`,
    # and a site-wide bump that missed this literal would leave the admin
    # editor requesting a stale URL with nothing to catch it. Verified by
    # mutation: changing that literal (and re-minifying, to rule out the
    # min.js staleness gate) was caught by NO checker.
    # If an intentional version pin is ever needed in this file, allow-list it
    # here explicitly rather than widening the rule.
    if asset_version is not None:
        shared_src_path = ROOT / "blog" / "blog-shared.js"
        if shared_src_path.exists():
            shared_src = shared_src_path.read_text(encoding="utf-8")
            for version in re.findall(r"\?v=(\d{6,})", shared_src):
                if version != asset_version:
                    errors.append(
                        f"blog/blog-shared.js: hard-coded asset version ?v={version}, "
                        f"expected {asset_version} (matches homepage) — a site-wide "
                        f"cache-bust bump missed this literal")

    for path in iter_html_files():
        rel = path.relative_to(ROOT).as_posix()
        src = path.read_text(encoding="utf-8")
        if BLOG_SHARED_PRELOAD_RE.search(src):
            errors.append(f"{rel}: do not head-preload the large deferred blog-shared runtime")
        if asset_version is not None:
            for version in BLOG_SHARED_VERSION_RE.findall(src):
                if version != asset_version:
                    errors.append(f"{rel}: blog-shared asset version is {version}, expected {asset_version} (matches homepage)")
            # Round-3 review: `?v=` and the hs:siteVer stamp are TWO epochs of
            # the same version, and only the first was checked. A bump that
            # missed the stamp left every returning visitor with a matching
            # localStorage value, so the forced SW/cache reset never fired —
            # which is the whole point of the stamp. For an admin that means
            # keeping a stale editor bundle against a freshly deployed server.
            # Fail CLOSED. Scanning only for matches meant a page that spells the
            # stamp differently, renames the variable, or loses the assignment
            # produces zero matches and passes — the check would go quiet exactly
            # when the stamp stopped working.
            if SITE_VER_MARKER in src:
                stamps = SITE_VER_TARGET_RE.findall(src)
                if len(stamps) != 1:
                    errors.append(
                        f"{rel}: uses {SITE_VER_MARKER} but has {len(stamps)} "
                        f"recognisable version stamps (expected exactly 1: "
                        f"var T='…' or TARGET='…')")
                for version in stamps:
                    if version != asset_version:
                        errors.append(
                            f"{rel}: hs:siteVer target is {version} but assets are "
                            f"?v={asset_version} — D-06 bumps must move BOTH epochs")
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
        # P-01: the rule used to be "a Google Fonts preload is always wrong",
        # which was right while nothing applied it. The fonts are now loaded
        # non-blockingly ON PURPOSE — preload + a <noscript> stylesheet + a
        # bootstrap that promotes the link once it loads — so the invariant that
        # actually matters is that a preloaded font URL HAS an application path.
        # Without this, the check would fire on the intended design; with it,
        # a preload left dangling still fails.
        for fm in PRELOAD_GOOGLE_FONTS_RE.finditer(src):
            href = re.search(r'href="([^"]+)"', fm.group(0))
            url = href.group(1) if href else ''
            applied_noscript = f'<noscript><link rel="stylesheet" href="{url}"' in src
            applied_js = "getElementById('hs-fonts')" in src and 'id="hs-fonts"' in src
            if not (applied_noscript and applied_js):
                missing = []
                if not applied_noscript:
                    missing.append('a <noscript> stylesheet with the SAME url')
                if not applied_js:
                    missing.append('the id="hs-fonts" bootstrap that promotes it')
                errors.append(f"{rel}: Google Fonts preload has no application path — "
                              f"missing {' and '.join(missing)}; the preload would "
                              f"download the CSS and never apply it")
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
