"""
One-off: add `MedicalGuideline` JSON-LD to articles that ARE clinical
guidelines (the "完整衛教" / "完整選擇" titles). Google has a dedicated
rich-snippet eligibility track for MedicalGuideline that other medical
schema types don't trigger — it pulls evidence level, guideline subject,
and recognising body into the SERP card.

Targeted articles (5):
  - cataract-comprehensive-guide       white-cataract surgery guideline
  - cataract-surgery-selection         IOL selection guideline
  - glaucoma-comprehensive-guide       glaucoma management guideline
  - glaucoma-treatment-selection       glaucoma treatment guideline
  - thyroid-eye-disease                TED management guideline
  - lacrimal-gland-tumor               lacrimal-gland tumor guideline
  - pediatric-myopia-control           pediatric myopia control guideline

Per https://schema.org/MedicalGuideline + Google's medical-content
ranking documentation:
  - evidenceLevel: EvidenceLevelA/B/C  (we use EvidenceLevelA since
    all citations are from peer-reviewed international guidelines)
  - evidenceOrigin: short text summarising sources (AAO PPP, EUGOGO, …)
  - guidelineSubject: the MedicalCondition this guideline applies to
  - guidelineDate: most recent revision

Inserts the block after the article's existing MedicalScholarlyArticle
JSON-LD so the page has both: ScholarlyArticle for general article
indexing + MedicalGuideline for the medical-rich-result lane.
"""
import json
import _jsonld  # M-13: JSON-LD must be escaped for <script> embedding
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
DOMAIN = 'https://hsiao.chendermatologist.com'
TODAY = '2026-05-18'

# slug → (guidelineSubject name, alternateName, ICD-10, evidenceOrigin)
GUIDELINES = {
    'cataract-comprehensive-guide': (
        '白內障',
        ['白內障', 'Cataract', 'Age-related cataract'],
        'H25.9',
        '2021 AAO PPP Cataract, 2025 AAPPO consensus, ESCRS 2024 31 GRADE recommendations',
    ),
    'cataract-surgery-selection': (
        '白內障手術決策',
        ['白內障手術', 'Cataract surgery decision', 'IOL selection'],
        'H25.9',
        '2021 AAO PPP Cataract, ESCRS 2024 GRADE recommendations',
    ),
    'glaucoma-comprehensive-guide': (
        '青光眼',
        ['青光眼', 'Glaucoma', 'POAG', 'Angle-closure glaucoma'],
        'H40',
        '2025 AAO POAG/ACG PPP, 2022 NICE NG81, European Glaucoma Society Guidelines',
    ),
    'glaucoma-treatment-selection': (
        '青光眼治療決策',
        ['青光眼治療', 'Glaucoma management', 'SLT vs medication'],
        'H40',
        '2025 AAO PPP, 2022 NICE NG81, LiGHT trial 6-year extension, PTVT trial, EAGLE trial',
    ),
    'thyroid-eye-disease': (
        '甲狀腺眼疾',
        ['甲狀腺眼疾', 'Thyroid eye disease', 'TED', "Graves' orbitopathy", 'GO'],
        'H06.2',
        '2021 EUGOGO guidelines, 2022 ATA/ETA consensus, 2025 ETJ comparative review',
    ),
    'lacrimal-gland-tumor': (
        '淚腺腫瘤',
        ['淚腺腫瘤', 'Lacrimal gland tumor', 'Adenoid cystic carcinoma', 'LGACC'],
        'C69.5',
        'IJO 2024 meta-analysis, MD Anderson eye-sparing surgery series, AJCC 8th-edition staging',
    ),
    'pediatric-myopia-control': (
        '兒童近視控制',
        ['兒童近視', 'Pediatric myopia control', 'Atropine for myopia'],
        'H52.1',
        'IMI 2021 Clinical Management Guidelines, LAMP study, ATOM study, DIMS Lam 2020 BJO',
    ),
}


def build_block(slug, subject_name, alts, icd10, evidence_origin):
    obj = {
        '@context': 'https://schema.org',
        '@type': 'MedicalGuideline',
        '@id': f'{DOMAIN}/blog/{slug}#guideline',
        'name': f'{subject_name}臨床衛教指引 — HsiaoEye',
        'url': f'{DOMAIN}/blog/{slug}',
        'inLanguage': 'zh-Hant-TW',
        'evidenceLevel': 'https://schema.org/EvidenceLevelA',
        'evidenceOrigin': evidence_origin,
        'guidelineDate': TODAY,
        'guidelineSubject': {
            '@type': 'MedicalCondition',
            'name': subject_name,
            'alternateName': alts,
            'code': {'@type': 'MedicalCode', 'code': icd10, 'codingSystem': 'ICD-10'},
        },
        'recognizingAuthority': {
            '@type': 'MedicalOrganization',
            'name': 'HsiaoEye — Min-Chien Hsiao, MD (compiled from cited international guidelines)',
            'url': f'{DOMAIN}/about',
        },
        'author': {'@id': f'{DOMAIN}/about#person'},
        'isPartOf': {'@id': f'{DOMAIN}/#website'},
    }
    return '<script type="application/ld+json">\n' + _jsonld.dumps(obj, ensure_ascii=False) + '\n</script>'


def main():
    n = 0
    for slug, (subj, alts, icd10, evidence) in GUIDELINES.items():
        fp = os.path.join(ROOT, 'blog', f'{slug}.html')
        if not os.path.isfile(fp):
            print(f'  skip (missing): {slug}')
            continue
        with open(fp, encoding='utf-8') as f:
            html = f.read()
        # Idempotency guard. Two things the old `'"@type":"MedicalGuideline"'
        # literal got wrong: (1) build_block emits json.dumps with DEFAULT
        # separators → `"@type": "MedicalGuideline"` (WITH space), the form all
        # committed files carry, so the no-space literal never matched and a
        # re-run injected a DUPLICATE block into every processed article; (2) a
        # bare substring check would also false-match the type appearing in a
        # <code> example. So: scan each ld+json <script> block individually
        # (lazy to the first </script>, no cross-block span) and check its JSON
        # body. This is a one-off (not in quality.yml), so preflight never
        # exercised its idempotency.
        if any(re.search(r'"@type"\s*:\s*"MedicalGuideline"', _ld)
               for _ld in re.findall(
                   r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>',
                   html, re.I)):
            print(f'  skip (already has): {slug}')
            continue
        block = build_block(slug, subj, alts, icd10, evidence)
        # Insert after first MedicalScholarlyArticle script tag close.
        pat = re.compile(
            r'(<script type="application/ld\+json">[^<]*?"@type"\s*:\s*"MedicalScholarlyArticle"[\s\S]*?</script>)',
            re.IGNORECASE,
        )
        new_html, count = pat.subn(lambda m: m.group(1) + '\n' + block, html, count=1)
        if count == 0:
            print(f'  no MedicalScholarlyArticle anchor: {slug}')
            continue
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(new_html)
        n += 1
        print(f'  + {slug}.html')
    print(f'\nadded MedicalGuideline schema to {n} file(s)')


if __name__ == '__main__':
    main()
