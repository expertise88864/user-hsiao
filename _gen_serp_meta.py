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
import _jsonld  # M-13: JSON-LD must be escaped for <script> embedding
import _articles_field
import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
LISTING_SCHEMA_RE = re.compile(
    r'\n?<script\s+type="application/ld\+json"\s+data-listing-auto>[\s\S]*?</script>\n?',
    re.I,
)
BREADCRUMB_SCHEMA_RE = re.compile(
    r'\n?<script\s+type="application/ld\+json"\s+data-breadcrumb-auto>[\s\S]*?</script>\n?',
    re.I,
)

ARTICLE_SNIPPETS = {
    'pediatric-high-myopia-maculopathy-progression':
        '2026《美國眼科期刊》中山眼科 8 年前瞻世代：155 名高度近視兒童、310 隻眼。8 年內 31.3% 出現近視性黃斑部病變惡化；把「2 年眼軸變化率」加入模型，可將預測準確度從 AUC 0.772 提升到 0.829，最佳切點約每年 0.325 mm。整理 Meta-PM 分級、機轉、高風險族群、紅旗與台灣家長對策。蕭閔謙醫師整理。',
    'refractory-noninfectious-uveitis-biologics-rubi-trial':
        '2026 AJO RUBI 多中心貝氏隨機試驗：112 名成人難治型非感染性、非前段葡萄膜炎，比較 adalimumab（抗 TNF-α）、tocilizumab（抗 IL-6R）、anakinra（抗 IL-1）16 週。主要複合終點 ADA 16% vs TCZ 14%（相當、不顯著）；anakinra 因療效不足提早停止；類固醇減量達標 ADA 59% vs TCZ 74%。機轉、安全性、研究限制與台灣處境完整整理。蕭閔謙醫師整理。',
    'osa-amd-systematic-review-2026':
        '2026 AJO Yaldo 等系統性回顧整合分析：8 篇研究、353 萬人（含台灣 NHIRD）。OSA 與 AMD 風險顯著相關——調整 aOR 1.44（中等證據力，I²=0%）、時間風險 aHR 1.66；nAMD OR 1.76、非新生血管型 1.95。機轉：間歇缺氧→補體活化+脈絡膜血流不足。OSA 是少數可治療的 AMD 系統性危險因子，惟證據力尚不支持例行篩檢。蕭閔謙醫師整理。',
    'pterygium-surgery-fixation-methods-2026-nma':
        '2026 AJO Terres 等網絡統合分析（NMA）：35 篇 RCT、2,501 隻眼，比較翼狀贅肉合併結膜自體移植時 6 種固定方法。纖維蛋白膠（fibrin glue）復發率最低（OR 0.27）、Vicryl 8-0 可吸收縫線移植片穩定度最佳、絲線併發症最多不建議使用；選擇要平衡「復發率」與「術後穩定」並考量成本、可取得性、術者經驗。健保未收載眼科適應症 fibrin glue 與翼狀贅肉手術相關規定。蕭閔謙醫師整理。',
    'diabetic-retinopathy-dementia-trinetx-cohort':
        '2026 AJO Khangura 等 TriNetX 77 萬人世代分析：糖尿病視網膜病變越嚴重，全因失智症與血管型失智症風險呈階梯式增加；增殖性 DR 全因失智 HR 1.58、血管型 2.08；阿茲海默症風險主要來自糖尿病本身、與 DR 嚴重度沒有顯著梯度關係。眼底檢查可作為失智早期 risk marker。蕭閔謙醫師整理。',
    'hzo-stromal-keratitis-zeds-lessons':
        '2026 AJO ZEDS 試驗 SK 終點二次分析（Jacobs 等）：527 人 RCT 中 20% 出現反覆角膜基質炎；75% 在常規追蹤無症狀時被診斷、停類固醇 3 個月內 38% 復發、低效價類固醇足以控制大多數病灶、僅 10% 需口服 valacyclovir 介入；對應台灣健保 §10.7.1.1（療程 10 天為限）與 §14.2（眼用 acyclovir）條文。蕭閔謙醫師整理。',
    'ophthalmic-trauma-overlooked-burden':
        '2026 AJO Perspective + IGATES 8238 例眼外傷登錄：閉合性 56.9%、開放性 34.0%、99% 受傷時沒戴護目鏡、38% 發生在家、70% 拖過 12 小時才就醫；AAO 估計最高 90% 眼外傷可被適當護目預防。整理高風險族群、就醫時機、與台灣健保/職安/煙火法規需人工確認的部分。蕭閔謙醫師整理。',
    'toric-iol-astigmatism-cataract-review':
        '2026 年 ESCRS 整合性回顧：散光人工水晶體 Toric IOL 適應症（≥1.0 D 規則散光）、術前評估、計算公式、旋轉風險（90-97% 內 5°）、特殊族群（雷射術後/圓錐角膜/PEX/角膜移植後）注意事項、台灣全自費現況。蕭閔謙醫師整理。',
    'dry-eye-symptom-sign-discordance-dream':
        '乾眼症為什麼主觀很乾、檢查卻還好？DREAM 試驗 535 位中重度乾眼分析顯示 77% 症狀與徵象不一致，整理 4 型分佈、治療選擇與台灣健保給付。',
    'monitoring-myopia-ser-vs-axial-length':
        '孩子近視追蹤要看度數還是眼軸長度？整理兩種測量代表的意義、適用情境與研究限制，解讀等價球面度數和眼軸長度的差異，以及門診追蹤可與醫師討論的問題。依 Clark 與 Wong 2026 統合分析整理。',
    'dims-pediatric-myopia-control':
        'DIMS 離焦鏡片是什麼、適合哪些近視兒童？整理近視度數與眼軸的研究結果，說明與阿托品、角膜塑型片等方法的比較、配戴注意事項、追蹤與常見疑問。附原始研究及證據限制，協助家長準備眼科回診問題。',
    'cataract-surgery-selection':
        '白內障手術種類有哪些？健保與自費人工水晶體差在哪？比較超音波、飛秒雷射等術式，以及單焦、多焦、延焦深與散光人工水晶體的取捨，整理術前評估、生活需求與回診可問的問題，協助你與醫師討論選擇。',
    'glaucoma-treatment-selection':
        '青光眼治療怎麼選？整理 SLT 雷射與藥物第一線、前列腺素類副作用、複方眼藥水、加藥/換藥邏輯、MIGS、傳統手術階梯、閉角型路徑與台灣健保現況。',
    'glaucoma-comprehensive-guide':
        '青光眼有哪些症狀？早期沒有感覺，該做哪些檢查？整理開角型、閉角型與正常眼壓型青光眼，說明急性發作警訊、眼壓與視野檢查、藥物、雷射、手術及居家照護，依現有指引協助你準備回診問題。',
    'cataract-comprehensive-guide':
        '白內障什麼時候該開刀？人工水晶體怎麼選？整合 AAO、AAPPO、ESCRS 指引，整理視力以外的手術時機、單焦/散光/EDOF/多焦 IOL 取捨、飛秒雷射與術後恢復。',
    'thyroid-eye-disease':
        '甲狀腺眼疾（TED）何時需要治療？整理 EUGOGO、ATA/ETA 與 2025 回顧，說明 active/inactive 分期、CAS 評分、嚴重度、類固醇/放療/手術階梯與視神經壓迫急症。',
    'lacrimal-gland-tumor':
        '淚腺腫瘤一定是癌症嗎？眼球突出、疼痛時要做哪些檢查？整理良性與惡性淚腺腫瘤的差異，聚焦淚腺癌中的腺樣囊狀癌，說明保留眼球手術、放射治療、動脈內化療與追蹤的常見問題，附研究來源與治療限制。',
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
    for obj in _articles_field.RECORD_RE.finditer( m.group(1)):
        body = obj.group(1)
        row = {}
        for key in ('slug', 'title', 'title_en', 'cat', 'tag', 'tag_en', 'date', 'updated'):
            km = _articles_field.field(key, body)
            if km:
                row[key] = km
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


def validate_fallback_snippets(catalog: list[dict[str, str]]) -> None:
    errors = []
    expected_slugs = {row['slug'] for row in catalog}
    actual_slugs = set(ARTICLE_SNIPPETS)
    missing = sorted(expected_slugs - actual_slugs)
    extra = sorted(actual_slugs - expected_slugs)
    if missing:
        errors.append('missing article snippets: ' + ', '.join(missing))
    if extra:
        errors.append('stale article snippets: ' + ', '.join(extra))

    for rel, snippet in STATIC_SNIPPETS.items():
        if bad_snippet(snippet, 50):
            errors.append(f'{rel}: unusable static fallback snippet')
    for slug, snippet in ARTICLE_SNIPPETS.items():
        if bad_snippet(snippet, 70):
            errors.append(f'{slug}: unusable article fallback snippet')

    if errors:
        raise SystemExit('SERP fallback snippet audit failed:\n  - ' + '\n  - '.join(errors))


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
    og_image = meta_content(out, 'og:image', attr='property').strip()
    if og_image:
        out = upsert_meta(out, 'og:image:width', '1200', attr='property')
        out = upsert_meta(out, 'og:image:height', '630', attr='property')
        out = upsert_meta(out, 'og:image:alt', title, attr='property')
        out = upsert_meta(out, 'twitter:image', og_image)
        out = upsert_meta(out, 'twitter:image:alt', title)
    elif meta_content(out, 'twitter:image'):
        out = upsert_meta(out, 'twitter:image:alt', title)
    out = upsert_meta(out, 'og:locale', 'zh_TW', attr='property')
    out = upsert_meta(out, 'og:locale:alternate', 'en_US', attr='property')

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
    breadcrumb_id = f'{page_url}#breadcrumb'
    website_id = f'{DOMAIN}/#website'
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
            data['isPartOf'] = {'@id': website_id}
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
            data['breadcrumb'] = {'@id': breadcrumb_id}
            data['isPartOf'] = {'@id': website_id}
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
        elif 'BreadcrumbList' in types:
            data['@id'] = breadcrumb_id
            items = data.get('itemListElement')
            if isinstance(items, list) and items:
                first = items[0] if isinstance(items[0], dict) else None
                if first is not None:
                    first['item'] = f'{DOMAIN}/'
                if len(items) >= 2 and isinstance(items[1], dict):
                    items[1]['item'] = f'{DOMAIN}/blog'
                last = items[-1] if isinstance(items[-1], dict) else None
                if last is not None:
                    last['item'] = page_url
        else:
            return match.group(0)

        if json.dumps(data, ensure_ascii=False, sort_keys=True) == old:
            return match.group(0)
        changed = True
        dumped = _jsonld.dumps(data, ensure_ascii=False, separators=(',', ':'))
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
    page_url = f'{DOMAIN}{canonical_path}'
    def list_item(i: int, row: dict[str, str]) -> dict[str, object]:
        article_url = f"{DOMAIN}/blog/{row['slug']}"
        image_url = f"{DOMAIN}/assets/og/{row['slug']}.png"
        modified = row.get('updated') or row.get('date') or ''
        return {
            '@type': 'ListItem',
            'position': i + 1,
            'url': article_url,
            'name': row['title'],
            'item': {
                '@type': 'MedicalScholarlyArticle',
                '@id': f'{article_url}#article',
                'url': article_url,
                'headline': row['title'],
                'name': row['title'],
                'inLanguage': 'zh-Hant-TW',
                'datePublished': row.get('date') or modified,
                'dateModified': modified,
                'image': image_url,
                'thumbnailUrl': image_url,
                'author': {'@id': f'{DOMAIN}/about#person'},
                'publisher': {'@id': f'{DOMAIN}/about#person'},
                'isPartOf': {'@id': f'{DOMAIN}/#website'},
            },
        }

    data = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': f'{page_url}#article-list',
        'name': name,
        'numberOfItems': len(articles),
        'itemListOrder': 'https://schema.org/ItemListOrderDescending',
        'mainEntityOfPage': {'@id': f'{page_url}#webpage'},
        'isPartOf': {'@id': f'{DOMAIN}/#website'},
        'itemListElement': [list_item(i, row) for i, row in enumerate(articles)],
    }
    return (
        '<script type="application/ld+json" data-listing-auto>'
        + _jsonld.dumps(data, ensure_ascii=False, separators=(',', ':'))
        + '</script>'
    )


def normalize_listing_page_structured_data(path: Path, canonical_path: str) -> bool:
    src = path.read_text(encoding='utf-8')
    page_url = f'{DOMAIN}{canonical_path}'
    webpage_id = f'{page_url}#webpage'
    article_list_id = f'{page_url}#article-list'
    breadcrumb_id = f'{page_url}#breadcrumb'
    changed = False

    def repl(match):
        nonlocal changed
        raw = match.group(2).strip()
        try:
            data = json.loads(raw)
        except Exception:
            return match.group(0)
        if not isinstance(data, dict):
            return match.group(0)
        types = type_names(data)
        old = json.dumps(data, ensure_ascii=False, sort_keys=True)

        if types & {'Blog', 'CollectionPage'} and data.get('url') == page_url:
            data['@id'] = webpage_id
            data['mainEntity'] = {'@id': article_list_id}
            data['breadcrumb'] = {'@id': breadcrumb_id}
            data['isPartOf'] = {'@id': f'{DOMAIN}/#website'}
            data.setdefault('publisher', {'@id': f'{DOMAIN}/about#person'})
        elif 'ItemList' in types and data.get('@id') == article_list_id:
            data['mainEntityOfPage'] = {'@id': webpage_id}
            data['isPartOf'] = {'@id': f'{DOMAIN}/#website'}
        else:
            return match.group(0)

        if json.dumps(data, ensure_ascii=False, sort_keys=True) == old:
            return match.group(0)
        changed = True
        dumped = _jsonld.dumps(data, ensure_ascii=False, separators=(',', ':'))
        return f'{match.group(1)}{dumped}</script>'

    out = re.sub(
        r'(<script\s+type="application/ld\+json"[^>]*>)([\s\S]*?)</script>',
        repl,
        src,
        flags=re.I,
    )
    if changed and out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def breadcrumb_schema(canonical_path: str, crumbs: list[tuple[str, str]]) -> str:
    data = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        '@id': f'{DOMAIN}{canonical_path}#breadcrumb',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': i + 1,
                'name': name,
                'item': f'{DOMAIN}{path}',
            }
            for i, (name, path) in enumerate(crumbs)
        ],
    }
    return (
        '<script type="application/ld+json" data-breadcrumb-auto>'
        + _jsonld.dumps(data, ensure_ascii=False, separators=(',', ':'))
        + '</script>'
    )


def inject_jsonld_block(path: Path, block: str, auto_re: re.Pattern[str]) -> bool:
    src = path.read_text(encoding='utf-8')
    if block in src:
        return False
    cleaned = auto_re.sub('\n', src)
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


def inject_listing_schema(path: Path, canonical_path: str, name: str, articles: list[dict[str, str]]) -> bool:
    block = listing_schema(canonical_path, name, articles)
    return inject_jsonld_block(path, block, LISTING_SCHEMA_RE)


def inject_breadcrumb_schema(path: Path, canonical_path: str, crumbs: list[tuple[str, str]]) -> bool:
    block = breadcrumb_schema(canonical_path, crumbs)
    return inject_jsonld_block(path, block, BREADCRUMB_SCHEMA_RE)


def main() -> int:
    changed = []
    catalog = read_catalog()
    validate_fallback_snippets(catalog)
    for rel, desc in STATIC_SNIPPETS.items():
        path = ROOT / rel
        if path.exists() and normalize_file(path, desc, is_article=False):
            changed.append(rel)

    listing_targets = [
        (
            'blog/index.html',
            '/blog',
            'Published ophthalmology articles',
            [('首頁', '/'), ('眼科文章', '/blog')],
        ),
        (
            'blog/topics.html',
            '/blog/topics',
            'Ophthalmology topic article list',
            [('首頁', '/'), ('眼科文章', '/blog'), ('主題地圖', '/blog/topics')],
        ),
    ]
    for rel, canonical_path, name, crumbs in listing_targets:
        path = ROOT / rel
        if path.exists() and inject_listing_schema(path, canonical_path, name, catalog):
            changed.append(rel)
        if path.exists() and inject_breadcrumb_schema(path, canonical_path, crumbs):
            if rel not in changed:
                changed.append(rel)
        if path.exists() and normalize_listing_page_structured_data(path, canonical_path):
            if rel not in changed:
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
