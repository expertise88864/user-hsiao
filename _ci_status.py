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
import urllib.request

REPO = "expertise88864/user-hsiao"  # update if the remote changes
API = f"https://api.github.com/repos/{REPO}/actions"


def api(url):
    for _ in range(5):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "ci-status", "Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
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
        for i in range(60):  # ~20 min max
            rs = runs_for(sha)
            line = " | ".join(f"{r['name']}={r['status']}/{r.get('conclusion')}" for r in rs) or "(no runs yet)"
            print(f"[{i+1:02}] {line}")
            q = next((r for r in rs if r["name"] == "quality"), None)
            if q and q["status"] == "completed":
                print("\nquality jobs:")
                print_jobs(sha, steps=(q.get("conclusion") == "failure"))
                return 0 if q.get("conclusion") == "success" else 2
            time.sleep(20)
        print("timed out waiting for quality run")
        return 3

    print_runs(sha)
    return 0


if __name__ == "__main__":
    sys.exit(main())
