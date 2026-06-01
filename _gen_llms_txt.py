"""
HsiaoEye — generate /llms.txt from the public article catalog.

llms.txt is a plain-text, Markdown-shaped site guide. It is intentionally
small, stable, and citation-friendly: useful for AI answer engines, human
reviewers, and any crawler that wants a concise map before fetching pages.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'


def parse_articles() -> list[dict[str, str]]:
    js = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    if not m:
        raise SystemExit('DN.ARTICLES not found')
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
    en_stub_m = re.search(r'DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    en_stubs = set(re.findall(r"'([^']+)'", en_stub_m.group(1))) if en_stub_m else set()

    def field(body: str, key: str) -> str:
        mm = re.search(rf"{key}\s*:\s*'([^']*)'", body)
        return mm.group(1) if mm else ''

    out = []
    for obj in re.finditer(r'\{([\s\S]*?)\}', m.group(1)):
        body = obj.group(1)
        slug = field(body, 'slug')
        if not slug or slug in stubs:
            continue
        out.append({
            'slug': slug,
            'title': field(body, 'title'),
            'title_en': field(body, 'title_en'),
            'tag': field(body, 'tag'),
            'tag_en': field(body, 'tag_en'),
            'date': field(body, 'date'),
            'updated': field(body, 'updated') or field(body, 'date'),
            'cat': field(body, 'cat'),
            'has_en': slug not in en_stubs,
        })
    out.sort(key=lambda a: (a['updated'], a['date'], a['slug']), reverse=True)
    return out


def meta_content(path: Path, key: str, attr: str = 'name') -> str:
    src = path.read_text(encoding='utf-8')
    m = re.search(rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else ''


def title_text(path: Path) -> str:
    src = path.read_text(encoding='utf-8')
    m = re.search(r'<title>([^<]+)</title>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else ''


def clean_title(value: str) -> str:
    value = re.sub(r'\s*\|\s*HsiaoEye.*$', '', value or '')
    return value.strip()


def first_article_tag(path: Path) -> str:
    if not path.exists():
        return ''
    src = path.read_text(encoding='utf-8')
    m = re.search(r'<meta\s+property="article:tag"\s+content="([^"]+)"\s*/?>', src, re.I)
    return html.unescape(m.group(1)).strip() if m else ''


def one_line(value: str) -> str:
    return re.sub(r'\s+', ' ', value or '').strip()


def build() -> str:
    articles = parse_articles()
    latest = max((a['updated'] for a in articles), default='2026-01-01')

    lines = [
        '# HsiaoEye',
        '',
        '> Bilingual ophthalmology patient-education notes by Min-Chien Hsiao, MD (蕭閔謙醫師), Taiwan.',
        '',
        'This site explains eye symptoms, common ophthalmology conditions, surgery choices, and study notes in Traditional Chinese with English mirrors. It is educational only and does not replace an in-person ophthalmology visit.',
        '',
        f'Last content update: {latest}',
        f'Canonical host: {DOMAIN}',
        'Primary language: zh-Hant-TW',
        'Secondary language: en',
        '',
        '## Recommended Entry Points',
        '',
        f'- [Home]({DOMAIN}/): {meta_content(ROOT / "index.html", "description")}',
        f'- [Article Index]({DOMAIN}/blog): {meta_content(ROOT / "blog" / "index.html", "description")}',
        f'- [Topic Map]({DOMAIN}/blog/topics): {meta_content(ROOT / "blog" / "topics.html", "description")}',
        f'- [Tools]({DOMAIN}/tools): {meta_content(ROOT / "tools.html", "description")}',
        f'- [About the Author]({DOMAIN}/about): {meta_content(ROOT / "about.html", "description")}',
        '',
        '## Machine-Readable Feeds',
        '',
        f'- [Sitemap XML]({DOMAIN}/sitemap.xml): canonical URLs, hreflang alternates, and image metadata.',
        f'- [RSS Feed]({DOMAIN}/blog/feed.xml): latest Traditional Chinese articles with summaries and OG images.',
        f'- [Atom Feed]({DOMAIN}/blog/atom.xml): latest articles with stable updated dates and English alternates.',
        f'- [JSON Feed]({DOMAIN}/blog/feed.json): latest articles with summaries, images, attachments, and English mirror URLs.',
        f'- [OpenSearch Description]({DOMAIN}/opensearch.xml): site search template for `/blog?q={{searchTerms}}`.',
        f'- [Bilingual Search Index]({DOMAIN}/assets/search-index.json): published article metadata in both locales.',
        '',
        '## Published Articles',
        '',
    ]

    for a in articles:
        path = ROOT / 'blog' / f'{a["slug"]}.html'
        en_path = ROOT / 'en' / 'blog' / f'{a["slug"]}.html'
        desc = one_line(meta_content(path, 'description')) if path.exists() else ''
        title = clean_title(title_text(path)) or a['title']
        title_en = clean_title(title_text(en_path)) or a['title_en'] or title
        tag = first_article_tag(path) or a['tag'] or a['tag_en'] or 'Ophthalmology'
        lines.extend([
            f'### {title}',
            '',
            f'- English title: {title_en}',
            f'- Topic: {tag}',
            f'- Published: {a["date"]}',
            f'- Updated: {a["updated"]}',
            f'- Canonical: {DOMAIN}/blog/{a["slug"]}',
            f'- English mirror: {DOMAIN}/en/blog/{a["slug"]}' if a['has_en'] else '- English mirror: translation in progress',
            f'- Summary: {desc}',
            '',
        ])

    lines.extend([
        '## Citation Guidance',
        '',
        '- Prefer canonical article URLs under `/blog/{slug}` for Traditional Chinese citations.',
        '- Use `/en/blog/{slug}` URLs only when an English mirror URL is listed for that article.',
        '- Do not cite private editing URLs, API endpoints, generated test artifacts, or unfinished stub article pages.',
        '- Medical disclaimer: all content is general education, not individualized medical advice.',
        '',
    ])
    return '\n'.join(lines)


def main() -> int:
    out = ROOT / 'llms.txt'
    out.write_text(build(), encoding='utf-8')
    print(f'Wrote {out.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
