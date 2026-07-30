#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Fail-closed audit of the entity links added by _normalize_entity_links.py.

The whole point is that no condition can sit UNDECIDED in silence. Every
about-MedicalCondition must appear in exactly one of the normalizer's two tables,
keyed by (slug, exact name) — so a new article, a renamed condition, or an added
second condition is a build failure until someone makes the identity call.

Two earlier versions of this file were NOT actually fail-closed:
  * keys were slug-level, so renaming a condition to a narrower or composite
    disease kept stamping the approved URI on it and this checker still passed;
  * `if not conditions: continue` let an article that omits `about`, mistypes
    `@type`, or nests the condition differently skip both tables entirely.
Both are now errors. It also imports the tables and the parser from the
normalizer rather than restating them, so the two files cannot drift (the
coupling discipline of D-24).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _normalize_entity_links import (  # noqa: E402
    ENTITY_BY_CONDITION,
    UNMAPPED,
    WIKIDATA,
    WIKIPEDIA,
    expected_same_as,
    has_medical_web_page,
    iter_conditions,
)

ROOT = Path(__file__).resolve().parent
BLOG = ROOT / 'blog'

QID_RE = re.compile(r'^Q[1-9]\d*$')

# Pages that legitimately carry no MedicalCondition because they are listings,
# not articles. Anything else without one is an error.
NO_CONDITION_OK = {'index', 'topics'}


def main() -> int:
    errors: list[str] = []

    # 1. Table hygiene — a malformed Q-id silently produces a dead URI.
    for (slug, name), (qid, title) in sorted(ENTITY_BY_CONDITION.items()):
        if not QID_RE.match(qid):
            errors.append(f'{slug} / {name}: {qid!r} is not a Wikidata Q-id')
        if not title or title != title.strip():
            errors.append(f'{slug} / {name}: Wikipedia title {title!r} is empty or padded')
        if '/' in title or '#' in title:
            errors.append(f'{slug} / {name}: Wikipedia title {title!r} must be a bare title')
    for (slug, name), reason in sorted(UNMAPPED.items()):
        if len(reason.strip()) < 20:
            errors.append(f'{slug} / {name}: UNMAPPED needs a real reason, got {reason!r}')

    # 2. No key in both tables.
    for key in sorted(set(ENTITY_BY_CONDITION) & set(UNMAPPED)):
        errors.append(f'{key[0]} / {key[1]}: listed as BOTH mapped and unmapped')

    # 3. Walk the articles. Build the set of (slug, name) actually present so
    #    stale table entries can be reported afterwards.
    present: set[tuple[str, str]] = set()
    for path in sorted(BLOG.glob('*.html')):
        slug = path.stem
        html = path.read_text(encoding='utf-8')
        conds = list(iter_conditions(html))

        if not conds:
            # Fail CLOSED: an article page with no condition is either a listing
            # (allow-listed) or a mistake — a missing/mistyped `about` must not
            # be a free pass out of both tables.
            if slug not in NO_CONDITION_OK:
                errors.append(
                    f'{slug}: no about MedicalCondition found. If this is an '
                    f'article, its `about` is missing or malformed; if it is a '
                    f'listing page, add it to NO_CONDITION_OK with that reason')
            elif has_medical_web_page(html):
                errors.append(
                    f'{slug}: in NO_CONDITION_OK but declares MedicalWebPage — '
                    f'it looks like an article and needs an about MedicalCondition')
            continue

        if slug in NO_CONDITION_OK:
            errors.append(f'{slug}: in NO_CONDITION_OK yet has {len(conds)} '
                          f'condition(s) — remove it from the allow-list')

        for cond in conds:
            name = cond.get('name')
            if not isinstance(name, str) or not name.strip():
                errors.append(f'{slug}: an about MedicalCondition has no usable name '
                              f'({name!r}) so its identity cannot be decided')
                continue
            key = (slug, name)
            present.add(key)
            mapped = key in ENTITY_BY_CONDITION
            unmapped = key in UNMAPPED
            if not mapped and not unmapped:
                errors.append(
                    f'{slug} / {name}: condition is in neither ENTITY_BY_CONDITION '
                    f'nor UNMAPPED in _normalize_entity_links.py — decide whether a '
                    f'Wikidata/Wikipedia entity denotes it EXACTLY, then add it to '
                    f'one of the two tables')
                continue
            got = cond.get('sameAs')
            if mapped:
                want = expected_same_as(slug, name)
                if got != want:
                    errors.append(f'{slug} / {name}: sameAs is {got!r}, expected '
                                  f'{want!r} (run python _normalize_entity_links.py)')
            elif got:
                errors.append(f'{slug} / {name}: UNMAPPED but carries sameAs={got!r}')

    # 4. Stale table entries. A renamed condition or renamed file leaves a key
    #    that matches nothing, and the mapping quietly stops applying.
    for table_name, table in (('ENTITY_BY_CONDITION', ENTITY_BY_CONDITION),
                              ('UNMAPPED', UNMAPPED)):
        for (slug, name) in sorted(table):
            if (slug, name) not in present:
                exists = (BLOG / f'{slug}.html').is_file()
                why = (f'blog/{slug}.html has no about MedicalCondition named {name!r}'
                       if exists else f'blog/{slug}.html does not exist')
                errors.append(f'{slug} / {name}: stale entry in {table_name} — {why}')

    # 5. Guard the URI prefixes so a future edit cannot repoint sameAs.
    if WIKIDATA != 'https://www.wikidata.org/wiki/':
        errors.append(f'unexpected WIKIDATA prefix {WIKIDATA!r}')
    if WIKIPEDIA != 'https://en.wikipedia.org/wiki/':
        errors.append(f'unexpected WIKIPEDIA prefix {WIKIPEDIA!r}')

    if errors:
        print('[FAIL] entity-link audit found issues:')
        for e in errors:
            print(' -', e)
        return 1

    print(f'[OK] entity links: {len(ENTITY_BY_CONDITION)} mapped + {len(UNMAPPED)} '
          f'explicitly unmapped = {len(present)} conditions, all accounted for')
    return 0


if __name__ == '__main__':
    sys.exit(main())
