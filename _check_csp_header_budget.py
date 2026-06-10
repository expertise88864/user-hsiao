#!/usr/bin/env python
"""Keep route-scoped CSP response headers below common client limits."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MIDDLEWARE = ROOT / "middleware.js"
MAX_CSP_BYTES = 8 * 1024
MAX_TOTAL_SECURITY_HEADER_BYTES = 12 * 1024


def main() -> int:
    source = MIDDLEWARE.read_text(encoding="utf-8")
    match = re.search(
        r"const INLINE_SCRIPT_HASHES_BY_ROUTE = Object\.freeze\((\{[\s\S]*?\})\);",
        source,
    )
    if not match:
        print("[FAIL] route-scoped CSP hash map is missing")
        return 1

    route_hashes = json.loads(match.group(1))
    fixed = (
        "default-src 'self'; script-src 'self'  "
        "https://www.googletagmanager.com https://www.google-analytics.com "
        "https://www.clarity.ms https://*.clarity.ms https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob: https://hsiao.chendermatologist.com "
        "https://*.vercel.com https://*.vercel.app https://www.google-analytics.com "
        "https://stats.g.doubleclick.net https://www.googletagmanager.com; "
        "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com "
        "https://*.analytics.google.com https://*.clarity.ms https://stats.g.doubleclick.net; "
        "frame-src 'self' https://www.google.com https://www.youtube.com; "
        "frame-ancestors 'self'; base-uri 'self'; form-action 'self' mailto:; "
        "object-src 'none'; manifest-src 'self'; worker-src 'self'; "
        "require-trusted-types-for 'script'; trusted-types default hs-policy; "
        "report-uri /api/csp-report; upgrade-insecure-requests"
    )

    failures: list[str] = []
    largest = ("", 0)
    for route, hashes in route_hashes.items():
        hash_bytes = sum(len(f"'{value}' ") for value in hashes)
        csp_bytes = len(fixed.encode("utf-8")) + hash_bytes
        total_bytes = csp_bytes + len('Reporting-Endpoints: csp-endpoint="/api/csp-report"\r\n')
        if csp_bytes > largest[1]:
            largest = (route, csp_bytes)
        if csp_bytes > MAX_CSP_BYTES:
            failures.append(f"{route}: CSP is {csp_bytes} bytes")
        if total_bytes > MAX_TOTAL_SECURITY_HEADER_BYTES:
            failures.append(f"{route}: security headers are at least {total_bytes} bytes")

    if "Content-Security-Policy-Report-Only" in source:
        failures.append("duplicate report-only CSP header must not be emitted")

    if failures:
        print("[FAIL] CSP header budget exceeded:")
        for failure in failures:
            print(" -", failure)
        return 1

    print(
        f"[OK] CSP header budget passed: {len(route_hashes)} routes, "
        f"largest {largest[0]} at {largest[1]} bytes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
