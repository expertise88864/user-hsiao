"""
HsiaoEye: verify generated JSON assets have crawler/user-friendly cache headers.

These JSON files power client-side search, related-article cards, i18n text,
and dictionary tooltips. They change when content/admin data changes, so they
should be short-cache + stale-while-revalidate, not immutable and not no-store.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VERCEL = ROOT / "vercel.json"
SHARED = ROOT / "blog" / "blog-shared.js"
SW = ROOT / "sw.js"

EXPECTED = {
    "/assets/search-index.json": "max-age=300",
    "/assets/related.json": "max-age=300",
    "/assets/i18n.json": "max-age=3600",
    "/assets/medical-dictionary.json": "max-age=300",
}


def header_map(route: dict) -> dict[str, str]:
    return {
        str(item.get("key", "")).lower(): str(item.get("value", ""))
        for item in route.get("headers", [])
        if isinstance(item, dict)
    }


def main() -> int:
    errors: list[str] = []
    try:
        config = json.loads(VERCEL.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[FAIL] vercel.json invalid or missing: {exc}")
        return 1

    routes = {
        str(route.get("source", "")): header_map(route)
        for route in config.get("headers", [])
        if isinstance(route, dict)
    }

    for source, max_age in EXPECTED.items():
        headers = routes.get(source)
        if not headers:
            errors.append(f"{source}: missing explicit vercel header block")
            continue
        content_type = headers.get("content-type", "")
        cache_control = headers.get("cache-control", "")
        if content_type != "application/json; charset=utf-8":
            errors.append(f"{source}: expected application/json content type")
        if max_age not in cache_control:
            errors.append(f"{source}: expected Cache-Control to include {max_age}")
        if "stale-while-revalidate=86400" not in cache_control:
            errors.append(f"{source}: expected stale-while-revalidate=86400")
        if "immutable" in cache_control or "no-store" in cache_control:
            errors.append(f"{source}: generated JSON must not be immutable or no-store")

    shared = SHARED.read_text(encoding="utf-8")
    if re.search(r"fetch\('/assets/search-index\.json',\s*\{[^}]*cache:\s*['\"]no-store['\"]", shared):
        errors.append("Cmd+K search-index fetch should not use cache: 'no-store'")

    sw = SW.read_text(encoding="utf-8")
    if "GENERATED_JSON.has(url.pathname)" not in sw:
        errors.append("sw.js should handle generated JSON assets with a dedicated network-first path")
    for source in EXPECTED:
        if source not in sw:
            errors.append(f"sw.js generated JSON network-first list missing {source}")

    if errors:
        print("[FAIL] Generated JSON cache audit failed:")
        for error in errors:
            print("  - " + error)
        return 1

    print("[OK] Generated JSON cache audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
