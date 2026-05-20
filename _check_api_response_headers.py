#!/usr/bin/env python3
"""Verify public ingestion APIs opt out of caching and advertise POST."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent

NODE_ENDPOINTS = [
    ROOT / "api" / "errors.js",
    ROOT / "api" / "search-log.js",
    ROOT / "api" / "cwv-ingest.js",
]
EDGE_ENDPOINTS = [
    ROOT / "api" / "csp-report.js",
]


def main() -> int:
    errors: list[str] = []

    for path in NODE_ENDPOINTS:
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT).as_posix()
        if "res.setHeader('Cache-Control', 'no-store, max-age=0')" not in text:
            errors.append(f"{rel}: missing no-store response header")
        if "res.setHeader('Allow', 'POST')" not in text:
            errors.append(f"{rel}: missing Allow: POST response header")

    for path in EDGE_ENDPOINTS:
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT).as_posix()
        if "'Cache-Control': 'no-store, max-age=0'" not in text:
            errors.append(f"{rel}: missing no-store response header")
        if "'Allow': 'POST'" not in text:
            errors.append(f"{rel}: missing Allow: POST response header")
        if "headers: NO_STORE_HEADERS" not in text:
            errors.append(f"{rel}: responses do not consistently use NO_STORE_HEADERS")

    if errors:
        print("FAIL API response header checks:")
        for error in errors:
            print(" -", error)
        return 1

    total = len(NODE_ENDPOINTS) + len(EDGE_ENDPOINTS)
    print(f"OK API response headers ({total} endpoints)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
