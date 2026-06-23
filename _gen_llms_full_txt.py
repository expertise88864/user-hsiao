"""
HsiaoEye — generate /llms-full.txt: the full-text companion to /llms.txt.

Where llms.txt is a compact map (titles + summaries + feed links),
llms-full.txt inlines the actual article prose so an AI answer engine can
ingest the whole site in a single fetch without crawling each page. Format
follows the llms.txt convention (Markdown-shaped, H1 site title, then one
section per article with a fenced lead and the cleaned body text).

Budget: hard cap at ~480 KB. Articles are emitted newest-first; if the cap
is reached the remaining articles are listed as links only and a note
records how many were truncated (no silent cap).
"""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from pathlib import Path

from _gen_llms_txt import parse_articles, meta_content, title_text, clean_title

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
SIZE_BUDGET = 480 * 1024  # bytes (UTF-8), keeps the finished file < 500 KB
TAIL_RESERVE = 8 * 1024   # headroom for the overflow-links tail, so the
                          # completed file never exceeds SIZE_BUDGET

# Block-level tags whose boundaries we turn into newlines for readability.
_BLOCK = {
    'p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'table', 'tr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'blockquote', 'figure',
    'figcaption', 'header', 'footer', 'nav',
}
# Tags whose entire subtree we discard (non-prose / chrome / scripts).
_SKIP_TREE = {'script', 'style', 'svg', 'noscript', 'template', 'select', 'button', 'form'}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TREE:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag in _BLOCK:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in _SKIP_TREE and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag in _BLOCK:
            self.parts.append('\n')

    def handle_data(self, data):
        if self._skip_depth:
            return
        if data and data.strip():
            self.parts.append(data)

    def text(self) -> str:
        raw = ''.join(self.parts)
        raw = html.unescape(raw)
        # Collapse intra-line whitespace, keep paragraph breaks.
        lines = [re.sub(r'[ \t]+', ' ', ln).strip() for ln in raw.splitlines()]
        out: list[str] = []
        blank = False
        for ln in lines:
            if ln:
                out.append(ln)
                blank = False
            elif not blank:
                out.append('')
                blank = True
        return '\n'.join(out).strip()


def article_body(path: Path) -> str:
    """Cleaned visible text of an article's <article> region (zh-default)."""
    src = path.read_text(encoding='utf-8')
    m = re.search(r'<article\b[^>]*>([\s\S]*?)</article>', src, re.I)
    region = m.group(1) if m else src
    # Drop the auto-generated "Related reads" block — it duplicates other
    # articles' titles and is navigation chrome, not this article's prose.
    region = re.sub(
        r'<!--\s*hs-static-related:start\s*-->[\s\S]*?<!--\s*hs-static-related:end\s*-->',
        '', region, flags=re.I)
    parser = _TextExtractor()
    parser.feed(region)
    parser.close()
    return parser.text()


def build() -> str:
    articles = parse_articles()
    latest = max((a['updated'] for a in articles), default='2026-01-01')

    head = [
        '# HsiaoEye — Full Text',
        '',
        '> Full-text export of the bilingual ophthalmology patient-education notes '
        'by Min-Chien Hsiao, MD (蕭閔謙醫師), Taiwan. Companion to /llms.txt.',
        '',
        'Traditional-Chinese article bodies are inlined below (newest first) so an '
        'AI assistant can ingest the site in one fetch. Educational only; not a '
        'substitute for an in-person ophthalmology visit. English mirrors live at '
        '/en/blog/{slug}.',
        '',
        f'Last content update: {latest}',
        f'Canonical host: {DOMAIN}',
        f'Compact map: {DOMAIN}/llms.txt',
        '',
        '---',
        '',
    ]

    body: list[dict[str, str]] = []   # {block, title, slug}
    overflow: list[dict[str, str]] = []
    used = len('\n'.join(head).encode('utf-8'))

    for a in articles:
        path = ROOT / 'blog' / f'{a["slug"]}.html'
        if not path.exists():
            continue
        title = clean_title(title_text(path)) or a['title']
        desc = re.sub(r'\s+', ' ', meta_content(path, 'description')).strip()
        text = article_body(path)
        block = '\n'.join([
            f'## {title}',
            '',
            f'- Canonical: {DOMAIN}/blog/{a["slug"]}',
            (f'- English mirror: {DOMAIN}/en/blog/{a["slug"]}'
             if a['has_en'] else '- English mirror: translation in progress'),
            f'- Topic: {a["tag"] or a["tag_en"] or "Ophthalmology"}'
            f' · Published {a["date"]} · Updated {a["updated"]}',
            '',
            f'> {desc}',
            '',
            text,
            '',
            '---',
            '',
        ])
        cost = len(block.encode('utf-8'))
        if used + cost > SIZE_BUDGET - TAIL_RESERVE:
            overflow.append({'title': title, 'slug': a['slug']})
            continue
        body.append({'block': block, 'title': title, 'slug': a['slug']})
        used += cost

    def build_tail(of: list[dict[str, str]]) -> list[str]:
        if not of:
            return []
        t = ['## Additional Articles (links only — size budget reached)', '']
        t += [f'- [{o["title"]}]({DOMAIN}/blog/{o["slug"]})' for o in of]
        t += ['', f'Note: {len(of)} article(s) listed as links to keep '
              'llms-full.txt under the size budget. Fetch the compact map at '
              f'{DOMAIN}/llms.txt or the canonical URLs above for full text.', '']
        return t

    def assemble() -> str:
        return '\n'.join(head + [b['block'] for b in body] + build_tail(overflow))

    # Hard invariant: the finished file never exceeds SIZE_BUDGET. The body
    # selection already reserves TAIL_RESERVE, but if the links-only tail ever
    # grows past that (only possible with an extreme article count) demote the
    # last full-text article to a link and re-assemble until it fits.
    content = assemble()
    while body and len(content.encode('utf-8')) > SIZE_BUDGET:
        demoted = body.pop()
        overflow.insert(0, {'title': demoted['title'], 'slug': demoted['slug']})
        content = assemble()
    # Unconditional backstop: if even the links-only tail were to exceed the
    # budget (only reachable at an absurd article count), hard-cap the bytes at
    # a safe UTF-8 boundary so len(content.encode()) <= SIZE_BUDGET always holds.
    encoded = content.encode('utf-8')
    if len(encoded) > SIZE_BUDGET:
        content = encoded[:SIZE_BUDGET].decode('utf-8', 'ignore')
    return content


def main() -> int:
    out = ROOT / 'llms-full.txt'
    content = build()
    out.write_text(content, encoding='utf-8')
    kb = len(content.encode('utf-8')) / 1024
    print(f'Wrote {out.relative_to(ROOT)} ({kb:.1f} KB)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
