#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit the Vercel dynamic sitemap source for canonical parity.

Vercel rewrites /sitemap.xml to api/sitemap.js in production, so the API
implementation must not drift from the committed sitemap generator.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
API = ROOT / "api" / "sitemap.js"
VERCEL = ROOT / "vercel.json"


def main() -> int:
    errors: list[str] = []
    api = API.read_text(encoding="utf-8") if API.exists() else ""
    vercel = VERCEL.read_text(encoding="utf-8") if VERCEL.exists() else ""

    if not api:
        errors.append("api/sitemap.js missing")
    if not vercel:
        errors.append("vercel.json missing")

    static_match = re.search(r"const STATIC_PAGES = \[([\s\S]*?)\];", api)
    static_block = static_match.group(1) if static_match else ""
    if "url: '/blog/'" in static_block:
        errors.append("api/sitemap.js STATIC_PAGES must use /blog, not /blog/")
    if "? '/en/'" in api or "? \"/en/\"" in api:
        errors.append("api/sitemap.js must emit /en, not /en/, for the English home canonical")
    if "p.url === '/blog/'" in api:
        errors.append("api/sitemap.js still special-cases /blog/ trailing slash")

    if "updated: getField(body, 'updated')" not in api:
        errors.append("api/sitemap.js should parse DN.ARTICLES updated dates")
    if "b.updated || b.date" not in api or "a.updated || a.date" not in api:
        errors.append("api/sitemap.js should sort articles by updated date first")
    if "new Date().toISOString().slice(0, 10)" in api:
        errors.append("api/sitemap.js should not stamp static sitemap URLs with request-time dates")
    if "const siteUpdated = articles[0]?.updated || articles[0]?.date" not in api:
        errors.append("api/sitemap.js should derive static lastmod from the newest article update")
    if "const lastModified = rfc822Date(siteUpdated)" not in api:
        errors.append("api/sitemap.js should derive Last-Modified from the stable site update date")
    if "res.setHeader('Last-Modified', lastModified)" not in api:
        errors.append("api/sitemap.js should send a Last-Modified header for crawlers and conditional requests")
    if "req.headers['if-modified-since']" not in api or "isFreshSince(ifModifiedSince, lastModified)" not in api:
        errors.append("api/sitemap.js should support If-Modified-Since 304 responses when no ETag is supplied")
    if "function etagMatches" not in api or "etagMatches(ifNoneMatch, etag)" not in api:
        errors.append("api/sitemap.js should handle multi-value If-None-Match headers")
    if "xmlEscape(e.message || e)" not in api:
        errors.append("api/sitemap.js should XML-escape error responses")
    if not re.search(r"emit\(\s*p\.url,\s*en,\s*siteUpdated,\s*p\.changefreq,\s*p\.priority,", api):
        errors.append("api/sitemap.js static zh URLs should use stable siteUpdated lastmod")
    if "<lastmod>${siteUpdated}</lastmod>" not in api:
        errors.append("api/sitemap.js static EN URLs should use stable siteUpdated lastmod")
    for token in ("const STATIC_OG_SLUGS", "function staticOgImage", "function staticImageTitle"):
        if token not in api:
            errors.append(f"api/sitemap.js missing static sitemap image support ({token})")
    if "staticOgImage(p.url)" not in api or "staticImageTitle(p.url, 'zh')" not in api:
        errors.append("api/sitemap.js should expose image:image entries for Chinese static URLs")
    if "staticImageTitle(p.url, 'en')" not in api:
        errors.append("api/sitemap.js should expose English image titles for English static URLs")
    if "EN_STUB_SLUGS" not in api or "has_en: !enStubs.has(slug)" not in api:
        errors.append("api/sitemap.js should parse untranslated English mirror gates")
    if "if (!a.has_en) return;" not in api:
        errors.append("api/sitemap.js should omit untranslated English mirror URLs")

    en_article_section = re.search(r"articles\.forEach\(a => \{[\s\S]*?DOMAIN\}/en/blog/\$\{a\.slug\}[\s\S]*?\}\);", api)
    section = en_article_section.group(0) if en_article_section else ""
    if "<image:image>" not in section:
        errors.append("api/sitemap.js should expose image:image entries for English article URLs")
    if "a.title_en || a.title || a.slug" not in section:
        errors.append("api/sitemap.js should use English image titles for English article URLs")

    if '"destination": "/blog/"' in vercel:
        errors.append("vercel.json redirects should target /blog, not /blog/")
    if '"trailingSlash": false' not in vercel:
        errors.append("vercel.json must keep trailingSlash:false for canonical no-slash URLs")

    if errors:
        print("[FAIL] Dynamic sitemap audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    print("[OK] Dynamic sitemap audit passed: API sitemap matches canonical no-slash policy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
