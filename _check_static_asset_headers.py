#!/usr/bin/env python3
"""Verify cache and MIME headers for first-party static assets."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VERCEL_JSON = ROOT / "vercel.json"

EXPECTED = {
    "/admin/admin.css": {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
    },
    # Round-2 review: these two were served `immutable` while being referenced
    # WITHOUT any ?v= cache-buster. Per RFC 8246 `immutable` says the response
    # will not change DURING ITS FRESHNESS LIFETIME, so it suppresses
    # revalidation on reload — an inappropriate promise for an unversioned
    # asset, and contrary to D-11, which scopes `immutable` to VERSIONED ones.
    # `immutable` was dropped and max-age kept; both paths are pinned here
    # because neither was covered by this checker before, so the policy could
    # drift back unnoticed.
    # NOTE this is a POLICY-CORRECTNESS fix, not an update-propagation fix:
    # max-age is still 30 days, and both icons are additionally in sw.js's
    # SHELL precache behind a cache-first handler. Bumping the SW cache
    # version is NOT reliably immediate either: it makes a new CacheStorage
    # generation, but precache `c.add()` is a default-mode fetch that may
    # reuse a still-fresh HTTP-cached response and store the OLD bytes. The
    # two dependable options here are versioning the icon URL itself (this
    # site uses an explicit <link rel="icon" href="/favicon.ico">, whose href
    # can carry a version — only the IMPLICIT fallback uses the fixed
    # /favicon.ico path) or making the precache fetch bypass/revalidate the
    # HTTP cache, e.g.
    # `new Request(u, { cache: 'reload' })`. trimCache's TTL eviction or
    # browser storage eviction may also clear it, but cannot be relied on.
    "/icon.svg": {
        "Cache-Control": "public, max-age=2592000",
    },
    "/favicon.ico": {
        "Cache-Control": "public, max-age=2592000",
    },
    # S-02: an SVG served same-origin can carry <script>. The 63 references on
    # this site are all <img src>, where scripts are disabled by spec, and there
    # is no <use>, <object>, <iframe> or <embed> usage — so the only exposure is
    # DIRECT NAVIGATION to the file. `default-src 'none'; sandbox` neutralises
    # that without touching <img> rendering, which does not treat the response as
    # a document. Pinned here because a header rule with no checker can drift
    # back silently, which is how S-02 sat open in the first place.
    "/(.*).svg": {
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
    },
    "/blog/blog-shared.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
    "/blog/blog-admin.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
    "/blog/pagefind-search.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
    "/tools/eye-3d-worker.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
    "/assets/app.css": {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
    },
    "/assets/article.css": {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
    },
    "/llms.txt": {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
    "/opensearch.xml": {
        "Content-Type": "application/opensearchdescription+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
    },
    "/blog/feed.json": {
        "Content-Type": "application/feed+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600, must-revalidate",
    },
    "/assets/og/(.*)": {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
    "/blog/:slug([a-z0-9-]+)": {
        "Cache-Control": "public, max-age=60, s-maxage=600, stale-while-revalidate=86400",
    },
}


def main() -> int:
    config = json.loads(VERCEL_JSON.read_text(encoding="utf-8"))
    by_source = {entry.get("source"): entry for entry in config.get("headers", [])}
    errors: list[str] = []

    # T-02: a new article's og:image points at /assets/og/<slug>.png before
    # _gen_og_images.py has produced and committed the PNG, so the share card
    # 404s. This rewrite falls through to the dynamic renderer on a miss;
    # Vercel checks the filesystem BEFORE rewrites, so an existing static PNG
    # still wins. Pinned because a rewrite with no checker can be dropped
    # silently and the only symptom is a blank card on a freshly published post.
    og_rewrite = {"source": "/assets/og/:slug.png", "destination": "/api/og?slug=:slug"}
    if og_rewrite not in config.get("rewrites", []):
        errors.append(f"vercel.json is missing the OG fallback rewrite {og_rewrite} "
                      f"(T-02) — a new article's share card would 404 until its "
                      f"static PNG is generated and committed")
    # The same path's Cache-Control must NOT be immutable: it is applied by
    # REQUEST PATH, so it lands on the dynamic placeholder too, and `immutable`
    # would pin that placeholder in caches long after the real PNG shipped.
    og_headers = {h.get("key"): h.get("value")
                  for h in by_source.get("/assets/og/(.*)", {}).get("headers", [])}
    if "immutable" in (og_headers.get("Cache-Control") or ""):
        errors.append("/assets/og/(.*): Cache-Control must not be immutable — it "
                      "also applies to the dynamic fallback, which would then be "
                      "cached as though it were the final card (T-02)")

    for source, expected_headers in EXPECTED.items():
        entry = by_source.get(source)
        if not entry:
            errors.append(f"{source}: missing header rule")
            continue

        actual = {h.get("key"): h.get("value") for h in entry.get("headers", [])}
        for key, expected in expected_headers.items():
            got = actual.get(key)
            if got != expected:
                errors.append(f"{source}: {key} is {got!r}, expected {expected!r}")

    if errors:
        print("FAIL static asset header checks:")
        for error in errors:
            print(" -", error)
        return 1

    print(f"OK static asset headers ({len(EXPECTED)} rules)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
