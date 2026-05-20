#!/usr/bin/env python3
"""Verify cache and MIME headers for first-party static assets."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VERCEL_JSON = ROOT / "vercel.json"

EXPECTED = {
    "/admin/admin.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
    },
    "/admin/admin.css": {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
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
    "/assets/components.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
    "/tools/eye-3d-worker.js": {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
    "/assets/app.css": {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=2592000, stale-while-revalidate=604800",
    },
    "/assets/article.css": {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=2592000, stale-while-revalidate=604800",
    },
}


def main() -> int:
    config = json.loads(VERCEL_JSON.read_text(encoding="utf-8"))
    by_source = {entry.get("source"): entry for entry in config.get("headers", [])}
    errors: list[str] = []

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
