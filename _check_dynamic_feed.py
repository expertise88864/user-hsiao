#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit the Vercel dynamic feed source for stable discovery metadata."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent
API = ROOT / "api" / "feed.js"
VERCEL = ROOT / "vercel.json"


def main() -> int:
    errors: list[str] = []
    src = API.read_text(encoding="utf-8") if API.exists() else ""
    vercel = VERCEL.read_text(encoding="utf-8") if VERCEL.exists() else ""

    if not src:
        errors.append("api/feed.js missing")
    if 'updated: getField(body, \'updated\')' not in src:
        errors.append("api/feed.js should parse DN.ARTICLES updated dates")
    if "articles.sort((a, b) => (b.updated || b.date || '').localeCompare(a.updated || a.date || ''))" not in src:
        errors.append("api/feed.js should sort articles by updated date first")
    if "new Date().toUTCString()" in src or "new Date().toISOString()" in src:
        errors.append("api/feed.js should not stamp feed XML with request-time dates")
    if "const feedUpdated = articles[0]?.updated || articles[0]?.date" not in src:
        errors.append("api/feed.js should derive feed updated date from newest article")
    if "const lastModified = rfc822Date(feedUpdated)" not in src:
        errors.append("api/feed.js should derive Last-Modified from the stable feed updated date")
    if "res.setHeader('Last-Modified', lastModified)" not in src:
        errors.append("api/feed.js should send a Last-Modified header for crawlers and conditional requests")
    if "req.headers['if-modified-since']" not in src or "isFreshSince(ifModifiedSince, lastModified)" not in src:
        errors.append("api/feed.js should support If-Modified-Since 304 responses when no ETag is supplied")
    if "function etagMatches" not in src or "etagMatches(ifNoneMatch, etag)" not in src:
        errors.append("api/feed.js should handle multi-value If-None-Match headers")
    if '<lastBuildDate>${rfc822Date(feedUpdated)}</lastBuildDate>' not in src:
        errors.append("RSS lastBuildDate should use the stable feedUpdated date")
    if '<updated>${atomDate(feedUpdated)}</updated>' not in src:
        errors.append("Atom feed updated should use the stable feedUpdated date")
    if "function buildJsonFeed" not in src:
        errors.append("api/feed.js should expose a JSON Feed builder")
    if "version: 'https://jsonfeed.org/version/1.1'" not in src:
        errors.append("JSON Feed should declare JSON Feed 1.1")
    if "feed_url: `${DOMAIN}/blog/feed.json`" not in src:
        errors.append("JSON Feed should advertise /blog/feed.json")
    if "isJson ? 'application/feed+json; charset=utf-8'" not in src:
        errors.append("api/feed.js should serve JSON Feed with application/feed+json")
    if 'atomDate(article.updated || article.date)' not in src:
        errors.append("Atom entries should use article updated dates")
    if 'href="${enUrl}" rel="alternate" hreflang="en"' not in src:
        errors.append("Atom entries should expose English alternate links")
    if '<enclosure url="${ogUrl}" type="image/png" length="0" />' not in src:
        errors.append("RSS items should expose OG image enclosures")
    if 'xmlns:media="http://search.yahoo.com/mrss/"' not in src:
        errors.append("Dynamic feeds should keep Media RSS namespace")
    if '"destination": "/api/feed?fmt=rss"' not in vercel:
        errors.append("vercel.json should route /blog/feed.xml to /api/feed?fmt=rss")
    if '"destination": "/api/feed?fmt=atom"' not in vercel:
        errors.append("vercel.json should route /blog/atom.xml to /api/feed?fmt=atom")
    if '"destination": "/api/feed?fmt=json"' not in vercel:
        errors.append("vercel.json should route /blog/feed.json to /api/feed?fmt=json")

    if errors:
        print("[FAIL] Dynamic feed audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    print("[OK] Dynamic feed audit passed: API feed uses stable dates and rich metadata")
    return 0


if __name__ == "__main__":
    sys.exit(main())
