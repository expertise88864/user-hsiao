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
