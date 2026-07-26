#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
_ci_status.py — check GitHub Actions status WITHOUT the `gh` CLI.

WHY THIS EXISTS
    This environment has no `gh` CLI and no GitHub token. But the repo is
    public, so the GitHub Actions REST API is readable unauthenticated
    (~60 req/hr). This wraps it so any model can watch CI after a push.

USAGE
    python _ci_status.py                 # status of the LATEST commit's runs
    python _ci_status.py <sha>           # status of a specific commit (7+ chars)
    python _ci_status.py <sha> --watch   # poll until the `quality` run completes
    python _ci_status.py <sha> --jobs    # per-job breakdown of the quality run
    python _ci_status.py <sha> --steps   # per-STEP breakdown (finds the failing step)

READING THE RESULT (see docs/DECISIONS.md D-21, docs/REVIEW-PLAYBOOK.md)
    - quality = success            -> the real gate passed.
    - quality = failure + a `ci: regen ... [skip ci]` commit appeared within
      ~2 min -> drift self-heal, NOT yours to fix.
    - quality = failure, no regen commit -> real. Use --steps to find which
      step failed, then fix.
    - Visual regression = failure is often just stale baselines (D-13) — check
      whether a screenshotted page's content changed intentionally.

ASCII-ONLY output (Windows cp950 console safe). Retries on API hiccups.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = "expertise88864/user-hsiao"  # update if the remote changes
API = f"https://api.github.com/repos/{REPO}/actions"


class ApiUnavailable(Exception):
    """No answer from the GitHub API — CI status is UNKNOWN, not 'fine'."""


class RateLimited(ApiUnavailable):
    """GitHub API quota exhausted (unauthenticated: 60 requests/hour/IP)."""

    def __init__(self, reset_epoch=None, secondary=False):
        self.reset_epoch = reset_epoch
        kind = 'secondary rate limit hit' if secondary else 'rate limit exhausted'
        when = ''
        if reset_epoch:
            when = time.strftime(' (resets %H:%M:%S)', time.localtime(reset_epoch))
        super().__init__(f'GitHub API {kind}{when}')


def api(url):
    """Return parsed JSON, or RAISE — never a falsely-empty result.

    Round-2 review: this used to swallow EVERY exception and return None, so a
    403 rate-limit was indistinguishable from "no runs exist" — `--watch` then
    printed "(no runs yet)" for the rest of its loop, which reads as "CI never
    started" and invites a future session to conclude it broke the workflow.

    Follow-up (codex): returning None after exhausted retries recreated exactly
    that lie by a different route — callers turned None into "no workflow runs
    found" and exited 0, so a network outage looked like a clean bill of
    health. Now the ONLY way to get an empty answer is a successfully parsed
    GitHub response that really is empty; every failure raises.
    """
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "ci-status", "Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            reset = e.headers.get('X-RateLimit-Reset') if e.headers else None
            reset = int(reset) if reset and reset.isdigit() else None
            if e.code == 429:
                raise RateLimited(reset) from None
            if e.code == 403:
                remaining = e.headers.get('X-RateLimit-Remaining') if e.headers else None
                retry_after = e.headers.get('Retry-After') if e.headers else None
                body = ''
                try:
                    body = e.read(500).decode('utf-8', 'replace').lower()
                except Exception:
                    pass
                # Primary limit: remaining == 0. SECONDARY limit: 403 with a
                # Retry-After and/or an explanatory body, while remaining may
                # still be nonzero — retrying that only extends the block.
                if remaining == '0':
                    raise RateLimited(reset) from None
                if retry_after or 'secondary rate limit' in body or 'abuse' in body:
                    raise RateLimited(reset, secondary=True) from None
            last = f'HTTP {e.code}'
            if attempt == 4:
                break
            time.sleep(6)
        except Exception as e:                       # network, timeout, bad JSON
            last = f'{type(e).__name__}: {e}'
            if attempt == 4:
                break
            time.sleep(6)
    raise ApiUnavailable(f'GitHub API unreachable after 5 attempts ({last})')


def _expect_list(payload, key, what):
    """Validate the response SHAPE before trusting it.

    `(payload or {}).get(key, [])` turned a successfully-parsed but invalid
    body (`null`, `{}`, an error object) into an empty list, which callers
    reported as "no workflow runs found" with exit 0 — the same falsely
    reassuring answer this module exists to prevent, one level deeper.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get(key), list):
        raise ApiUnavailable(
            f'unexpected GitHub response shape for {what}: missing/invalid "{key}"')
    items = payload[key]
    # Validate the ITEMS too: `{"workflow_runs": [null]}` would otherwise blow
    # up later as an uncaught AttributeError, bypassing the explicit-UNKNOWN
    # handler and exiting with a generic code.
    if any(not isinstance(it, dict) for it in items):
        raise ApiUnavailable(
            f'unexpected GitHub response shape for {what}: "{key}" contains non-object entries')
    return items


def latest_sha():
    d = api(f"{API}/runs?per_page=1")
    runs = _expect_list(d, "workflow_runs", "latest run")
    return runs[0]["head_sha"][:12] if runs else None


def _full_sha(sha):
    """Expand a short sha to 40 chars via the local repo, else None."""
    if len(sha) == 40:
        return sha
    try:
        out = subprocess.run(["git", "rev-parse", sha], capture_output=True,
                             text=True, cwd=os.path.dirname(os.path.abspath(__file__)))
        val = (out.stdout or "").strip()
        return val if out.returncode == 0 and len(val) == 40 else None
    except (OSError, subprocess.SubprocessError):
        return None


def runs_for(sha):
    """Runs for a commit — filtered SERVER-side whenever possible.

    Fetching only the newest page and filtering locally meant a commit whose
    runs had scrolled past that page looked exactly like "no runs exist"
    (exit 0), which is the falsely reassuring answer this tool must never give.
    GitHub can filter by head_sha, but needs the full 40-char sha, so expand it
    from the local repo first.
    """
    full = _full_sha(sha)
    if full:
        d = api(f"{API}/runs?per_page=100&head_sha={full}")
        return _expect_list(d, "workflow_runs", f"runs of {sha}")
    # Fallback (sha not resolvable locally): widen the page and filter here,
    # and say so rather than implying certainty.
    d = api(f"{API}/runs?per_page=100")
    runs = [r for r in _expect_list(d, "workflow_runs", f"runs of {sha}")
            if r.get("head_sha", "").startswith(sha)]
    if not runs:
        print(f"  (note: {sha} could not be expanded locally; searched only the "
              f"100 most recent runs — an older commit's runs may be missed)")
    return runs


def quality_run(sha):
    return next((r for r in runs_for(sha) if r["name"] == "quality"), None)


def print_runs(sha):
    rs = runs_for(sha)
    if not rs:
        print(f"  (no workflow runs found yet for {sha})")
        return
    for r in rs:
        print(f"  {r['name']:<26} {r['status']:<12} {r.get('conclusion')}")


def print_jobs(sha, steps=False):
    q = quality_run(sha)
    if not q:
        print("  (no quality run found)")
        return
    d = api(f"{API}/runs/{q['id']}/jobs")
    for j in _expect_list(d, "jobs", "jobs of the quality run"):
        print(f"  [{j.get('conclusion')}] {j['name']}")
        if steps and j.get("conclusion") == "failure":
            for s in j.get("steps", []):
                mark = "X" if s.get("conclusion") == "failure" else "."
                print(f"      {mark} [{s.get('conclusion')}] {s.get('name')}")
    print(f"  run: {q.get('html_url')}")


def main():
    argv = sys.argv[1:]
    flags = {a for a in argv if a.startswith("--")}
    pos = [a for a in argv if not a.startswith("--")]
    sha = pos[0][:12] if pos else latest_sha()
    if not sha:
        # api() raises on failure now, so reaching here means GitHub answered
        # successfully with an empty run list — not an unreachable API.
        print("GitHub returned no workflow runs at all for this repo.")
        return 1
    print(f"Commit {sha} @ {REPO}")

    if "--jobs" in flags or "--steps" in flags:
        print_jobs(sha, steps="--steps" in flags)
        return 0

    if "--watch" in flags:
        # NOTE: unauthenticated GitHub API allows only 60 requests/hour/IP.
        # At one poll per 30s this loop costs ~40 requests, so a couple of
        # back-to-back watches can still exhaust the quota — which is why a
        # rate-limit must be reported LOUDLY rather than looking like "no runs".
        for i in range(40):  # ~20 min max
            try:
                rs = runs_for(sha)
            except ApiUnavailable as e:
                print(f"\n!! {e}")
                print("   CI status is UNKNOWN — this is NOT evidence that CI failed or "
                      "never started.")
                print(f"   Check manually: https://github.com/{REPO}/actions?query=branch%3Amain")
                print("   Or re-run this command after the reset time.")
                return 4
            line = " | ".join(f"{r['name']}={r['status']}/{r.get('conclusion')}" for r in rs) or "(no runs yet)"
            print(f"[{i+1:02}] {line}")
            q = next((r for r in rs if r["name"] == "quality"), None)
            if q and q["status"] == "completed":
                print("\nquality jobs:")
                print_jobs(sha, steps=(q.get("conclusion") == "failure"))
                return 0 if q.get("conclusion") == "success" else 2
            time.sleep(30)
        print("timed out waiting for quality run")
        return 3

    print_runs(sha)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ApiUnavailable as exc:
        # Every code path must degrade to an explicit "unknown", never to a
        # traceback and never to a reassuring-looking empty result.
        print(f"\n!! {exc}")
        print("   CI status is UNKNOWN — this is NOT evidence that CI failed or never started.")
        print(f"   Check manually: https://github.com/{REPO}/actions?query=branch%3Amain")
        sys.exit(4)
