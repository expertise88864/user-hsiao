#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Attach verified entity URIs to each `about` MedicalCondition of each article.

WHY
    Every article already declares `about: {"@type": "MedicalCondition", name,
    alternateName, code: ICD-10}`. That NAMES the condition but does not IDENTIFY
    it: nothing tells a crawler that 「乾眼症」 is the same entity it already knows.
    `sameAs` closes that gap, which is what search and retrieval systems use for
    entity disambiguation.

    The ICD-10 code cannot do this job. It is a classification, not an identity,
    and the codes here include ranges and site-qualified forms (`H25-H26`,
    `H04.123`, `H43.39`).

WHAT sameAs MEANS, AND WHY THE TABLE IS SHORT
    schema.org defines `sameAs` as a URL that unambiguously indicates the item's
    IDENTITY. An entry is therefore only allowed when the condition's `name`
    denotes exactly the linked entity. Composite topics (「白內障合併散光」),
    procedure or decision topics (「青光眼治療」), narrower subtypes
    (「非感染性葡萄膜炎」), site-qualified diseases (「淚腺腺樣囊狀癌」) and names with
    no distinct entity at all (「近視性黃斑部病變」 — "Degenerative myopia" merely
    redirects to Myopia#Types) go in UNMAPPED with a reason. A wrong `sameAs`
    asserts the article is about a different disease, which is worse than silence.

KEYED BY (slug, condition name), NOT BY SLUG
    A slug-keyed table cannot express two things this repo actually needs:
      * one article can carry SEVERAL conditions — floaters-retinal-detachment
        has 飛蚊症 and 視網膜剝離 as separate about nodes, each with its own
        identity, and a slug-level table silently collapsed them into one link;
      * identity belongs to the NAME. With slug keys, renaming a condition to a
        narrower or composite disease keeps stamping the old URI on it, and the
        guard cannot notice. Keying on the exact name makes a rename a build
        failure instead.

PROVENANCE — every Q-id was resolved through the Wikipedia API
    (action=query&prop=pageprops&ppprop=wikibase_item&redirects=1), which returns
    the canonical title after redirect resolution together with its Wikidata item.

    Do NOT hand-add a Q-id from memory. Bulk-resolving these from the existing
    ICD-10 codes via Wikidata's P494 returned `H16 -> Q4393309 = dextran-40` — a
    polysaccharide, not keratitis — because Wikidata carries a bad statement on
    that item. Five mappings below were additionally cross-checked against that
    ICD-10 query and agreed (conjunctivitis, dry eye, thyroid eye disease,
    floater, myopia). Anything new goes through the same check.
"""

from __future__ import annotations

import json
import _jsonld  # M-13: JSON-LD must be escaped for <script> embedding
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BLOG = ROOT / 'blog'

WIKIDATA = 'https://www.wikidata.org/wiki/'
WIKIPEDIA = 'https://en.wikipedia.org/wiki/'

# (slug, exact about.name) -> (Wikidata Q-id, canonical English Wikipedia title)
ENTITY_BY_CONDITION: dict[tuple[str, str], tuple[str, str]] = {
    ('cataract-comprehensive-guide', '白內障'):                 ('Q127724', 'Cataract'),
    ('cataract-surgery-faq', '白內障'):                         ('Q127724', 'Cataract'),
    ('diabetic-retinopathy-dementia-trinetx-cohort', '糖尿病視網膜病變'):
                                                                ('Q631361', 'Diabetic retinopathy'),
    ('dims-pediatric-myopia-control', '近視'):                  ('Q168403', 'Myopia'),
    ('monitoring-myopia-ser-vs-axial-length', '近視'):          ('Q168403', 'Myopia'),
    ('dry-eye-myths', '乾眼症'):                                ('Q1162694', 'Dry eye syndrome'),
    ('dry-eye-symptom-sign-discordance-dream', '乾眼症'):       ('Q1162694', 'Dry eye syndrome'),
    ('glaucoma-comprehensive-guide', '青光眼'):                 ('Q159701', 'Glaucoma'),
    ('glaucoma-warnings', '青光眼'):                            ('Q159701', 'Glaucoma'),
    ('red-eye-conjunctivitis', '結膜炎'):                       ('Q167844', 'Conjunctivitis'),
    ('pterygium-surgery-fixation-methods-2026-nma', '翼狀贅肉'): ('Q1862972', 'Pterygium (eye)'),
    # 甲狀腺眼疾 — Wikipedia files thyroid eye disease under Graves' ophthalmopathy;
    # the requested title redirects there, so it is the same entity.
    ('thyroid-eye-disease', '甲狀腺眼疾'):                      ('Q1340722', "Graves' ophthalmopathy"),
    # 年齡相關性黃斑部病變 — Wikipedia's "Macular degeneration" article IS AMD.
    ('osa-amd-systematic-review-2026', '年齡相關性黃斑部病變'):  ('Q27429789', 'Macular degeneration'),
    ('ophthalmic-trauma-overlooked-burden', '眼外傷'):          ('Q2681162', 'Eye injury'),
    # This article carries TWO conditions, each with its own identity.
    ('floaters-retinal-detachment', '飛蚊症'):                  ('Q142807', 'Floater'),
    ('floaters-retinal-detachment', '視網膜剝離'):              ('Q625164', 'Retinal detachment'),
}

# Conditions that deliberately get NO sameAs. The checker requires every
# about-MedicalCondition to appear in exactly one of the two tables, so a new
# article — or a renamed condition — fails the build until someone decides.
UNMAPPED: dict[tuple[str, str], str] = {
    ('cataract-surgery-selection', '白內障手術選擇'):
        'A surgical decision topic, not a disease entity.',
    ('toric-iol-astigmatism-cataract-review', '白內障合併散光'):
        'A composite of two conditions; neither Cataract (Q127724) nor '
        'Astigmatism (Q177895) alone is the same entity.',
    ('glaucoma-treatment-selection', '青光眼治療'):
        'A treatment-selection topic, not the disease itself.',
    ('contact-lens-safety', '隱形眼鏡相關角膜病'):
        'Lens-related keratopathy; Keratitis (Q757838) is keratitis generally, '
        'a different and broader entity.',
    ('pediatric-high-myopia-maculopathy-progression', '近視性黃斑部病變'):
        'No distinct entity exists — "Degenerative myopia" redirects to '
        'Myopia#Types, so no Wikidata item denotes myopic maculopathy exactly.',
    ('hzo-stromal-keratitis-zeds-lessons', '帶狀疱疹眼疾合併角膜基質炎'):
        'HZO WITH stromal keratitis, narrower than Herpes zoster ophthalmicus '
        '(Q2072712).',
    ('lacrimal-gland-tumor', '淚腺腺樣囊狀癌'):
        'Lacrimal-gland ACC; Adenoid cystic carcinoma (Q356005) is the disease '
        'irrespective of anatomical site.',
    ('refractory-noninfectious-uveitis-biologics-rubi-trial', '非感染性葡萄膜炎'):
        'A subtype of Uveitis (Q280027), not the same entity.',
    # Moved out of the mapped table by review: the earlier justification —
    # that `audience` carried the age qualifier — was FALSE. That node only says
    # audienceType: Patient, and `audience` describes the page's readership, not
    # the condition's population. So 兒童近視 is narrower than Myopia (Q168403).
    ('pediatric-myopia-control', '兒童近視'):
        'Childhood myopia is narrower than Myopia (Q168403); nothing in the '
        'markup restricts the linked entity to children.',
}

LD_JSON_RE = re.compile(
    r'''(<script[^>]*type\s*=\s*['"]application/ld\+json['"][^>]*>)([\s\S]*?)(</script>)''',
    re.I,
)


def expected_same_as(slug: str, name: str) -> list[str] | None:
    entry = ENTITY_BY_CONDITION.get((slug, name))
    if not entry:
        return None
    qid, title = entry
    return [WIKIDATA + qid, WIKIPEDIA + title.replace(' ', '_')]


def _is_medical_condition(node: object) -> bool:
    if not isinstance(node, dict):
        return False
    t = node.get('@type')
    return t == 'MedicalCondition' or (isinstance(t, list) and 'MedicalCondition' in t)


def _walk_nodes(data: object):
    """Yield EVERY dict in the payload, at any depth and under any property.

    An earlier version recursed only through top-level arrays and `@graph`, which
    is not "every node": a condition nested under a node-valued property such as
    `mainEntity` or `subjectOf` was invisible to both the normalizer and the
    checker, while an existing sibling condition kept the page looking accounted
    for. That is the same defect class this guard exists to catch — a helper whose
    docstring claims more coverage than its code delivers — so the walk now
    follows every dict/list value. JSON cannot be cyclic, so this terminates.
    """
    if isinstance(data, list):
        for item in data:
            yield from _walk_nodes(item)
    elif isinstance(data, dict):
        yield data
        for value in data.values():
            if isinstance(value, (dict, list)):
                yield from _walk_nodes(value)


def iter_conditions(html: str):
    """Yield every about-MedicalCondition dict found in the page's JSON-LD."""
    for m in LD_JSON_RE.finditer(html):
        try:
            data = json.loads(m.group(2))
        except Exception:
            continue
        for node in _walk_nodes(data):
            about = node.get('about')
            for cond in (about if isinstance(about, list) else [about]):
                if _is_medical_condition(cond):
                    yield cond


def has_medical_web_page(html: str) -> bool:
    for m in LD_JSON_RE.finditer(html):
        try:
            data = json.loads(m.group(2))
        except Exception:
            continue
        for node in _walk_nodes(data):
            t = node.get('@type')
            t = [t] if isinstance(t, str) else (t if isinstance(t, list) else [])
            if 'MedicalWebPage' in t:
                return True
    return False


def apply_to_html(html: str, slug: str) -> tuple[str, int]:
    """Set/clear sameAs per condition according to the tables. Idempotent."""
    changed = 0

    def repl(m: re.Match) -> str:
        nonlocal changed
        open_tag, body, close_tag = m.group(1), m.group(2), m.group(3)
        try:
            data = json.loads(body)
        except Exception:
            return m.group(0)

        touched = False
        for node in _walk_nodes(data):
            about = node.get('about')
            for cond in (about if isinstance(about, list) else [about]):
                if not _is_medical_condition(cond):
                    continue
                name = cond.get('name')
                want = expected_same_as(slug, name) if isinstance(name, str) else None
                if want is not None:
                    if cond.get('sameAs') != want:
                        cond['sameAs'] = want
                        touched = True
                elif (slug, name) in UNMAPPED and 'sameAs' in cond:
                    # An explicitly unmapped condition must not keep a stale URI.
                    del cond['sameAs']
                    touched = True
        if not touched:
            return m.group(0)
        changed += 1
        return open_tag + '\n' + _jsonld.dumps(data, ensure_ascii=False) + '\n' + close_tag

    return LD_JSON_RE.sub(repl, html), changed


def main() -> int:
    if not BLOG.is_dir():
        print('[FAIL] blog/ not found')
        return 1

    touched_files = 0
    for path in sorted(BLOG.glob('*.html')):
        src = path.read_text(encoding='utf-8')
        out, changed = apply_to_html(src, path.stem)
        if changed and out != src:
            path.write_text(out, encoding='utf-8')
            touched_files += 1

    print(f'[OK] entity links: {len(ENTITY_BY_CONDITION)} conditions mapped, '
          f'{len(UNMAPPED)} deliberately unmapped, {touched_files} file(s) updated')
    return 0


if __name__ == '__main__':
    sys.exit(main())
