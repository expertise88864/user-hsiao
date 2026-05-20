"""
HsiaoEye — normalize search/social snippets for public pages.

This generator keeps crawler-facing summaries useful for search result CTR and
social/link previews:
  - repairs short or mojibake article meta descriptions
  - keeps og:description substantial enough for preview cards
  - adds missing twitter:description fallbacks

Run before _gen_en_pages.py so the English mirror can inherit fresh head
metadata and regenerate its own locale-specific descriptions.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
LISTING_SCHEMA_RE = re.compile(
    r'\n?<script\s+type="application/ld\+json"\s+data-listing-auto>[\s\S]*?</script>\n?',
    re.I,
)

ARTICLE_SNIPPETS = {
    'toric-iol-astigmatism-cataract-review':
        '2026 年 ESCRS 整合性回顧：散光人工水晶體 Toric IOL 適應症（≥1.0 D 規則散光）、術前評估、計算公式、旋轉風險（90-97% 內 5°）、特殊族群（雷射術後/圓錐角膜/PEX/角膜移植後）注意事項、台灣全自費現況。蕭閔謙醫師整理。',
    'dry-eye-symptom-sign-discordance-dream':
        '乾眼症為什麼主觀很乾、檢查卻還好？DREAM 試驗 535 位中重度乾眼分析顯示 77% 症狀與徵象不一致，整理 4 型分佈、治療選擇與台灣健保給付。',
    'monitoring-myopia-ser-vs-axial-length':
        'Clark & Wong 2026 AJO 統合分析（70 篇人群研究）：大多數兒童應以等價球面度數（SER）為近視監測主軸，眼軸長度（AL）保留給長尾族群。整理眼軸/度數對視網膜、白內障、青光眼的預測力與證據限制。',
    'dims-pediatric-myopia-control':
        'DIMS 鏡片 12 個月可比單焦鏡片多保留約 0.37 D 度數、少增長 0.16 mm 眼軸。整合 2026 AJO 統合分析（6 篇 RCT、1224 位兒童）、Lam 2020/2023 與 Cochrane 2023 living review，蕭閔謙醫師（眼科）解析。',
    'cataract-surgery-selection':
        '白內障手術怎麼選才不被話術牽著走？比較超音波、飛秒雷射、MSICS、IOL 分類、Monovision、散光矯正、度數計算公式、健保與自費差異，整理台灣實務重點。',
    'glaucoma-treatment-selection':
        '青光眼治療怎麼選？整理 SLT 雷射與藥物第一線、前列腺素類副作用、複方眼藥水、加藥/換藥邏輯、MIGS、傳統手術階梯、閉角型路徑與台灣健保現況。',
    'glaucoma-comprehensive-guide':
        '青光眼早期常沒有症狀，何時要篩檢？整合 AAO、NICE、EGS 指引與台灣數據，整理開角/閉角/正常眼壓型分類、急性閉角紅旗、SLT、藥物、手術與居家照護。',
    'cataract-comprehensive-guide':
        '白內障什麼時候該開刀？人工水晶體怎麼選？整合 AAO、AAPPO、ESCRS 指引，整理視力以外的手術時機、單焦/散光/EDOF/多焦 IOL 取捨、飛秒雷射與術後恢復。',
    'thyroid-eye-disease':
        '甲狀腺眼疾（TED）何時需要治療？整理 EUGOGO、ATA/ETA 與 2025 回顧，說明 active/inactive 分期、CAS 評分、嚴重度、類固醇/放療/手術階梯與視神經壓迫急症。',
    'lacrimal-gland-tumor':
        '眼睛凸出來、淚腺區疼痛、視力下降 — 可能是淚腺腫瘤（尤其腺樣囊狀癌 ACC)。整理 IJO 2024 Meta-analysis、MD Anderson 質子治療與動脈內化療最新證據，回答家長與病友最常問的 6 個問題：診斷、治療選項、保留眼球可行嗎？放療後視力會剩多少？蕭閔謙醫師（眼科）整理。',
    'dry-eye-myths':
        '點人工淚液會依賴？流淚就不是乾眼？葉黃素能治乾眼？整理 8 個常見乾眼迷思，說明 BAK 防腐劑、Omega-3 證據、瞼板腺熱敷、何時該就醫檢查。',
    'pediatric-myopia-control':
        '阿托品 0.01% / 0.05% 哪個有效?OK 鏡會傷角膜嗎？紅光治療安全嗎？多焦點離焦鏡片是什麼？戶外 2 小時真的能預防近視?8 個家長最常問的兒童近視控制問題，引用 LAMP / ATOM / DIMS / RLRL 等大型研究，蕭閔謙醫師（眼科）整理。',
    'floaters-retinal-detachment':
        '飛蚊症會自己好嗎？突然增多的飛蚊代表什麼？閃光是視網膜要剝離的警訊嗎？高度近視族群最該注意什麼?6 個民眾最常誤會的飛蚊症與視網膜剝離觀念。引用 AAO PPP 2019、JAMA 2009、Eye 2010 大型研究，蕭閔謙醫師（眼科）整理。',
}

STATIC_SNIPPETS = {
    'index.html':
        '蕭閔謙醫師（眼科住院醫師）的個人衛教網站。乾眼症、兒童近視控制、白內障、視網膜疾病等民眾最常見的眼科問題與學習筆記。',
    'about.html':
        '蕭閔謙醫師（Min-Chien Hsiao, MD）個人簡介。眼科住院醫師。學歷：高雄醫學大學 學士後醫學系。',
    'tools.html':
        'OSDI、DEQ-5、Snellen↔LogMAR、球面等價度數 (SE)、飛蚊症警訊自我檢核 — 5 個眼科常用臨床量表，蕭閔謙醫師整理，立即線上計算與分級解讀。',
    'notes.html':
        'HsiaoEye 學習筆記整理眼科住院醫師的臨床閱讀、研究摘要與病人衛教延伸內容，提供醫學生、住院醫師與一般讀者更深入的眼科脈絡。',
    'privacy.html':
        'HsiaoEye 隱私權政策說明本站如何使用分析工具、Cookie、第三方服務與基本訪客資料，並說明醫療衛教內容與個人醫療建議的界線。',
    'blog/index.html':
        'HsiaoEye 全部眼科衛教文章索引 — 乾眼症、兒童近視控制、白內障、青光眼、視網膜疾病。蕭閔謙醫師（眼科）整理。',
    'blog/topics.html':
        'HsiaoEye 全部眼科衛教主題地圖 — 乾眼症、兒童近視控制、飛蚊症、白內障、青光眼、葉黃素等。',
}

def read_catalog():
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('DN.ARTICLES not found')
    rows = []
    for obj in re.finditer(r'\{([^{}]*)\}', m.group(1)):
        body = obj.group(1)
        row = {}
        for key in ('slug', 'title', 'title_en', 'cat', 'tag', 'tag_en', 'date', 'updated'):
            km = re.search(rf"{key}\s*:\s*'([^']*)'", body)
            if km:
                row[key] = km.group(1)
        if row.get('slug') and row.get('title'):
            rows.append(row)
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return [row for row in rows if row['slug'] not in stubs]

def attr_escape(value: str) -> str:
    return html.escape(value, quote=True)


def meta_content(src: str, key: str, attr: str = 'name') -> str:
    m = re.search(rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)) if m else ''


def head_title(src: str) -> str:
    og = meta_content(src, 'og:title', attr='property')
    if og:
        return og.strip()
    m = re.search(r'<title>([^<]*)</title>', src, re.I)
    if not m:
        return 'HsiaoEye ophthalmology preview image'
    return html.unescape(m.group(1)).strip()


def image_object(page_url: str, image_url: str, alt: str) -> dict[str, object]:
    return {
        '@type': 'ImageObject',
        '@id': f'{page_url}#primaryimage',
        'url': image_url,
        'contentUrl': image_url,
        'width': 1200,
        'height': 630,
        'name': alt,
        'caption': alt,
    }


def bad_snippet(value: str, min_len: int) -> bool:
    v = html.unescape(value or '').strip()
    if len(v) < min_len:
        return True
    if v.count('?') >= 8:
        return True
    if '????' in v:
        return True
    return False


def upsert_meta(src: str, key: str, content: str, attr: str = 'name') -> str:
    escaped = attr_escape(content)
    repl = f'<meta {attr}="{key}" content="{escaped}" />'
    pat = rf'<meta\s+{attr}="{re.escape(key)}"\s+content="[^"]*"\s*/?>'
    if re.search(pat, src, re.I):
        return re.sub(pat, repl, src, count=1, flags=re.I)
    return src.replace('</head>', repl + '\n</head>', 1)


def normalize_file(path: Path, fallback: str, is_article: bool) -> bool:
    src = path.read_text(encoding='utf-8')
    title = head_title(src)
    desc = meta_content(src, 'description')
    if bad_snippet(desc, 70 if is_article else 50):
        desc = fallback

    og = meta_content(src, 'og:description', attr='property')
    if bad_snippet(og, 70 if is_article else 50):
        og = desc

    tw = meta_content(src, 'twitter:description')
    if bad_snippet(tw, 70 if is_article else 50):
        tw = desc

    out = src
    out = upsert_meta(out, 'description', desc)
    out = upsert_meta(out, 'og:description', og, attr='property')
    out = upsert_meta(out, 'twitter:card', 'summary_large_image')
    out = upsert_meta(out, 'twitter:description', tw)
    if meta_content(out, 'og:image', attr='property'):
        out = upsert_meta(out, 'og:image:alt', title, attr='property')
    if meta_content(out, 'twitter:image'):
        out = upsert_meta(out, 'twitter:image:alt', title)

    if out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def type_names(obj: dict) -> set[str]:
    value = obj.get('@type')
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def normalize_article_structured_data(path: Path, slug: str) -> bool:
    src = path.read_text(encoding='utf-8')
    page_url = f'{DOMAIN}/blog/{slug}'
    article_id = f'{page_url}#article'
    webpage_id = f'{page_url}#webpage'
    expected = f'{DOMAIN}/assets/og/{slug}.png'
    page_desc = meta_content(src, 'description')
    image_alt = meta_content(src, 'og:image:alt', attr='property') or head_title(src)
    primary_image = image_object(page_url, expected, image_alt)
    expected_file = ROOT / 'assets' / 'og' / f'{slug}.png'
    if not expected_file.exists():
        return False

    changed = False
    article_meta = {}

    def repl(match):
        nonlocal changed, article_meta
        raw = match.group(2).strip()
        try:
            data = json.loads(raw)
        except Exception:
            return match.group(0)
        if not isinstance(data, dict):
            return match.group(0)
        types = type_names(data)
        old = json.dumps(data, ensure_ascii=False, sort_keys=True)

        if types & {'Article', 'BlogPosting', 'MedicalScholarlyArticle'}:
            data['@id'] = article_id
            data['image'] = primary_image
            data['thumbnailUrl'] = expected
            data['mainEntityOfPage'] = page_url
            article_meta = {
                'headline': data.get('headline') or data.get('name') or '',
                'description': page_desc if len(page_desc) > len(data.get('description') or '') else data.get('description') or '',
                'datePublished': data.get('datePublished') or '',
                'dateModified': data.get('dateModified') or data.get('datePublished') or '',
                'author': data.get('author') or {'@id': f'{DOMAIN}/about#person'},
                'publisher': data.get('publisher') or {'@id': f'{DOMAIN}/about#person'},
            }
        elif 'MedicalWebPage' in types:
            data['@id'] = webpage_id
            data['url'] = page_url
            data['image'] = primary_image
            data['primaryImageOfPage'] = {'@id': primary_image['@id']}
            data['thumbnailUrl'] = expected
            data['mainEntity'] = {'@id': article_id}
            if article_meta.get('headline') and not data.get('name'):
                data['name'] = article_meta['headline']
            if article_meta.get('description'):
                data['description'] = article_meta['description']
            if article_meta.get('datePublished'):
                data['datePublished'] = article_meta['datePublished']
            if article_meta.get('dateModified'):
                data['dateModified'] = article_meta['dateModified']
            data['author'] = article_meta.get('author') or {'@id': f'{DOMAIN}/about#person'}
            data['publisher'] = article_meta.get('publisher') or {'@id': f'{DOMAIN}/about#person'}
            data.setdefault('reviewedBy', {'@id': f'{DOMAIN}/about#person'})
        else:
            return match.group(0)

        if json.dumps(data, ensure_ascii=False, sort_keys=True) == old:
            return match.group(0)
        changed = True
        dumped = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        return f'{match.group(1)}\n{dumped}\n</script>'

    out = re.sub(
        r'(<script\s+type="application/ld\+json"[^>]*>)([\s\S]*?)</script>',
        repl,
        src,
    )
    if changed and out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def listing_schema(canonical_path: str, name: str, articles: list[dict[str, str]]) -> str:
    data = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': f'{DOMAIN}{canonical_path}#article-list',
        'name': name,
        'numberOfItems': len(articles),
        'itemListOrder': 'https://schema.org/ItemListOrderDescending',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': i + 1,
                'url': f"{DOMAIN}/blog/{row['slug']}",
                'name': row['title'],
            }
            for i, row in enumerate(articles)
        ],
    }
    return (
        '<script type="application/ld+json" data-listing-auto>'
        + json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        + '</script>'
    )


def inject_listing_schema(path: Path, canonical_path: str, name: str, articles: list[dict[str, str]]) -> bool:
    src = path.read_text(encoding='utf-8')
    block = listing_schema(canonical_path, name, articles)
    cleaned = LISTING_SCHEMA_RE.sub('\n', src)
    if block in cleaned:
        return False
    out = re.sub(
        r'(<script\s+type="application/ld\+json"[^>]*>[\s\S]*?</script>)',
        r'\1\n' + block,
        cleaned,
        count=1,
        flags=re.I,
    )
    if out == cleaned:
        out = cleaned.replace('</head>', block + '\n</head>', 1)
    if out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def main() -> int:
    changed = []
    catalog = read_catalog()
    for rel, desc in STATIC_SNIPPETS.items():
        path = ROOT / rel
        if path.exists() and normalize_file(path, desc, is_article=False):
            changed.append(rel)

    listing_targets = [
        ('blog/index.html', '/blog', 'Published ophthalmology articles'),
        ('blog/topics.html', '/blog/topics', 'Ophthalmology topic article list'),
    ]
    for rel, canonical_path, name in listing_targets:
        path = ROOT / rel
        if path.exists() and inject_listing_schema(path, canonical_path, name, catalog):
            changed.append(rel)

    for slug in sorted(row['slug'] for row in catalog):
        path = ROOT / 'blog' / f'{slug}.html'
        fallback = ARTICLE_SNIPPETS.get(slug)
        if not fallback:
            print(f'WARN: no curated snippet for {slug}')
            continue
        schema_changed = normalize_article_structured_data(path, slug)
        if schema_changed:
            changed.append(path.relative_to(ROOT).as_posix())
        if normalize_file(path, fallback, is_article=True):
            rel = path.relative_to(ROOT).as_posix()
            if rel not in changed:
                changed.append(rel)

    print(f'Normalized SERP/social metadata in {len(changed)} file(s)')
    for rel in changed:
        print(f'  - {rel}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
