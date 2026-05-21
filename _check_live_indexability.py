#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit production sitemap URLs for live indexability.

Static checks catch committed HTML mistakes, but Search Console sees the
deployed URL after Vercel rewrites, redirects, headers, and edge middleware.
This check fetches the live sitemap, then verifies each submitted URL is:

  - 200 OK without following a redirect
  - not excluded by X-Robots-Tag or robots meta noindex
  - self-canonical when the URL is an HTML page

Use LIVE_BASE to point at a preview deployment. Defaults to production.
"""

from __future__ import annotations

import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


DEFAULT_BASE = "https://hsiao.chendermatologist.com"
BASE = os.environ.get("LIVE_BASE", DEFAULT_BASE).rstrip("/")
TIMEOUT = float(os.environ.get("LIVE_INDEX_TIMEOUT", "20"))
NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "HsiaoEyeLiveIndexabilityAudit/1.0 (+https://hsiao.chendermatologist.com/)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        method="GET",
    )
    try:
        with OPENER.open(req, timeout=TIMEOUT) as res:
            return int(res.status), {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as exc:
        return int(exc.code), {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def same_origin(url: str) -> bool:
    return urllib.parse.urlparse(url).netloc == urllib.parse.urlparse(BASE).netloc


def canonical_of(body: bytes) -> str:
    text = body[:250_000].decode("utf-8", errors="replace")
    match = re.search(r'<link\s+rel=["\']canonical["\']\s+href=["\']([^"\']+)["\']', text, re.I)
    return match.group(1).strip() if match else ""


def has_meta_noindex(body: bytes) -> bool:
    text = body[:250_000].decode("utf-8", errors="replace")
    match = re.search(r'<meta\s+name=["\']robots["\']\s+content=["\']([^"\']+)["\']', text, re.I)
    return bool(match and "noindex" in match.group(1).lower())


def normalize_root(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.path == "":
        return urllib.parse.urlunparse(parsed._replace(path="/"))
    return url


def sitemap_urls() -> list[str]:
    sitemap_url = f"{BASE}/sitemap.xml"
    status, headers, body = fetch(sitemap_url)
    if status != 200:
        raise AssertionError(f"{sitemap_url}: expected 200, got {status}")
    ctype = headers.get("content-type", "")
    if "xml" not in ctype:
        raise AssertionError(f"{sitemap_url}: expected XML content-type, got {ctype!r}")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise AssertionError(f"{sitemap_url}: invalid XML: {exc}") from exc
    urls = [(loc.text or "").strip() for loc in root.findall("sm:url/sm:loc", NS)]
    if len(urls) < 20:
        raise AssertionError(f"{sitemap_url}: expected at least 20 sitemap URLs, found {len(urls)}")
    return urls


def audit_url(url: str) -> list[str]:
    errors: list[str] = []
    if not same_origin(url):
        return [f"{url}: sitemap loc is outside {BASE}"]
    if re.search(r"/(?:en|blog|en/blog)/$", urllib.parse.urlparse(url).path):
        errors.append(f"{url}: sitemap loc is a trailing-slash route that redirects")

    status, headers, body = fetch(url)
    if status != 200:
        location = headers.get("location", "")
        suffix = f" -> {location}" if location else ""
        errors.append(f"{url}: expected 200 without redirect, got {status}{suffix}")
        return errors

    xrobots = headers.get("x-robots-tag", "").lower()
    if "noindex" in xrobots:
        errors.append(f"{url}: X-Robots-Tag contains noindex")

    ctype = headers.get("content-type", "").lower()
    if "text/html" in ctype:
        if has_meta_noindex(body):
            errors.append(f"{url}: robots meta contains noindex")
        canonical = canonical_of(body)
        if not canonical:
            errors.append(f"{url}: missing canonical link")
        elif normalize_root(canonical) != normalize_root(url):
            errors.append(f"{url}: canonical mismatch ({canonical})")
    return errors


def main() -> int:
    try:
        urls = sitemap_urls()
    except AssertionError as exc:
        print(f"[FAIL] live indexability audit failed: {exc}")
        return 1

    errors: list[str] = []
    for url in urls:
        errors.extend(audit_url(url))

    if errors:
        print("[FAIL] live indexability audit found issues:")
        for error in errors[:100]:
            print("  - " + error)
        if len(errors) > 100:
            print(f"  ... {len(errors) - 100} more")
        return 1

    print(f"[OK] live indexability audit passed: {len(urls)} sitemap URLs are 200/indexable/self-canonical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
