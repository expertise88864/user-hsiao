#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit PWA manifest, offline page, and service-worker precache targets."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BAD_MOJIBAKE_RE = re.compile("(?:\\u00c3.|\\u00c2.|\\u00e2\\u20ac|\\ufffd)")


def has_bad_text(value: object) -> bool:
    if isinstance(value, str):
        return bool(BAD_MOJIBAKE_RE.search(value))
    if isinstance(value, list):
        return any(has_bad_text(item) for item in value)
    if isinstance(value, dict):
        return any(has_bad_text(item) for item in value.values())
    return False


def local_url_exists(url: str) -> bool:
    clean = url.split("?", 1)[0].split("#", 1)[0]
    if clean == "/":
        return (ROOT / "index.html").exists()
    if clean.endswith("/"):
        return (ROOT / clean.strip("/") / "index.html").exists()
    rel = clean.lstrip("/")
    return (
        (ROOT / rel).exists()
        or (ROOT / f"{rel}.html").exists()
        or (ROOT / rel / "index.html").exists()
    )


def audit_manifest(errors: list[str]) -> None:
    path = ROOT / "manifest.json"
    if not path.exists():
        errors.append("manifest.json is missing")
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"manifest.json is invalid JSON: {exc}")
        return

    for field in ("name", "short_name", "description", "start_url", "display", "icons"):
        if field not in data:
            errors.append(f"manifest.json missing {field}")
    if has_bad_text(data):
        errors.append("manifest.json appears to contain mojibake text")
    if data.get("start_url") and not local_url_exists(data["start_url"]):
        errors.append(f"manifest start_url does not resolve locally: {data['start_url']}")

    icons = data.get("icons", [])
    if not isinstance(icons, list) or not icons:
        errors.append("manifest icons must be a non-empty list")
        return
    purposes = " ".join(str(icon.get("purpose", "")) for icon in icons if isinstance(icon, dict))
    if "maskable" not in purposes:
        errors.append("manifest icons should include a maskable icon")
    for icon in icons:
        if not isinstance(icon, dict):
            errors.append("manifest icon entry must be an object")
            continue
        src = icon.get("src")
        if not src or not local_url_exists(str(src)):
            errors.append(f"manifest icon missing locally: {src}")

    screenshots = data.get("screenshots", [])
    if not isinstance(screenshots, list) or not screenshots:
        errors.append("manifest screenshots should include at least one install preview")
    for screenshot in screenshots:
        if not isinstance(screenshot, dict):
            errors.append("manifest screenshot entry must be an object")
            continue
        src = screenshot.get("src")
        if not src or not local_url_exists(str(src)):
            errors.append(f"manifest screenshot missing locally: {src}")
        if not screenshot.get("sizes"):
            errors.append(f"manifest screenshot missing sizes: {src}")
        if not screenshot.get("type"):
            errors.append(f"manifest screenshot missing type: {src}")

    shortcuts = data.get("shortcuts", [])
    if not isinstance(shortcuts, list) or not shortcuts:
        errors.append("manifest shortcuts should be a non-empty list")
    for shortcut in shortcuts:
        if not isinstance(shortcut, dict):
            errors.append("manifest shortcut entry must be an object")
            continue
        url = shortcut.get("url")
        if not url or not local_url_exists(str(url)):
            errors.append(f"manifest shortcut URL does not resolve locally: {url}")
        shortcut_icons = shortcut.get("icons", [])
        if not isinstance(shortcut_icons, list) or not shortcut_icons:
            errors.append(f"manifest shortcut missing icons: {shortcut.get('name') or url}")
            continue
        for icon in shortcut_icons:
            if not isinstance(icon, dict):
                errors.append(f"manifest shortcut icon entry must be an object: {shortcut.get('name') or url}")
                continue
            src = icon.get("src")
            if not src or not local_url_exists(str(src)):
                errors.append(f"manifest shortcut icon missing locally: {src}")


def audit_offline(errors: list[str]) -> None:
    path = ROOT / "offline.html"
    if not path.exists():
        errors.append("offline.html is missing")
        return
    src = path.read_text(encoding="utf-8")
    if BAD_MOJIBAKE_RE.search(src):
        errors.append("offline.html appears to contain mojibake text")
    if '<meta name="robots" content="noindex,nofollow"' not in src:
        errors.append("offline.html should be noindex,nofollow")
    if 'id="retryConnection"' not in src:
        errors.append("offline.html missing retry button")
    if "addEventListener('online'" not in src and 'addEventListener("online"' not in src:
        errors.append("offline.html should reload when the browser comes back online")


def _strip_js_comments(src: str) -> str:
    """Blank out /* */ and full-line // comments so assertions read CODE only.

    Deliberately does NOT try to strip trailing `code // comment` — that would
    need string-literal awareness to avoid eating `https://`. Full-line stripping
    is what the assertions below need; anything stricter belongs in a real parser.
    """
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return re.sub(r"(?m)^[ \t]*//.*$", "", src)


def audit_service_worker(errors: list[str]) -> None:
    path = ROOT / "sw.js"
    if not path.exists():
        errors.append("sw.js is missing")
        return
    src = path.read_text(encoding="utf-8")
    if BAD_MOJIBAKE_RE.search(src):
        errors.append("sw.js appears to contain mojibake text")
    # P-04 — this used to assert the literal string `Promise.allSettled(PRECACHE.map`,
    # and that is precisely how the bug it was meant to prevent got in: this
    # checker was PORTED and sw.js was changed from `SHELL.map` to `PRECACHE.map`
    # in the SAME commit (2429a36). sw.js was edited to satisfy the imported
    # check instead of the check being adapted to this repo's multi-stage
    # precache design, so install started fetching all ~37 URLs while three
    # separate comments in sw.js still described a ~10-URL shell.
    # The invariant this check actually cares about is "a partial precache
    # failure must not fail the INSTALL" — which holds for any tier array.
    # Install precaches SHELL; activate precaches POPULAR; LAZY is runtime-only.
    # So scope the search to the install handler. A file-wide search would be a
    # false negative: `activate` also calls Promise.allSettled, so an install
    # rewritten to bare Promise.all would still match and pass. (Confirmed by
    # mutation — a file-wide version of this check stayed green on exactly that
    # mutation before it was tightened.)
    # Comments must be stripped before matching. The install handler documents
    # this very rule and quotes `Promise.allSettled(...)` in prose, so a naive
    # text search is satisfied by the COMMENT explaining the invariant even when
    # the code below it violates it. (Also confirmed by mutation.)
    install_m = re.search(r"addEventListener\(\s*['\"]install['\"][\s\S]*?\n\}\);", src)
    install_src = _strip_js_comments(install_m.group(0)) if install_m else ""
    if not install_src:
        errors.append("sw.js has no recognisable install handler")
    else:
        # Assert the SHELL cache-add, not merely "some array is allSettled".
        # A `\w+\.map` pattern accepts PRECACHE.map — i.e. it accepts the exact
        # P-04 regression this check exists to prevent.
        if not re.search(
            r'Promise\.allSettled\(\s*SHELL\.map\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.add\(',
            install_src,
        ):
            errors.append(
                "sw.js install must precache the SHELL tier and tolerate partial "
                "failures: Promise.allSettled(SHELL.map((u) => c.add(u)))"
            )
        # P-04 proper: install must not pull in the deferred tiers.
        if re.search(r'\b(?:PRECACHE|POPULAR|LAZY)\.map\b', install_src):
            errors.append(
                "sw.js install must precache SHELL only (P-04) — POPULAR belongs to "
                "activate and LAZY to the runtime handler"
            )
        # The precache must be inside the install lifetime, or the worker can be
        # terminated before it completes.
        if 'waitUntil(' not in install_src:
            errors.append("sw.js install must wrap its precache in event.waitUntil(...)")

    # Same failure mode one stage later: activate precaches POPULAR, and that
    # promise must be awaited inside waitUntil. It was previously floated
    # ("schedule then return immediately"), which only survived because install
    # precached POPULAR too. Once install is SHELL-only, a floating promise here
    # can be killed with the worker and silently drop offline coverage.
    activate_m = re.search(r"addEventListener\(\s*['\"]activate['\"][\s\S]*?\n\}\);", src)
    activate_src = _strip_js_comments(activate_m.group(0)) if activate_m else ""
    if not activate_src:
        errors.append("sw.js has no recognisable activate handler")
    else:
        if not re.search(r'Promise\.allSettled\(\s*POPULAR\.map', activate_src):
            errors.append("sw.js activate should precache the POPULAR tier")
        if re.search(r'\n\s*Promise\.allSettled\(\s*POPULAR\.map', activate_src):
            errors.append(
                "sw.js activate floats the POPULAR precache promise — return it so "
                "waitUntil keeps the worker alive until it settles"
            )
    if "skipWaiting" not in src or "clients.claim" not in src:
        errors.append("sw.js should call skipWaiting and clients.claim for update reliability")
    if "url.search.includes('v=')" not in src:
        errors.append("sw.js should handle cache-busted ?v= assets network-first")
    if "GENERATED_JSON.has(url.pathname)" not in src or "/assets/search-index.json" not in src:
        errors.append("sw.js should handle generated JSON assets network-first")
    if "url.pathname.startsWith('/admin')" not in src:
        errors.append("sw.js should bypass /admin so the editor is always fresh")
    if "url.pathname === '/reset-sw'" not in src:
        errors.append("sw.js should bypass reset-sw pages")

    match = re.search(r"const\s+PRECACHE\s*=\s*\[([\s\S]*?)\];", src)
    if not match:
        errors.append("sw.js PRECACHE list not found")
        return
    inner = match.group(1)
    precache = re.findall(r"['\"]([^'\"]+)['\"]", inner)
    spread_idents = re.findall(r"\.\.\.(\w+)", inner)
    # If PRECACHE composes from spread arrays (e.g. [...SHELL, ...POPULAR]),
    # fan out and collect strings from each named array's declaration.
    for ident in spread_idents:
        sub = re.search(rf"const\s+{ident}\s*=\s*\[([\s\S]*?)\];", src)
        if sub:
            precache.extend(re.findall(r"['\"]([^'\"]+)['\"]", sub.group(1)))
    if not precache:
        errors.append("sw.js PRECACHE list is empty")
    for url in precache:
        if url.startswith("/") and not local_url_exists(url):
            errors.append(f"sw.js PRECACHE target missing locally: {url}")
        # Core runtime bundles (blog-shared.js) may be precached intentionally
        # to make first-page load instant. The SW fetch handler already does
        # network-first when ?v= is on the URL, so updated bundles refresh
        # transparently. Only flag JS bundles that look like third-party.
        if re.search(r"\.js(?:$|\?)", url) and 'blog-shared' not in url:
            errors.append(f"sw.js PRECACHE should not include JavaScript bundles; keep them network/runtime cached: {url}")


def main() -> int:
    errors: list[str] = []
    audit_manifest(errors)
    audit_offline(errors)
    audit_service_worker(errors)

    if errors:
        print("[FAIL] PWA audit found issues:")
        for error in errors:
            print(" - " + error)
        return 1

    print("[OK] PWA audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
