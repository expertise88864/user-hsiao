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

ARTICLE_SNIPPETS = {
    'cataract-comprehensive-guide':
        '白內障什麼時候該開刀？人工水晶體怎麼選？整合 AAO、AAPPO、ESCRS 指引，整理視力以外的手術時機、單焦/散光/EDOF/多焦 IOL 取捨、飛秒雷射與術後恢復。',
    'cataract-surgery-selection':
        '白內障手術怎麼選才不被話術牽著走？比較超音波、飛秒雷射、MSICS、IOL 分類、Monovision、散光矯正、度數計算公式、健保與自費差異，整理台灣實務重點。',
    'dims-pediatric-myopia-control':
        'DIMS 近視控制鏡片有效嗎？整合 2026 AJO 統合分析、6 篇 RCT、1224 位兒童資料，解析 12 個月度數與眼軸控制效果、適合族群、限制與家長該追蹤的指標。',
    'dry-eye-myths':
        '點人工淚液會依賴？流淚就不是乾眼？葉黃素能治乾眼？整理 8 個常見乾眼迷思，說明 BAK 防腐劑、Omega-3 證據、瞼板腺熱敷、何時該就醫檢查。',
    'dry-eye-symptom-sign-discordance-dream':
        '乾眼症為什麼主觀很乾、檢查卻還好？DREAM 試驗 535 位中重度乾眼分析顯示 77% 症狀與徵象不一致，整理 4 型分佈、治療選擇與台灣健保給付。',
    'floaters-retinal-detachment':
        '飛蚊症會自己好嗎？突然增多、閃光或視野缺損何時是視網膜裂孔/剝離警訊？整理 6 個常見迷思、高度近視風險、72 小時內就醫重點與大型研究證據。',
    'glaucoma-comprehensive-guide':
        '青光眼早期常沒有症狀，何時要篩檢？整合 AAO、NICE、EGS 指引與台灣數據，整理開角/閉角/正常眼壓型分類、急性閉角紅旗、SLT、藥物、手術與居家照護。',
    'glaucoma-treatment-selection':
        '青光眼治療怎麼選？整理 SLT 雷射與藥物第一線、前列腺素類副作用、複方眼藥水、加藥/換藥邏輯、MIGS、傳統手術階梯、閉角型路徑與台灣健保現況。',
    'lacrimal-gland-tumor':
        '眼睛凸出、淚腺區疼痛或視力下降可能是淚腺腫瘤。整理 IJO 2024 meta-analysis、MD Anderson 質子治療與動脈內化療證據，回答診斷、治療、保眼與預後問題。',
    'monitoring-myopia-ser-vs-axial-length':
        '兒童近視追蹤該看度數還是眼軸？Clark & Wong 2026 AJO 統合分析 70 篇研究，說明 SER 與 AL 對視網膜、白內障、青光眼風險的預測力與臨床限制。',
    'pediatric-myopia-control':
        '兒童近視控制怎麼選？整理阿托品 0.01%/0.05%、OK 鏡、DIMS、多焦點離焦鏡片、紅光治療與戶外時間，引用 LAMP、ATOM、DIMS、RLRL 等研究回答家長常見問題。',
    'thyroid-eye-disease':
        "甲狀腺眼疾（TED）何時需要治療？整理 EUGOGO、ATA/ETA 與 2025 回顧，說明 active/inactive 分期、CAS 評分、嚴重度、類固醇/放療/手術階梯與視神經壓迫急症。",
    'toric-iol-astigmatism-cataract-review':
        '2026 ESCRS 整合性回顧：散光人工水晶體 Toric IOL 適應症、術前評估、計算公式、旋轉風險、特殊族群與台灣自費現況，整理白內障合併散光患者術前該問的問題。',
}

STATIC_SNIPPETS = {
    'index.html':
        'HsiaoEye 是蕭閔謙醫師的眼科衛教與學習筆記，整理乾眼症、兒童近視控制、白內障、青光眼、飛蚊症與常見眼科警訊，協助就醫前理解問題。',
    'about.html':
        '蕭閔謙醫師個人簡介與 HsiaoEye 站點說明，介紹眼科住院醫師背景、衛教寫作原則、內容審閱方式，以及本站如何提供非商業化的眼科知識。',
    'tools.html':
        'HsiaoEye 眼科自我評估工具，包含 OSDI、DEQ-5、Snellen/LogMAR 換算、等價球面度數與飛蚊症紅旗篩檢，協助整理症狀但不取代就醫。',
    'notes.html':
        'HsiaoEye 學習筆記整理眼科住院醫師的臨床閱讀、研究摘要與病人衛教延伸內容，提供醫學生、住院醫師與一般讀者更深入的眼科脈絡。',
    'privacy.html':
        'HsiaoEye 隱私權政策說明本站如何使用分析工具、Cookie、第三方服務與基本訪客資料，並說明醫療衛教內容與個人醫療建議的界線。',
    'blog/index.html':
        'HsiaoEye 眼科衛教文章索引，收錄乾眼症、兒童近視控制、白內障、青光眼、飛蚊症、甲狀腺眼疾與常見眼科急症警訊等主題。',
    'blog/topics.html':
        '依主題瀏覽 HsiaoEye 眼科文章，快速找到青光眼、白內障、乾眼症、兒童近視、視網膜、飛蚊症、甲狀腺眼疾與眼科工具內容。',
}


def read_published_slugs():
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('DN.ARTICLES not found')
    slugs = set(re.findall(r"slug:\s*'([^']+)'", m.group(1)))
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    return sorted(slugs - stubs)


def attr_escape(value: str) -> str:
    return html.escape(value, quote=True)


def meta_content(src: str, key: str, attr: str = 'name') -> str:
    m = re.search(rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)) if m else ''


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

    if out != src:
        path.write_text(out, encoding='utf-8')
        return True
    return False


def type_names(obj: dict) -> set[str]:
    value = obj.get('@type')
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def normalize_article_schema_image(path: Path, slug: str) -> bool:
    src = path.read_text(encoding='utf-8')
    expected = f'{DOMAIN}/assets/og/{slug}.png'
    expected_file = ROOT / 'assets' / 'og' / f'{slug}.png'
    if not expected_file.exists():
        return False

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
        if not (type_names(data) & {'Article', 'BlogPosting', 'MedicalScholarlyArticle'}):
            return match.group(0)
        if data.get('image') == expected:
            return match.group(0)
        data['image'] = expected
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


def main() -> int:
    changed = []
    for rel, desc in STATIC_SNIPPETS.items():
        path = ROOT / rel
        if path.exists() and normalize_file(path, desc, is_article=False):
            changed.append(rel)

    for slug in read_published_slugs():
        path = ROOT / 'blog' / f'{slug}.html'
        fallback = ARTICLE_SNIPPETS.get(slug)
        if not fallback:
            print(f'WARN: no curated snippet for {slug}')
            continue
        schema_changed = normalize_article_schema_image(path, slug)
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
