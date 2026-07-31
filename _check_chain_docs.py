#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard M-05: the docs must not fall behind the authoritative build chain.

`.github/workflows/quality.yml`'s drift step IS the chain. CLAUDE.md, AGENTS.md
and WRITING_NEW_ARTICLE.md each restate it for human readers, and three copies
of a list that grows is a list that decays: when this check was written, all
three were missing between four and six steps that CI had been running for
some time, including two added earlier the same day.

WHAT IS CHECKED, AND WHAT DELIBERATELY IS NOT
    Only ONE direction: every step CI runs must appear somewhere in each doc.
    That is the failure that matters — a generator added to CI and never
    documented, so the next person's manual run silently skips it.

    The reverse is NOT checked. A first attempt flagged "extras" and produced
    mostly FALSE POSITIVES, because these docs legitimately mention `_check_*.py`
    scripts in their checker sections, and `_gen_og_images.py` in the article
    workflow — none of which belong to the drift-step chain. Policing extras
    would need the docs to delimit their chain blocks, and the chain appears in
    several places per doc, so the delimiters would themselves rot.

    `preflight.py` remains the real protection: it PARSES quality.yml and runs
    what it finds, so an out-of-date doc cannot cause a wrong build. This check
    only keeps the prose honest.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKFLOW = ROOT / '.github' / 'workflows' / 'quality.yml'
DOCS = ('CLAUDE.md', 'AGENTS.md', 'WRITING_NEW_ARTICLE.md')

CI_STEP_RE = re.compile(r'(?m)^          python (_[A-Za-z0-9_]+\.py)')
DOC_STEP_RE = re.compile(r'python (_[A-Za-z0-9_]+\.py)')


def main() -> int:
    if not WORKFLOW.is_file():
        print(f'[FAIL] {WORKFLOW.name} not found — cannot establish the authoritative chain')
        return 1

    chain = list(dict.fromkeys(CI_STEP_RE.findall(WORKFLOW.read_text(encoding='utf-8'))))
    if not chain:
        # An empty sweep must not read as success: if the workflow's indentation
        # or step shape changes, this check would otherwise pass vacuously.
        print('[FAIL] parsed 0 chain steps from quality.yml — the step format '
              'likely changed, so this check can no longer see the chain')
        return 1

    errors: list[str] = []
    for name in DOCS:
        path = ROOT / name
        if not path.is_file():
            errors.append(f'{name}: missing, but it is one of the documents that '
                          f'restates the build chain')
            continue
        documented = set(DOC_STEP_RE.findall(path.read_text(encoding='utf-8')))
        missing = [s for s in chain if s not in documented]
        if missing:
            errors.append(f'{name}: does not mention {len(missing)} step(s) CI runs — '
                          f'{", ".join(missing)}')

    if errors:
        print('[FAIL] build-chain documentation is behind quality.yml:')
        for e in errors:
            print(' -', e)
        print('   Add the missing steps, or delete the copy and point at '
              'quality.yml / preflight.py instead.')
        return 1

    print(f'[OK] build-chain docs: all {len(chain)} CI steps are mentioned in '
          f'each of {len(DOCS)} documents')
    return 0


if __name__ == '__main__':
    sys.exit(main())
