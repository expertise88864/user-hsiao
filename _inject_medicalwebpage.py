"""
One-off: inject MedicalWebPage JSON-LD with lastReviewed + reviewedBy +
speakable into 10 articles that are missing it. Each MedicalWebPage block
links the article to:

  - lastReviewed (today) — Google E-E-A-T freshness signal for YMYL
  - reviewedBy: Min-Chien Hsiao, MD — author authority
  - speakable: h1, h2, .tldr — voice-assistant friendly extract
  - about: MedicalCondition with ICD-10 code — medical-knowledge graph hook
  - audience: Patient — narrows search intent

The block is inserted IMMEDIATELY AFTER the existing MedicalScholarlyArticle
JSON-LD script tag so the two schemas sit next to each other in the head.
"""
import re
from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent
TODAY = date.today().isoformat()

# Per-article metadata (audience name, MedicalCondition.name, alt names, ICD-10).
# Audience name is the ZH heading shown to readers, e.g. "白內障 衛教 · …".
ARTICLES = {
    'cataract-surgery-faq': {
        'name': '白內障手術 FAQ 衛教',
        'keywords': '白內障,Cataract,IOL,人工水晶體,白內障手術',
        'condition_name': '白內障',
        'alts': ['白內障', 'Cataract', 'Age-related cataract'],
        'icd10': 'H25.9',
    },
    'contact-lens-safety': {
        'name': '隱形眼鏡安全 衛教',
        'keywords': '隱形眼鏡,Contact lens,角膜炎,鏡片清潔,日拋,月拋',
        'condition_name': '隱形眼鏡相關角膜病變',
        'alts': ['隱形眼鏡相關角膜病變', 'Contact lens-related keratopathy'],
        'icd10': 'H18.6',
    },
    'dims-pediatric-myopia-control': {
        'name': '兒童近視控制（DIMS 鏡片）衛教',
        'keywords': '近視,Myopia,DIMS,離焦鏡片,兒童近視控制,LAMP,ATOM',
        'condition_name': '近視',
        'alts': ['近視', 'Myopia', 'Nearsightedness'],
        'icd10': 'H52.1',
    },
    'dry-eye-symptom-sign-discordance-dream': {
        'name': '乾眼症「症狀-徵象不一致」衛教',
        'keywords': '乾眼症,Dry Eye,DREAM 試驗,Cyclosporine,人工淚液,OSDI,Schirmer',
        'condition_name': '乾眼症',
        'alts': ['乾眼症', 'Dry Eye Disease', 'DED', 'Keratoconjunctivitis sicca'],
        'icd10': 'H04.123',
    },
    'floaters-retinal-detachment': {
        'name': '飛蚊症與視網膜剝離 衛教',
        'keywords': '飛蚊症,Floaters,PVD,視網膜剝離,Retinal detachment,雷射光凝固',
        'condition_name': '飛蚊症',
        'alts': ['飛蚊症', 'Floaters', 'Vitreous floaters'],
        # 後玻璃體剝離 (PVD) removed: it is a CAUSE of floaters, not a synonym,
        # and it contradicted the sameAs=Floater identity claim (D-25).
        'icd10': 'H43.39',
    },
    'glaucoma-warnings': {
        'name': '青光眼急性發作警訊 衛教',
        'keywords': '青光眼,Glaucoma,急性閉角型,Angle-closure,眼壓,Tonometry',
        'condition_name': '青光眼',
        'alts': ['青光眼', 'Glaucoma', 'Acute angle-closure glaucoma'],
        'icd10': 'H40.2',
    },
    'monitoring-myopia-ser-vs-axial-length': {
        'name': '近視監測：度數 vs 眼軸 衛教',
        'keywords': '近視,Myopia,SER,等價球面度數,眼軸長度,Axial length,近視監測',
        'condition_name': '近視',
        'alts': ['近視', 'Myopia', 'Nearsightedness'],
        'icd10': 'H52.1',
    },
    'pediatric-myopia-control': {
        'name': '兒童近視控制完整衛教',
        'keywords': '近視,Myopia,Atropine,Ortho-K,DIMS,RLRL,LAMP,ATOM,兒童近視',
        'condition_name': '近視',
        'alts': ['近視', 'Myopia', 'Nearsightedness'],
        'icd10': 'H52.1',
    },
    'red-eye-conjunctivitis': {
        'name': '紅眼睛與結膜炎 衛教',
        'keywords': '結膜炎,Conjunctivitis,紅眼症,過敏性結膜炎,病毒性結膜炎,腺病毒',
        'condition_name': '結膜炎',
        'alts': ['結膜炎', 'Conjunctivitis', 'Pink eye', '紅眼症'],
        'icd10': 'H10',
    },
    'toric-iol-astigmatism-cataract-review': {
        'name': '散光人工水晶體（Toric IOL）衛教',
        'keywords': '散光,Astigmatism,Toric IOL,人工水晶體,白內障手術,Barrett Toric',
        'condition_name': '白內障合併散光',
        'alts': ['白內障合併散光', 'Cataract with astigmatism', 'Toric IOL candidacy'],
        'icd10': 'H25.9',
    },
}

DOMAIN = 'https://hsiao.chendermatologist.com'


def build_block(slug, m):
    import json  # noqa: F401 — kept for readers; output goes through _jsonld
    import _jsonld  # M-13: JSON-LD must be escaped for <script> embedding
    obj = {
        '@context': 'https://schema.org',
        '@type': 'MedicalWebPage',
        'url': f'{DOMAIN}/blog/{slug}',
        'inLanguage': ['zh-TW', 'en'],
        'name': m['name'],
        'audience': {'@type': 'MedicalAudience', 'audienceType': 'Patient'},
        'lastReviewed': TODAY,
        'reviewedBy': {'@id': f'{DOMAIN}/about#person'},
        'speakable': {'@type': 'SpeakableSpecification', 'cssSelector': ['h1', 'h2', '.tldr']},
        'keywords': m['keywords'],
        'articleSection': 'Ophthalmology Patient Education',
        'about': {
            '@type': 'MedicalCondition',
            'name': m['condition_name'],
            'alternateName': m['alts'],
            'code': {'@type': 'MedicalCode', 'code': m['icd10'], 'codingSystem': 'ICD-10'},
        },
        'isPartOf': {'@type': 'WebSite', 'name': 'HsiaoEye', 'url': f'{DOMAIN}/'},
    }
    return '<script type="application/ld+json">\n' + _jsonld.dumps(obj, ensure_ascii=False) + '\n</script>'


def main():
    n = 0
    for slug, meta in ARTICLES.items():
        p = ROOT / 'blog' / f'{slug}.html'
        c = p.read_text(encoding='utf-8')
        if 'MedicalWebPage' in c:
            print(f'skip (already has): {slug}')
            continue
        # Insert right after the first MedicalScholarlyArticle script tag close.
        pat = re.compile(
            r'(<script type="application/ld\+json">[^<]*?"@type"\s*:\s*"MedicalScholarlyArticle"[\s\S]*?</script>)',
            re.IGNORECASE,
        )
        block = build_block(slug, meta)
        new_c, count = pat.subn(lambda m: m.group(1) + '\n' + block, c, count=1)
        if count == 0:
            print(f'NO MedicalScholarlyArticle anchor: {slug}')
            continue
        p.write_text(new_c, encoding='utf-8')
        n += 1
        print(f'injected: {slug}')
    print(f'total: {n}')


if __name__ == '__main__':
    main()
