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
    """Blank out full-line // comments and /* */ blocks so assertions read CODE.

    ORDER MATTERS, and getting it wrong is not a small error. Line comments must
    go FIRST: sw.js contains the line

        // Never intercept /admin pages or /api/* — these need fresh responses

    and running the block-comment pass first treats the `/*` in `/api/*` as the
    start of a block that then runs to the next `*/`, silently deleting 4.4 KB of
    real code — including the warmPopular(e) call an assertion below looks for.
    Stripping line comments first removes that `/*` along with its own line.

    Deliberately does NOT strip trailing `code // comment`; that needs
    string-literal awareness to avoid eating `https://`. Nor is it safe against a
    `/*` inside a string literal — this is a text pass, not a parser.
    """
    src = re.sub(r"(?m)^[ \t]*//.*$", "", src)
    return re.sub(r"/\*[\s\S]*?\*/", "", src)


def _call_arg_spans(src: str, callee: str) -> list[tuple[int, int]]:
    """Byte spans of every `<callee>(...)` argument list, by paren matching.

    Used to prove a precache expression is INSIDE the argument passed to
    waitUntil, rather than merely appearing somewhere near it. A preceding-token
    heuristic cannot do this: `return Promise.allSettled(...)` looks fine in
    isolation but is a floated promise when the caller discards the return value.
    Paren matching is not a parser — it does not know about parens inside string
    literals — but sw.js has none in these handlers, and being wrong here fails
    closed.
    """
    spans: list[tuple[int, int]] = []
    for m in re.finditer(re.escape(callee) + r'\s*\(', src):
        depth, i = 0, m.end() - 1
        while i < len(src):
            if src[i] == '(':
                depth += 1
            elif src[i] == ')':
                depth -= 1
                if depth == 0:
                    spans.append((m.end(), i))
                    break
            i += 1
    return spans


def _pattern_inside_call(src: str, callee: str, pattern: str) -> bool:
    """True if ANY match of `pattern` sits inside a `callee(...)` argument list.

    Must consider every occurrence, not just the first: `popularWarm` also
    appears in warmPopular's own re-entry guard, which is not inside waitUntil.

    The pattern must identify the SPECIFIC expression that has to be awaited.
    Asking only whether *some* `Promise.allSettled` is inside waitUntil proves
    nothing — this passes while the shell precache floats:

        const shellPromise = caches.open(CACHE)
          .then(c => Promise.allSettled(SHELL.map(u => c.add(u))));
        e.waitUntil(Promise.allSettled([self.skipWaiting()]));
    """
    spans = _call_arg_spans(src, callee)
    if not spans:
        return False
    return any(
        start <= m.start() < end
        for m in re.finditer(pattern, src)
        for start, end in spans
    )


def _inside_call(src: str, callee: str, needle: str) -> bool:
    return _pattern_inside_call(src, callee, r'\b' + re.escape(needle) + r'\b')


_VALUE_POSITION_RE = re.compile(r'(?:=>|\breturn)$')


def _awaited_in_call(src: str, callee: str, pattern: str) -> bool:
    """True if a match of `pattern` is inside `callee(...)` AND in value position.

    Lexical containment alone is not enough. This floats the precache while
    sitting entirely inside waitUntil's parentheses, and needs no decoy — just an
    ordinary missing `return` after an arrow-to-block refactor:

        e.waitUntil(
          caches.open(CACHE).then((c) => {
            Promise.allSettled(SHELL.map((u) => c.add(u)));   // <- not returned
          })
        );

    The outer promise resolves with undefined before the adds settle. So the
    match must ALSO be preceded by `=>` (concise arrow body) or `return`, which
    are the two ways its value reaches the chain handed to waitUntil.
    """
    spans = _call_arg_spans(src, callee)
    if not spans:
        return False
    for m in re.finditer(pattern, src):
        if not any(start <= m.start() < end for start, end in spans):
            continue
        if _VALUE_POSITION_RE.search(src[:m.start()].rstrip()):
            return True
    return False


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
        shell_precache = (
            r'Promise\.allSettled\(\s*SHELL\.map\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.add\('
        )
        if not re.search(shell_precache, install_src):
            errors.append(
                "sw.js install must precache the SHELL tier and tolerate partial "
                "failures: Promise.allSettled(SHELL.map((u) => c.add(u)))"
            )
        # P-04 proper: install must not pull in the deferred tiers.
        if re.search(r'\b(?:PRECACHE|POPULAR|LAZY)\.map\b', install_src):
            errors.append(
                "sw.js install must precache SHELL only (P-04) — POPULAR is warmed "
                "from the first fetch event and LAZY by the runtime handler"
            )
        # The precache must be inside the install lifetime, or the worker can be
        # terminated before it completes. Checking `waitUntil(` and the precache
        # INDEPENDENTLY was a false-green: a dummy `e.waitUntil(Promise.resolve())`
        # next to a separately floated SHELL precache satisfied both. Require the
        # precache to sit inside waitUntil's argument list.
        if 'waitUntil(' not in install_src:
            errors.append("sw.js install must wrap its precache in event.waitUntil(...)")
        elif not _awaited_in_call(install_src, 'waitUntil', shell_precache):
            errors.append(
                "sw.js install does not AWAIT its SHELL precache — the promise must "
                "be inside event.waitUntil(...) and in value position (returned from "
                "the chain, not left as a bare statement), or the worker can be "
                "terminated before the adds settle"
            )

    # POPULAR is warmed from the first fetch event (see warmPopular in sw.js),
    # NOT from activate — awaiting it in activate would gate the activating ->
    # activated transition and stall controlled clients after an update.
    #
    # SCOPE, stated honestly: everything below is a REGRESSION GUARD built on
    # text matching, not a proof that the precache promise is wired into an
    # event's lifetime. Proving that needs a real JS AST, which this repo has no
    # parser for. It reliably catches the specific regressions that have already
    # happened here twice (install widening back to another tier; the POPULAR
    # precache reverting to a promise nobody holds). It will NOT catch an
    # arbitrary rewrite that keeps the same tokens, and it WILL fail loudly on a
    # legitimate refactor — renaming a tier constant, switching to `for...of`,
    # or extracting a helper. That direction is deliberate: fail-closed on a
    # refactor is a conversation, a false green is a shipped bug.
    warm_m = re.search(r'function\s+warmPopular\s*\([\s\S]*?\n\}', src)
    warm_src = _strip_js_comments(warm_m.group(0)) if warm_m else ""
    if not warm_src:
        errors.append(
            "sw.js should warm the POPULAR tier from a fetch event "
            "(function warmPopular) rather than from install or activate"
        )
    else:
        if not re.search(r'Promise\.allSettled\(\s*missing\.map|Promise\.allSettled\(\s*POPULAR\.map', warm_src):
            errors.append("sw.js warmPopular should precache the POPULAR tier")
        # The precache must reach waitUntil, or the worker can be terminated
        # mid-flight. Prove containment by paren matching rather than by looking
        # at the preceding token: an earlier version accepted a leading `return`,
        # but warmPopular(e) is called for its side effect and its return value
        # is discarded, so `return Promise.allSettled(...)` is still a floated
        # promise. The binding handed to waitUntil is the one that must carry it.
        # Require the exact single-argument shape, not merely "the binding
        # appears somewhere inside waitUntil's parens". Lexical containment is
        # satisfied by `e.waitUntil((popularWarm, Promise.resolve()))`, where the
        # comma operator throws the promise away.
        if not re.search(r'\bwaitUntil\(\s*popularWarm\s*\)', warm_src):
            errors.append(
                "sw.js warmPopular must pass its precache promise to e.waitUntil(...) "
                "as the sole argument — warmPopular's own return value is discarded "
                "by the caller, so returning the promise does not keep the worker alive"
            )
        # It must consult the cache instead of a module flag, or a restarted
        # worker re-issues every request.
        if '.match(' not in warm_src:
            errors.append(
                "sw.js warmPopular should ask the cache which POPULAR entries are "
                "missing — a module-level flag resets when the worker restarts"
            )
    if re.search(r'\bPromise\.allSettled\(\s*POPULAR\.map', install_src or ""):
        errors.append("sw.js install must not precache POPULAR — it is warmed on first fetch")

    activate_m = re.search(r"addEventListener\(\s*['\"]activate['\"][\s\S]*?\n\}\);", src)
    activate_src = _strip_js_comments(activate_m.group(0)) if activate_m else ""
    if not activate_src:
        errors.append("sw.js has no recognisable activate handler")
    elif re.search(r'Promise\.allSettled\(\s*POPULAR\.map', activate_src):
        errors.append(
            "sw.js activate must not precache POPULAR — awaiting it gates the "
            "activating->activated transition and stalls controlled clients"
        )

    # Checking warmPopular's BODY says nothing about whether anything calls it.
    # Deleting the single call site left every assertion above green while
    # POPULAR was never warmed at all; moving the call into install or activate
    # reintroduced the lifecycle stall without tripping the guards, because
    # those only reject a direct Promise.allSettled(POPULAR.map ...).
    fetch_m = re.search(r"addEventListener\(\s*['\"]fetch['\"][\s\S]*?\n\}\);", src)
    fetch_src = _strip_js_comments(fetch_m.group(0)) if fetch_m else ""
    if not fetch_src:
        errors.append("sw.js has no recognisable fetch handler")
    elif not re.search(r'\bwarmPopular\s*\(', fetch_src):
        errors.append(
            "sw.js fetch handler must call warmPopular(e) — the POPULAR tier is "
            "warmed from the first fetch event and nothing else invokes it"
        )
    for handler_name, handler_src in (('install', install_src), ('activate', activate_src)):
        if handler_src and re.search(r'\bwarmPopular\s*\(', handler_src):
            errors.append(
                f"sw.js {handler_name} must not call warmPopular — it belongs to the "
                f"fetch event; calling it here re-gates the worker lifecycle"
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
