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
import sys
import time
import urllib.error
import urllib.request

REPO = "expertise88864/user-hsiao"  # update if the remote changes
API = f"https://api.github.com/repos/{REPO}/actions"


class RateLimited(Exception):
    """Unauthenticated GitHub API quota is exhausted (60 requests/hour/IP)."""

    def __init__(self, reset_epoch=None):
        self.reset_epoch = reset_epoch
        when = ''
        if reset_epoch:
            when = time.strftime(' (resets %H:%M:%S)', time.localtime(reset_epoch))
        super().__init__(f'GitHub API rate limit exhausted{when}')


def api(url):
    """Return parsed JSON, or None on a non-rate-limit failure.

    Round-2 review: this used to swallow EVERY exception and return None, so a
    403 rate-limit was indistinguishable from "no runs exist" — `--watch` then
    printed "(no runs yet)" for the rest of its loop. That is a dangerously
    reassuring lie: it reads as "CI never started", which invites a future
    session to conclude it broke the workflow. Rate limiting is now raised, and
    NOT retried (retrying only digs the hole deeper).
    """
    for attempt in range(5):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "ci-status", "Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                remaining = e.headers.get('X-RateLimit-Remaining')
                reset = e.headers.get('X-RateLimit-Reset')
                if remaining == '0' or e.code == 429:
                    raise RateLimited(int(reset) if reset and reset.isdigit() else None) from None
            if attempt == 4:
                return None
            time.sleep(6)
        except Exception:
            if attempt == 4:
                return None
            time.sleep(6)
    return None


def latest_sha():
    d = api(f"{API}/runs?per_page=1")
    runs = (d or {}).get("workflow_runs", [])
    return runs[0]["head_sha"][:12] if runs else None


def runs_for(sha):
    d = api(f"{API}/runs?per_page=40")
    return [r for r in (d or {}).get("workflow_runs", [])
            if r.get("head_sha", "").startswith(sha)]


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
    for j in (d or {}).get("jobs", []):
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
        print("Could not determine a commit sha (API unreachable?).")
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
            except RateLimited as e:
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
    except RateLimited as exc:
        # Every code path must degrade to an explicit "unknown", never to a
        # traceback and never to a reassuring-looking empty result.
        print(f"\n!! {exc}")
        print("   CI status is UNKNOWN — this is NOT evidence that CI failed or never started.")
        print(f"   Check manually: https://github.com/{REPO}/actions?query=branch%3Amain")
        sys.exit(4)
