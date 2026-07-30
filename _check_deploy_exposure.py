#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard both halves of the .vercelignore contract (S-08).

Half one: the build toolchain, the institution docs and the deployment scripts
must NOT be published. Before S-08 they were — /preflight.py,
/_gen_csp_hashes.py, /docs/DECISIONS.md and /REVIEW_WORKORDER_2026-07.md all
returned 200 in production.

Half two, and the reason this is a checker and not just an ignore file: an
OVER-BROAD exclusion silently breaks the site. Dropping vercel.json removes the
routing config; dropping admin/ or tools/ 404s real pages. Neither failure
appears in preflight or any HTML validator — only in a broken deploy.

WHY THE MUST-DEPLOY SIDE IS DERIVED FROM GIT, NOT HAND-LISTED
    The first version listed 16 paths by hand while the .vercelignore comment
    claimed "every api/**/*.js" was protected. It was not: adding the literal
    pattern `api/og.js` would have removed a live function and still passed —
    the guard asserted less than the prose claimed, which is the defect class
    this repo keeps finding. The manifest now comes from `git ls-files`, so a
    newly added API route or asset is protected the moment it is tracked.

    APPROVED_EXCLUSIONS is likewise pinned: .vercelignore's pattern set must
    equal it exactly. Adding or removing an exclusion therefore requires a
    deliberate edit here too (the D-24 coupling discipline), which is what makes
    an over-broad pattern impossible to slip in.

SCOPE OF _match(), stated plainly: it implements the gitignore subset this repo
uses — a leading `/`, `dir/`, `*.ext`, and literal names that may denote either
a file or a directory. It is NOT a gitignore engine (no `!` negation, no `**`,
no character classes). PATTERN_SYNTAX_OK fails the build on anything outside
that subset rather than letting the checker mis-evaluate it.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERCELIGNORE = ROOT / '.vercelignore'

# The complete, authoritative exclusion set. .vercelignore must match this
# exactly — no more, no less.
APPROVED_EXCLUSIONS = {
    '_cms/',                      # CMS working area (pre-existing)
    '__pycache__/',               # local artefacts (untracked)
    'node_modules/',
    'hs_expected_min_j86c9_ek/',
    '*.py',                       # generator + checker toolchain
    'docs/',                      # DECISIONS / BACKLOG list unfixed weaknesses
    '*.md',
    '.github/',                   # CI configuration
    '.githooks/',                 # the pre-push hook itself
    'scripts/',                   # hook installer
    'tests/',
    'playwright.config.js',
    'playwright.seo.config.js',
    'deploy.ps1',                 # deployment procedure
    'deploy.bat',
}

# Of those, the ones whose removal would re-open S-08.
REQUIRED_FOR_S08 = {
    '*.py', 'docs/', '*.md', '.github/', '.githooks/', 'scripts/', 'tests/',
    'deploy.ps1', 'deploy.bat',
}

PATTERN_SYNTAX_OK = re.compile(r'^/?(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*/?|\*\.[A-Za-z0-9]+)$')

# Must-deploy is DEFAULT-ON: a tracked file counts as runtime-required unless it
# falls into one of the small, named non-runtime categories below.
#
# The first version enumerated the runtime files instead, and that enumeration
# was incomplete: bfc071112dd2988a75988a1249d0ce44.txt — the IndexNow ownership
# key that IndexNow fetches to verify the domain, documented in
# api/admin/_indexnow.js — was missing, so excluding it by name would have passed
# every guard while silently breaking IndexNow. Any allow-list of "the files that
# matter" will keep being wrong that way; a deny-list of known-inert categories
# cannot miss a new asset.
NON_RUNTIME_DIRS = {'docs', 'tests', 'scripts', '.github', '.githooks', '_cms'}
NON_RUNTIME_SUFFIXES = ('.py', '.md')
NON_RUNTIME_ROOT_FILES = {
    'playwright.config.js', 'playwright.seo.config.js',
    'deploy.ps1', 'deploy.bat', '.gitignore', '.vercelignore',
}


def is_runtime_required(path: str) -> bool:
    # .py and .md are inert everywhere: Vercel builds functions from .js/.ts
    # only, and no page on this site links to a .md. Without the .md rule,
    # api/admin/README.md would count as required purely for sitting under api/,
    # and `*.md` could never be excluded at all.
    if path.endswith(NON_RUNTIME_SUFFIXES):
        return False
    if '/' in path:
        return path.split('/')[0] not in NON_RUNTIME_DIRS
    return path not in NON_RUNTIME_ROOT_FILES


def read_patterns() -> list[str]:
    if not VERCELIGNORE.is_file():
        return []
    return [line.strip() for line in VERCELIGNORE.read_text(encoding='utf-8').splitlines()
            if line.strip() and not line.strip().startswith('#')]


def tracked_files() -> list[str]:
    out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True,
                         text=True, encoding='utf-8')
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or 'git ls-files failed')
    return [line.strip().replace('\\', '/') for line in out.stdout.splitlines() if line.strip()]


def _match(pattern: str, path: str) -> bool:
    """True if `path` (repo-relative, forward slashes) is excluded by `pattern`.

    Follows the gitignore anchoring rules, which an earlier version got wrong in
    BOTH directions:
      * a pattern with no internal `/` is UNANCHORED and matches at any depth, so
        `docs/` also excludes `assets/docs/help.js`. Matching only at the root
        meant a real deployment could drop a runtime asset while this passed.
      * a leading `/` ANCHORS to the repo root. Stripping it made `/admin/`
        match `x/admin/y.css` too, which over-matches in the other direction.
      * a pattern containing an internal `/` is anchored as well.
    """
    anchored = pattern.startswith('/')
    pat = pattern.lstrip('/')
    dir_only = pat.endswith('/')
    pat = pat.rstrip('/')

    if pat.startswith('*.'):
        return path.split('/')[-1].endswith(pat[1:])

    if '/' in pat:                                   # internal slash -> anchored
        return path == pat or path.startswith(pat + '/')

    segments = path.split('/')
    if anchored:
        if segments[0] != pat:
            return False
        return (not dir_only) or len(segments) > 1

    # Unanchored single name: a file or directory of that name at ANY depth.
    # `dir_only` means it must be a directory, i.e. not the final segment.
    return pat in (segments[:-1] if dir_only else segments)


def main() -> int:
    errors: list[str] = []
    patterns = read_patterns()

    if not patterns:
        print('[FAIL] .vercelignore is missing or empty — the build toolchain, '
              'docs/ and the deploy scripts would be published (S-08)')
        return 1

    for pattern in patterns:
        if not PATTERN_SYNTAX_OK.match(pattern):
            errors.append(
                f'pattern {pattern!r} is outside the syntax this checker models '
                f'(optional leading /, dir/, *.ext, literal). Extend _match() '
                f'deliberately rather than letting the check mis-evaluate it')

    extra = sorted(set(patterns) - APPROVED_EXCLUSIONS)
    missing = sorted(APPROVED_EXCLUSIONS - set(patterns))
    for pattern in extra:
        errors.append(f'.vercelignore adds {pattern!r}, which is not in '
                      f'APPROVED_EXCLUSIONS — confirm it removes nothing the site '
                      f'needs, then add it here too')
    for pattern in missing:
        why = ' — S-08 regression, that content would be served publicly' \
            if pattern in REQUIRED_FOR_S08 else ''
        errors.append(f'.vercelignore no longer excludes {pattern!r}{why}')

    try:
        manifest = tracked_files()
    except Exception as exc:                       # fail closed, never skip
        print(f'[FAIL] cannot read the git manifest ({exc}); without it this '
              f'check cannot tell what the deploy would contain')
        return 1

    excluded = {p for p in manifest if any(_match(pat, p) for pat in patterns)}

    broken = sorted(p for p in excluded if is_runtime_required(p))
    for path in broken[:20]:
        hit = next(pat for pat in patterns if _match(pat, path))
        errors.append(f'{path} is excluded by {hit!r} but is required at runtime '
                      f'— this would break production')
    if len(broken) > 20:
        errors.append(f'... and {len(broken) - 20} more runtime files excluded')

    # The files that motivated S-08 must actually be gone.
    for path in ('preflight.py', '_gen_csp_hashes.py', 'docs/DECISIONS.md',
                 'REVIEW_WORKORDER_2026-07.md', 'deploy.ps1', 'deploy.bat',
                 '.githooks/pre-push'):
        if path in manifest and path not in excluded:
            errors.append(f'{path} is tracked but not excluded — it would be '
                          f'published (S-08)')

    if errors:
        print('[FAIL] deploy-exposure audit found issues:')
        for e in errors:
            print(' -', e)
        return 1

    kept = len(manifest) - len(excluded)
    print(f'[OK] deploy exposure: {len(patterns)} patterns; {len(excluded)} of '
          f'{len(manifest)} tracked files withheld, {kept} deployed, none of them '
          f'runtime-required')
    return 0


if __name__ == '__main__':
    sys.exit(main())
