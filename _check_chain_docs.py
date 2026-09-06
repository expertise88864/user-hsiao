#!/usr/bin/env python
"""Verify actual command blocks, order, and the CMS regeneration entry point."""
from __future__ import annotations
import re
from pathlib import Path
import preflight

ROOT = Path(__file__).resolve().parent
DOCS = ('CLAUDE.md', 'AGENTS.md', 'WRITING_NEW_ARTICLE.md')


def check(root: Path = ROOT) -> list[str]:
    old = preflight.QUALITY_YML
    try:
        preflight.QUALITY_YML = root / '.github/workflows/quality.yml'
        chain = preflight.parse_chain()
    finally:
        preflight.QUALITY_YML = old
    if not chain or len(chain) < 10:
        return ['Cannot parse authoritative build chain']
    chain = ['halfwidth_to_fullwidth.py'] + [s for s in chain if s != 'halfwidth_to_fullwidth.py']
    errors = []
    if chain.index('_normalize_skiplinks.py') < chain.index('_apply_i_series.py'):
        errors.append('Skip-link pruning must run after injection')
    if chain.index('_normalize_entity_links.py') > chain.index('_gen_en_pages.py'):
        errors.append('Source normalization must run before English mirrors')
    if chain[-1] != '_gen_csp_hashes.py':
        errors.append('CSP hashing must be last')
    for name in DOCS:
        text = (root / name).read_text(encoding='utf-8')
        blocks = re.findall(r'```bash\n([\s\S]*?)```', text)
        chains = [b for b in blocks if 'python _gen_en_pages.py' in b or '# build-chain:start' in b]
        if not chains:
            errors.append(f'{name}: no build chain command block')
        for block in chains:
            match = re.search(r'# build-chain:start\n([\s\S]*?)# build-chain:end', block)
            steps = re.findall(r'^python (\w+\.py)\s*$', match[1], re.M) if match else []
            if steps != chain:
                errors.append(f'{name}: build command block differs from CI order/steps')
    regen = (root / '.github/workflows/regen-en.yml').read_text(encoding='utf-8')
    if not re.search(r'^          python preflight\.py --run-chain\s*$', regen, re.M):
        errors.append('CMS regeneration must execute preflight.py --run-chain')
    if re.search(r'^          python _\w+\.py', regen, re.M):
        errors.append('CMS regeneration must not carry its own partial generator list')
    # --run-chain is generation only, never a publishing gate. This job must
    # report drift for correction through the complete reviewed CI workflow.
    if re.search(r'git\s+(?:push|commit)\b|contents:\s*write|persist-credentials:\s*true', regen):
        errors.append('CMS generation check must not publish unvalidated changes')
    if 'git diff --cached --quiet' not in regen or 'exit 1' not in regen or 'generated-artifacts.patch' not in regen:
        errors.append('CMS generation check must fail on drift and preserve a correction patch')
    guide = (root / 'docs/MODEL-GUIDE.md').read_text(encoding='utf-8')
    push_blocks = [b for b in re.findall(r'```bash\n([\s\S]*?)```', guide) if 'git push' in b]
    required = ('python preflight.py', 'npm run test:api',
                'python -m unittest discover -s tests/python', 'npm run test:seo',
                'python _check_size_budget.py')
    if not push_blocks or any(not all(re.search(r'^' + re.escape(cmd) + r'(?:\s*#.*)?$', b.split('git push')[0], re.M)
                                     for cmd in required) for b in push_blocks):
        errors.append('MODEL-GUIDE push recipe must require the complete local CI sequence')
    return errors


def main() -> int:
    try:
        errors = check()
    except (OSError, ValueError) as exc:
        errors = [str(exc)]
    for error in errors:
        print('[FAIL]', error)
    if not errors:
        print('[OK] Documented build commands and CMS regeneration match the authoritative chain')
    return int(bool(errors))


if __name__ == '__main__':
    raise SystemExit(main())
