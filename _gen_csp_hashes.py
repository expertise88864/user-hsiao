#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — generate route-scoped SHA-256 hashes for executable inline scripts.

Each HTML route receives only the hashes needed by that page. A previous global
allowlist repeated every site's hashes in every response and eventually made
the CSP headers large enough for standards-compliant HTTP clients to reject.

Run as a build step BEFORE `git push` (also wired into quality.yml).

This is the practical alternative to runtime nonce injection: every inline
tag we control gets its hash listed in the CSP, so the browser allows JUST
those exact byte sequences to execute. Any reflected-XSS injected <script>
will have a different hash → blocked.

Limitations:
  - Edited inline content (admin WYSIWYG) doesn't ship inline JS, so this
    is fine.
  - Third-party tags (GTM, GA, AdSense) aren't inline — they're loaded by
    src= and protected by 'self'/host allowlist, not hashes.
  - When you edit an inline <script>, run this script + redeploy. Forgotten?
    Browser blocks the script — site partially broken, fix is one redeploy.

Output: rewrites `INLINE_SCRIPT_HASHES_BY_ROUTE` in middleware.js.
Idempotent.
"""
import os, re, hashlib, base64, glob, json

ROOT = os.path.dirname(os.path.abspath(__file__))

# The external-script exclusion must key on a REAL `src` attribute, which is
# always whitespace-separated (`<script … src=…>`). Using `\bsrc=` was wrong:
# `\b` also matches the boundary in `data-src=` / `x-src=`, so an INLINE
# executable script carrying such a data-attribute would be treated as external,
# never hashed, and then CSP-BLOCKED in production (fail-closed). Require a
# leading `\s` so only a standalone `src` attribute triggers the exclusion.
# (`\s*=` also correctly catches `src = "…"` with spaces around the equals.)
INLINE_SCRIPT_RE = re.compile(
    r'<script(?![^>]*\ssrc\s*=)([^>]*)>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)
def sha256_b64(content: bytes) -> str:
    h = hashlib.sha256(content).digest()
    return base64.b64encode(h).decode('ascii')


# EXTRACTED, not copied. The fonts bootstrap also lives in the CMS scaffold
# template; a second literal here would be free to drift from it and the drift
# would surface only as a CSP block on a live draft. Read it from the one place
# that actually emits it, and fail loudly if it moves.
def fonts_bootstrap() -> bytes:
    src = open(os.path.join(ROOT, 'api', 'admin', '_new.js'), encoding='utf-8').read()
    m = re.search(r"<script>((?:(?!</script>).)*getElementById\('hs-fonts'\)"
                  r"(?:(?!</script>).)*)</script>", src, re.DOTALL)
    if not m:
        raise SystemExit(
            "_gen_csp_hashes.py: could not find the hs-fonts bootstrap in "
            "api/admin/_new.js. If it was renamed or removed, update this "
            "extractor — do NOT leave __fallback__ unseeded, or CMS-created "
            "drafts will download the font CSS and never apply it.")
    return m.group(1).encode('utf-8')


def routes_for_path(path: str) -> list[str]:
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    if rel == 'index.html':
        return ['/', '/index.html']
    if rel == '404.html':
        return ['/404', '/404.html', '__fallback__']

    stem = rel[:-5] if rel.endswith('.html') else rel
    if stem.endswith('/index'):
        base = '/' + stem[:-6].strip('/')
        if base == '/':
            return ['/', '/index.html']
        return sorted({base, base + '/', '/' + rel.lstrip('/')})
    return sorted({'/' + stem.lstrip('/'), '/' + rel.lstrip('/')})


def is_executable_script(attrs: str) -> bool:
    type_match = re.search(r'\btype\s*=\s*["\']([^"\']+)["\']', attrs, re.I)
    if not type_match:
        return True
    script_type = type_match.group(1).strip().lower()
    # Structured data is inert and does not need script-src authorization.
    return script_type not in {'application/ld+json', 'application/json'}


def collect_hashes_by_route():
    route_hashes: dict[str, set[str]] = {}

    for pattern in ['*.html', 'blog/*.html', 'en/*.html', 'en/blog/*.html', 'tools/*.html']:
        for path in glob.glob(os.path.join(ROOT, pattern)):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    html = f.read()
            except Exception:
                continue

            hashes: set[str] = set()
            for m in INLINE_SCRIPT_RE.finditer(html):
                if not is_executable_script(m.group(1)):
                    continue
                # Hash the EXACT inner-text bytes (browsers normalise nothing)
                body = m.group(2).encode('utf-8')
                hashes.add('sha256-' + sha256_b64(body))
            for route in routes_for_path(path):
                route_hashes.setdefault(route, set()).update(hashes)

    route_hashes.setdefault('__fallback__', set())
    # P-01: a page created by the CMS (api/admin/_new.js) commits straight to
    # main and is LIVE before this generator ever sees it, so its route is absent
    # from the map and falls through to __fallback__. The scaffold loads fonts
    # non-blockingly via a preload that an inline bootstrap promotes to a
    # stylesheet — if that bootstrap's hash is not in the fallback, a fresh draft
    # downloads the font CSS and never applies it.
    #
    # Today the hash is ALREADY there incidentally: 404.html feeds __fallback__
    # and 404.html carries the same bootstrap. That is a coincidence of content,
    # not a guarantee — rewrite 404.html to drop Google Fonts and every future
    # draft silently loses its fonts, with no check anywhere that would notice.
    # This line makes the dependency explicit and independent of 404.html.
    #
    # It does not weaken the fail-closed posture: the hash admits exactly one
    # script, whose whole capability is setting .rel='stylesheet' on the element
    # with id="hs-fonts". Borrowing it buys an attacker nothing else.
    route_hashes['__fallback__'].add('sha256-' + sha256_b64(fonts_bootstrap()))
    return {route: sorted(hashes) for route, hashes in sorted(route_hashes.items())}


def rewrite_middleware(route_hashes):
    mw_path = os.path.join(ROOT, 'middleware.js')
    with open(mw_path, 'r', encoding='utf-8') as f:
        src = f.read()

    route_json = json.dumps(route_hashes, ensure_ascii=True, indent=2)

    block = f"""// AUTO-GENERATED by _gen_csp_hashes.py — DO NOT EDIT MANUALLY
// Re-run after editing executable inline <script> content in HTML.
// Each route carries only its own hashes to keep response headers bounded.
const INLINE_SCRIPT_HASHES_BY_ROUTE = Object.freeze({route_json});
// END AUTO-GENERATED"""

    # Replace any existing block, or insert after the imports
    pattern = re.compile(
        r'// AUTO-GENERATED by _gen_csp_hashes\.py.*?// END AUTO-GENERATED',
        re.DOTALL,
    )
    if pattern.search(src):
        new_src = pattern.sub(block, src)
    else:
        # Insert before `export const config`
        new_src = re.sub(
            r"(export const config = \{)",
            block + "\n\n\\1",
            src,
            count=1,
        )

    if new_src != src:
        with open(mw_path, 'w', encoding='utf-8') as f:
            f.write(new_src)
        return True
    return False


def main():
    route_hashes = collect_hashes_by_route()
    unique_hashes = {h for hashes in route_hashes.values() for h in hashes}
    longest = max((len(hashes) for hashes in route_hashes.values()), default=0)
    print(f'Collected {len(unique_hashes)} executable script hashes across '
          f'{len(route_hashes)} routes (max {longest} hashes/route)')
    changed = rewrite_middleware(route_hashes)
    if changed:
        print(f'middleware.js updated.')
    else:
        print(f'middleware.js already up to date.')


if __name__ == '__main__':
    main()
