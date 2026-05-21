"""
Generate WebSite hasPart graph entries for the bilingual homepages.

Search engines can crawl links, but structured hasPart entries make the
site's primary entry points explicit: article index, topic map, tools, notes,
about, and privacy. The generator runs after /en/ mirroring so both locale
homepages carry language-appropriate names and URLs.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'

ZH_PARTS = [
    ('CollectionPage', '/blog', '眼科文章', 'HsiaoEye 眼科衛教文章索引，收錄乾眼、近視、白內障、青光眼與視網膜警訊'),
    ('CollectionPage', '/blog/topics', '主題地圖', '依疾病、症狀與手術主題瀏覽 HsiaoEye 眼科衛教文章'),
    ('WebApplication', '/tools', '眼科工具', 'OSDI、DEQ-5、視力換算、等效球面與飛蚊警訊工具'),
    ('CollectionPage', '/notes', '學習筆記', '眼科住院醫師整理的深入閱讀筆記、臨床決策與文獻摘要'),
    ('ProfilePage', '/about', '關於蕭閔謙醫師', 'HsiaoEye 作者與醫療內容審閱者蕭閔謙醫師的個人簡介'),
    ('WebPage', '/privacy', '隱私權政策', 'HsiaoEye 對資料使用、分析工具、第三方服務與隱私保護的說明'),
]

EN_PARTS = [
    ('CollectionPage', '/en/blog', 'Ophthalmology Articles', 'Bilingual ophthalmology patient-education article index'),
    ('CollectionPage', '/en/blog/topics', 'Topic Map', 'Browse articles by ophthalmology topic'),
    ('WebApplication', '/en/tools', 'Ophthalmology Tools', 'OSDI, DEQ-5, vision conversion, spherical equivalent, and floater red-flag tools'),
    ('CollectionPage', '/en/notes', 'Study Notes', 'Ophthalmology study notes for clinicians and learners'),
    ('ProfilePage', '/en/about', 'About Dr. Min-Chien Hsiao', 'Author and medical reviewer profile'),
    ('WebPage', '/en/privacy', 'Privacy Policy', 'Privacy, analytics, and data-use policy'),
]


def type_names(obj: dict) -> set[str]:
    value = obj.get('@type')
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def has_part(parts: list[tuple[str, str, str, str]], lang: str) -> list[dict[str, object]]:
    return [
        {
            '@type': schema_type,
            '@id': f'{DOMAIN}{path}#webpage',
            'url': f'{DOMAIN}{path}',
            'name': name,
            'description': desc,
            'inLanguage': lang,
            'isAccessibleForFree': True,
        }
        for schema_type, path, name, desc in parts
    ]


def normalize_homepage(path: Path, expected_id: str, lang: str, parts: list[tuple[str, str, str, str]]) -> bool:
    src = path.read_text(encoding='utf-8')
    changed = False

    def repl(match: re.Match[str]) -> str:
        nonlocal changed
        prefix = match.group(1)
        raw = match.group(2).strip()
        try:
            data = json.loads(raw)
        except Exception:
            return match.group(0)
        if not isinstance(data, dict) or 'WebSite' not in type_names(data) or data.get('@id') != expected_id:
            return match.group(0)

        old = json.dumps(data, ensure_ascii=False, sort_keys=True)
        data['hasPart'] = has_part(parts, lang)
        if json.dumps(data, ensure_ascii=False, sort_keys=True) == old:
            return match.group(0)
        changed = True
        return prefix + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '</script>'

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
    targets = [
        (ROOT / 'index.html', f'{DOMAIN}/#website', 'zh-Hant-TW', ZH_PARTS),
        (ROOT / 'en' / 'index.html', f'{DOMAIN}/en#website', 'en', EN_PARTS),
    ]
    for path, expected_id, lang, parts in targets:
        if path.exists() and normalize_homepage(path, expected_id, lang, parts):
            changed.append(path.relative_to(ROOT).as_posix())

    print(f'Generated WebSite hasPart graph in {len(changed)} file(s)')
    for rel in changed:
        print(f'  - {rel}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
