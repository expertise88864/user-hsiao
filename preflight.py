#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
preflight.py — one-command pre-push gate for HsiaoEye.

WHY THIS EXISTS
    Before every `git push`, you must prove that what you're pushing is a
    FIXED POINT of the generator chain (so CI's drift check passes) and that
    the validators are green. Doing this by hand is error-prone for a smaller
    model. This script does it deterministically.

WHAT IT DOES
    1. Parses the AUTHORITATIVE generator chain from .github/workflows/quality.yml
       (the "Drift check" step) — so it never goes stale when someone adds a
       new generator. (Falls back to an embedded list with a loud warning if
       parsing fails.)
    2. Runs the full chain, `git add -A`, runs it AGAIN, and checks `git diff`
       is empty == fixed point. Non-empty means you missed a step or something
       is non-idempotent; it prints the drifting files.
    3. Runs validate.py and _check_all.py --quick.
    Exit code 0 == safe to run codex review then push. Non-zero == do not push.

USAGE
    python preflight.py            # full gate
    python preflight.py --fast     # skip the 2nd chain run (drift check); still validates
    python preflight.py --chain    # just print the parsed chain and exit

NOTES / HARNESS LIMITS (see docs/MODEL-GUIDE.md)
    - Sets PYTHONIOENCODING=utf-8 for children (Windows cp950 crashes on Unicode).
    - This does NOT push and does NOT run codex review — those are steps 2 and 3
      of the ritual (docs/DECISIONS.md D-20). It also does NOT run the browser
      SEO smoke tests or visual regression (those need Playwright/Chromium and,
      for some, the live site). CI runs those; preflight covers the static gate.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
QUALITY_YML = ROOT / ".github" / "workflows" / "quality.yml"

# Embedded fallback — used ONLY if quality.yml can't be parsed. Keep roughly in
# sync, but the parser is the real source of truth.
FALLBACK_CHAIN = [
    "halfwidth_to_fullwidth.py", "_normalize_reviewed_by.py", "_inject_speed_insights.py",
    "_gen_feeds.py", "_gen_related.py", "_gen_serp_meta.py", "_gen_faqpage_jsonld.py",
    "_gen_en_pages.py", "_gen_search_index.py", "_gen_api_content_snapshot.py",
    "_gen_llms_txt.py", "_gen_llms_full_txt.py", "_gen_opensearch.py",
    "_gen_profile_schema.py", "_gen_site_graph.py", "_gen_route_canonicals.py",
    "_apply_i_series.py", "_apply_a11y_vt.py", "_apply_trusted_types.py",
    "_apply_f10_image_priority.py", "_extract_critical_css.py", "_gen_csp_hashes.py",
]

ENV = dict(os.environ, PYTHONIOENCODING="utf-8")


def sh(args, **kw):
    # encoding+errors are REQUIRED: children emit UTF-8, but Windows' default
    # decode is cp950/gbk and crashes on it. Never remove these.
    return subprocess.run(args, cwd=str(ROOT), env=ENV, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", **kw)


def parse_chain():
    """Extract the ordered `python X.py` steps from the quality.yml Drift step."""
    if not QUALITY_YML.exists():
        return None
    text = QUALITY_YML.read_text(encoding="utf-8", errors="replace")
    # Find the "Drift check" step, collect until the next "- name:" step.
    lines = text.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if "- name:" in ln and "Drift check" in ln:
            start = i
            break
    if start is None:
        return None
    chain, seen = [], set()
    for ln in lines[start + 1:]:
        if re.match(r"\s*-\s*name:", ln):  # next step -> stop
            break
        m = re.search(r"\bpython3?\s+(\w[\w./-]*\.py)\b", ln)
        if m:
            name = os.path.basename(m.group(1))
            if name not in seen:
                seen.add(name)
                chain.append(name)
    return chain or None


def get_chain():
    parsed = parse_chain()
    if parsed and len(parsed) >= 10:
        # halfwidth_to_fullwidth.py is a SEPARATE earlier CI step (must run
        # first; CI checks it via --dry-run == "0 files"). It isn't inside the
        # Drift step we parse, so prepend it to match the real author chain.
        if "halfwidth_to_fullwidth.py" not in parsed and (ROOT / "halfwidth_to_fullwidth.py").exists():
            parsed = ["halfwidth_to_fullwidth.py"] + parsed
        return parsed, "quality.yml"
    print("  !! WARNING: could not parse chain from quality.yml — using embedded")
    print("     FALLBACK_CHAIN (may be stale). Verify against the workflow.")
    return FALLBACK_CHAIN, "FALLBACK"


def run_chain(chain, label):
    print(f"  running {len(chain)} generators ({label}) ...")
    for step in chain:
        if not (ROOT / step).exists():
            print(f"    - SKIP {step} (not on disk)")
            continue
        r = sh([sys.executable, step])
        if r.returncode != 0:
            print(f"    X FAIL {step} (rc={r.returncode})")
            print((r.stderr or r.stdout)[-1500:])
            return False
    return True


def git(args):
    """Run a git command. Returns (ok, stdout). ok=False (and prints stderr) on
    any nonzero exit — a pre-push GATE must never treat a failed git command as
    'clean' (that would false-green the fixed-point check)."""
    r = sh(["git"] + args)
    if r.returncode != 0:
        print(f"    X git {' '.join(args)} FAILED (rc={r.returncode}): "
              f"{(r.stderr or r.stdout or '').strip()[:300]}")
        return False, ""
    return True, r.stdout


def git_dirty_paths():
    """List unstaged-changed paths, or None if git itself failed (cannot verify)."""
    ok, out = git(["diff", "--name-only"])
    if not ok:
        return None
    return [p for p in out.splitlines() if p.strip()]


def main():
    args = set(sys.argv[1:])
    chain, src = get_chain()

    if "--chain" in args:
        print(f"Generator chain (source: {src}), {len(chain)} steps:")
        for i, s in enumerate(chain, 1):
            print(f"  {i:2}. {s}")
        return 0

    # Fail closed: quality.yml is the authoritative chain. If parsing broke we
    # only have the embedded (possibly stale) FALLBACK_CHAIN — a gate must not
    # silently run on it. Require an explicit override.
    if src == "FALLBACK" and "--allow-fallback" not in args:
        print("PREFLIGHT ABORT: could not parse the generator chain from quality.yml")
        print("(the authoritative source). Refusing to run on a possibly-stale")
        print("FALLBACK_CHAIN. Fix parse_chain(), or pass --allow-fallback to override.")
        return 1

    print("=" * 60)
    print("HsiaoEye preflight - pre-push gate (docs/DECISIONS.md D-20)")
    print("=" * 60)

    print("\n[1/3] Generator chain, run #1")
    if not run_chain(chain, src):
        print("\nRESULT: FAIL — a generator errored. Fix it before pushing.")
        return 1

    fixed_point = True
    if "--fast" in args:
        print("\n[2/3] Fixed-point drift check SKIPPED (--fast)")
    else:
        print("\n[2/3] Fixed-point drift check (run chain again, expect no new diff)")
        ok_add, _ = git(["add", "-A"])
        if not ok_add:
            print("  X cannot `git add` -> gate cannot verify fixed point. FAILING CLOSED.")
            return 1
        if not run_chain(chain, src):
            print("\nRESULT: FAIL - generator errored on 2nd run.")
            return 1
        drift = git_dirty_paths()
        if drift is None:
            print("  X `git diff` failed -> cannot verify fixed point. FAILING CLOSED.")
            return 1
        if drift:
            fixed_point = False
            print("  X NOT a fixed point — these files changed on the 2nd run:")
            for p in drift[:40]:
                print(f"      {p}")
            print("  -> You likely missed a step, or something is non-idempotent.")
            print("     Re-run preflight; if it persists, inspect those files.")
        else:
            print("  OK fixed point confirmed (CI drift check will pass).")

    print("\n[3/3] Validators")
    ok = True
    for name, cmd in [("validate.py", [sys.executable, "validate.py"]),
                      ("_check_all.py --quick", [sys.executable, "_check_all.py", "--quick"])]:
        r = sh(cmd)
        tail = (r.stdout or "").strip().splitlines()[-3:]
        status = "OK" if r.returncode == 0 else "FAIL"
        if r.returncode != 0:
            ok = False
        print(f"  [{status}] {name}")
        for t in tail:
            print(f"      {t}")
        if r.returncode != 0:
            print((r.stdout or r.stderr)[-1200:])

    # Warn on untracked non-ignored files (the git add -A / artifact trap).
    ok_unt, unt_out = git(["ls-files", "--others", "--exclude-standard"])
    unt = unt_out.splitlines() if ok_unt else []
    if unt:
        print("\n  NOTE untracked files present (check before committing):")
        for p in unt[:20]:
            print(f"      {p}")

    print("\n" + "=" * 60)
    passed = ok and fixed_point
    if passed:
        print("PREFLIGHT PASS. Next: codex GPT-5.6-sol review (D-20 step 2), then push,")
        print("then `python _ci_status.py <sha> --watch`.")
    else:
        print("PREFLIGHT FAIL. Do NOT push. Fix the issues above.")
    print("=" * 60)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
