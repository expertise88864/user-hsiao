#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — guard that blog/blog-shared.min.js is present and not stale
relative to its readable source blog/blog-shared.js.

Why: pages ship the esbuild-minified blog-shared.min.js (≈177 KB vs the
300 KB source). The readable blog-shared.js stays committed because every
generator/checker parses DN.ARTICLES out of it with regexes that rely on
the un-minified formatting. If someone edits blog-shared.js (e.g. adds an
article to DN.ARTICLES) but forgets to run `npm run minify`, the served
bundle goes stale.

Checks 1-5 are pure-Python proxies (they run in CI *before* `npm ci`, so
esbuild is not yet installed there): the min bundle exists, is meaningfully
smaller, carries the SAME DN.ARTICLES slugs + DN.STUB_SLUGS as the source,
and still contains the key DN.* entry points. Those catch a CATALOG change
("added an article, forgot to regen").

Check 6 (round-2 review 2026-07) closes the gap they left: a pure LOGIC edit
keeps every slug identical, so checks 1-5 pass while the site serves a stale
bundle — the fix appears applied in source but was never shipped. When
esbuild is available (local `preflight.py`, i.e. the gate the person editing
the file actually runs) it re-minifies and compares BYTES. CI covers the same
invariant with a post-`npm ci` "min.js freshness" step in quality.yml.

After editing blog-shared.js, run:  npm run minify
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'blog', 'blog-shared.js')
MIN = os.path.join(ROOT, 'blog', 'blog-shared.min.js')

# Quote-agnostic: esbuild may rewrite '...' to "..." in the minified file.
SLUG_RE = re.compile(r'slug:["\']([a-z0-9-]+)["\']')
STUB_RE = re.compile(r'(?<!EN_)STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([^\]]*)\]', re.DOTALL)
EN_STUB_RE = re.compile(r'EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([^\]]*)\]', re.DOTALL)
# Property names survive esbuild minification (only the local `DN` alias is
# renamed, e.g. DN.ARTICLES → n.ARTICLES), so check bare property identifiers.
KEY_SYMBOLS = ('.ARTICLES', 'initBlog', 'applyTextOnly', 'injectBreadcrumb', 'window.DN')


def slugs(text: str) -> set[str]:
    return set(SLUG_RE.findall(text))


def stub_slugs(text: str, pattern: re.Pattern[str] = STUB_RE) -> set[str]:
    m = pattern.search(text)
    return set(re.findall(r'["\']([a-z0-9-]+)["\']', m.group(1))) if m else set()


def main() -> int:
    errors = []

    if not os.path.exists(SRC):
        print('[FAIL] blog/blog-shared.js (source) missing')
        return 1
    if not os.path.exists(MIN):
        print('[FAIL] blog/blog-shared.min.js missing — run: npm run minify')
        return 1

    src = open(SRC, encoding='utf-8').read()
    mn = open(MIN, encoding='utf-8').read()
    src_sz, min_sz = len(src.encode('utf-8')), len(mn.encode('utf-8'))

    # 1) Minified must be meaningfully smaller (sanity: real minification ran).
    if min_sz >= src_sz * 0.9:
        errors.append(
            f'min.js ({min_sz} B) is not meaningfully smaller than source '
            f'({src_sz} B) — minification may not have run')

    # 2) DN.ARTICLES slug set must match (catches "added article, forgot regen").
    s_slugs, m_slugs = slugs(src), slugs(mn)
    if s_slugs != m_slugs:
        missing = s_slugs - m_slugs
        extra = m_slugs - s_slugs
        errors.append(
            f'DN.ARTICLES slugs differ source↔min — STALE min bundle. '
            f'Run: npm run minify  (missing in min: {sorted(missing)}; '
            f'extra in min: {sorted(extra)})')

    # 3) STUB_SLUGS set must match too.
    if stub_slugs(src) != stub_slugs(mn):
        errors.append('DN.STUB_SLUGS differ source↔min — run: npm run minify')

    # 4) EN_STUB_SLUGS set must match too.
    if stub_slugs(src, EN_STUB_RE) != stub_slugs(mn, EN_STUB_RE):
        errors.append('DN.EN_STUB_SLUGS differ source/min - run: npm run minify')

    # 5) Key entry points survived minification.
    for sym in KEY_SYMBOLS:
        if sym not in mn:
            errors.append(f'min.js missing key symbol {sym!r} — bad minify output')

    # 6) Byte-exact staleness check (round-2 review 2026-07).
    #    Checks 1-5 only compare the CATALOG (slugs/stubs/symbols), so they
    #    catch "added an article, forgot to regen" but NOT a pure LOGIC edit —
    #    a mutation test that inserted a statement into blog-shared.js was
    #    missed by every checker. That is the dangerous case: the fix looks
    #    applied in source while the site keeps serving the old bundle.
    #    esbuild is deterministic, so re-minify and compare bytes.
    #    Availability differs by environment, so this is best-effort and LOUD
    #    when skipped (never a silent pass); CI covers it separately with a
    #    post-`npm ci` drift step in quality.yml.
    exact_note = ''
    # Unique output path: a shared deterministic name lets concurrent runs
    # overwrite or delete each other's build output. A temp DIRECTORY (not
    # mkstemp) is used deliberately — mkstemp pre-creates the file, which would
    # make the "esbuild reported success but produced no output" check below
    # unreachable.
    esbuild_dir = tempfile.mkdtemp(prefix='hs_expected_min_')
    esbuild_out = os.path.join(esbuild_dir, 'expected.min.js')
    # Availability is decided by POSITIVE IDENTIFICATION — the presence of the
    # locally-installed package — not by interpreting an exit code or sniffing
    # output. Any nonzero result can also mean "permission denied" or "corrupt
    # npx", and treating those as "not installed" silently disables the gate.
    #   installed  -> the build MUST succeed; any failure is a hard error.
    #   absent     -> try anyway (a global esbuild may exist); on failure, skip
    #                 loudly rather than blocking someone without node_modules.
    esbuild_installed = os.path.isdir(os.path.join(ROOT, 'node_modules', 'esbuild'))
    try:
        proc = subprocess.run(
            ['npx', '--no-install', 'esbuild', SRC, '--minify',
             '--legal-comments=none', '--target=es2020', f'--outfile={esbuild_out}'],
            capture_output=True, text=True, cwd=ROOT, timeout=120,
            shell=(os.name == 'nt'),
        )
        combined = ((proc.stdout or '') + (proc.stderr or ''))
        if proc.returncode != 0 or not os.path.exists(esbuild_out):
            detail = (f'(exit {proc.returncode}) ' + combined.strip()[:300]) if proc.returncode != 0 \
                else 'esbuild reported success but produced no output'
            if esbuild_installed:
                # Installed ⇒ it must work. Fail closed: silently downgrading
                # here is how a gate becomes decorative.
                errors.append(
                    'esbuild is installed but re-minifying blog-shared.js FAILED '
                    f'— cannot verify min.js freshness: {detail}')
            else:
                exact_note = ', BYTE-EXACT CHECK SKIPPED (esbuild not installed)'
        else:
            with open(esbuild_out, 'rb') as f:
                expected = f.read()
            with open(MIN, 'rb') as f:
                actual = f.read()
            if expected != actual:
                errors.append(
                    'blog-shared.min.js is STALE — it does not match a fresh '
                    'esbuild of blog-shared.js. Run:  npm run minify   '
                    f'(committed {len(actual)} bytes vs freshly built {len(expected)} bytes). '
                    'If esbuild was upgraded, re-run minify and commit the new bundle.'
                )
            else:
                exact_note = ', byte-exact vs fresh esbuild'
    except FileNotFoundError:
        if esbuild_installed:
            errors.append('esbuild is installed but npx is not on PATH — '
                          'cannot verify min.js freshness')
        else:
            exact_note = ', BYTE-EXACT CHECK SKIPPED (npx/esbuild not on PATH)'
    except subprocess.TimeoutExpired:
        errors.append('esbuild re-minify timed out — cannot verify min.js freshness')
    except OSError as exc:
        errors.append(f'esbuild re-minify could not run ({exc}) — cannot verify min.js freshness')
    finally:
        try:
            shutil.rmtree(esbuild_dir)
        except OSError as exc:
            # Surface it rather than leaking temp files silently.
            errors.append(f'temp cleanup failed for {esbuild_dir} ({exc})')

    if errors:
        print('[FAIL] blog-shared.min.js audit failed:')
        for e in errors:
            print(f'  - {e}')
        return 1

    print(f'[OK] blog-shared.min.js audit passed — '
          f'{min_sz // 1024} KB min vs {src_sz // 1024} KB source, '
          f'{len(m_slugs)} articles in sync{exact_note}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
