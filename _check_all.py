"""
HsiaoEye — run every `_check_*.py` in this directory and print a summary.

Why exist: previously the operator ran "main" checks (validate.py,
secrets, dead-anchor) and reported "all green" without noticing that
internal-link or index-boundary checks were red. Batch X (2026-05-18)
shipped two regressions because of this exact mistake. This script
forces the full battery to run; CI uses it via the workflow, and the
pre-push hook (see scripts/install-pre-push-hook.sh) calls it locally.

Usage:
  python _check_all.py            # run all, exit 1 if any fail
  python _check_all.py --quick    # skip _check_runtime_smoke (needs server)

Each check is run as a subprocess so a check that crashes can't take
out the rest. Each is given 60s — more than enough for the static
checks; runtime_smoke (skipped by default) is the only one that
talks to a live server.

Exit codes:
  0   every non-skipped check returned 0
  1   at least one check failed
"""
from __future__ import annotations

import glob
import os
import subprocess
import sys
import time

# Windows cp950 chokes on ✓/✗ — force UTF-8 stdout if available.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
TIMEOUT_SEC = 60

# Checks that need a live HTTP server (skipped by default in pre-push;
# CI runs them via a separate workflow step).
SKIP_UNLESS_LIVE = {'_check_runtime_smoke.py'}

# Checks whose non-zero exit is treated as a warning, not a failure
# (matches the `|| echo "::warning::..."` patterns in workflow yaml).
WARN_ONLY = {
    '_check_link_orphans.py',     # orphans are soft signal
    '_check_dead_anchors.py',     # known-soft
    '_check_image_sizes.py',      # heuristic
    '_check_inline_events.py',    # admin-only inline events accepted
    '_check_og_images.py',        # 7 static page OG cards intentionally deferred
    '_check_svg_a11y.py',         # per-figure fix needs author domain knowledge
}


def main() -> int:
    quick = '--quick' in sys.argv
    scripts = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, '_check_*.py')))
    # Don't recurse into ourselves.
    scripts = [s for s in scripts if s != '_check_all.py']
    if quick or os.environ.get('CI') != '1':
        scripts = [s for s in scripts if s not in SKIP_UNLESS_LIVE]

    width = max(len(s) for s in scripts)
    results = []
    print(f'Running {len(scripts)} check(s)...\n')
    t0 = time.time()
    for s in scripts:
        start = time.time()
        try:
            cp = subprocess.run(
                [sys.executable, s],
                cwd=ROOT,
                capture_output=True, text=True,
                encoding='utf-8', errors='replace',
                timeout=TIMEOUT_SEC,
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
            )
            ok = (cp.returncode == 0)
            tail = ((cp.stdout or '') + (cp.stderr or '')).strip().split('\n')[-1][:80]
        except subprocess.TimeoutExpired:
            ok = False
            tail = f'TIMEOUT after {TIMEOUT_SEC}s'
        elapsed = time.time() - start
        is_warn = (not ok) and (s in WARN_ONLY)
        status = 'OK  ' if ok else ('WARN' if is_warn else 'FAIL')
        results.append((s, status, elapsed, tail))
        if sys.stdout.isatty():
            marker = '\033[32m✓\033[0m' if ok else ('\033[33m⚠\033[0m' if is_warn else '\033[31m✗\033[0m')
        else:
            # No ANSI in pre-push hook output / CI logs / Vercel function logs.
            marker = '✓' if ok else ('⚠' if is_warn else '✗')
        print(f'  {marker} {s:<{width}}  {elapsed:5.2f}s  {status:4}  {tail}')

    total = time.time() - t0
    n_pass = sum(1 for _, st, _, _ in results if st == 'OK  ')
    n_warn = sum(1 for _, st, _, _ in results if st == 'WARN')
    n_fail = sum(1 for _, st, _, _ in results if st == 'FAIL')

    print()
    print('=' * 70)
    print(f'  {n_pass} pass  |  {n_warn} warn  |  {n_fail} fail  |  {total:.1f}s total')
    print('=' * 70)

    if n_fail:
        print()
        print('Failed checks (re-run individually to see full output):')
        for s, st, _, _ in results:
            if st == 'FAIL':
                print(f'  python {s}')

    return 1 if n_fail else 0


if __name__ == '__main__':
    sys.exit(main())
