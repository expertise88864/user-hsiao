"""Generate existing reader information before paint; never rewrite authored HTML.

The reserved helper is still stripped by both CMS serializers and rebuilt from
the current catalog/body on generation. Keep the runtime fallback for drafts.
"""
from html import escape
from html.parser import HTMLParser
import math
import re

from bs4 import BeautifulSoup, Comment, NavigableString

import _articles_field
from _gen_en_pages import _swap_inner_to_english

START = '<!-- hs-static-reading-meta:start -->'
END = '<!-- hs-static-reading-meta:end -->'
BLOCK = re.compile(re.escape(START) + r'[\s\S]*?' + re.escape(END))
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}


def catalog_metadata(js):
    assignment = re.search(r'\bDN\.ARTICLES\s*=\s*\[', js)
    if not assignment:
        raise ValueError('DN.ARTICLES not found')
    # Quoted strings/comments cannot terminate the catalog (e.g. title " ]; ").
    closing = next((token.start() for token in _articles_field._TOKENS.finditer(js, assignment.end())
                    if token.group() == ']'), None)
    if closing is None:
        raise ValueError('Incomplete DN.ARTICLES')
    rows = {}
    for record in _articles_field.RECORD_RE.finditer(js[assignment.end():closing]):
        body = record.group(1)
        slug = _articles_field.field('slug', body)
        if not re.fullmatch(r'[a-z0-9-]+', slug) or slug in rows:
            raise ValueError('Invalid or duplicate catalog slug')
        row = {key: _articles_field.field(key, body) for key in ('date', 'updated')}
        tokens = [m.group() for m in _articles_field._TOKENS.finditer(body)
                  if not m.group().startswith(('//', '/*'))]
        for i, token in enumerate(tokens[:-2]):
            if token != 'minutes' or tokens[i + 1] != ':':
                continue
            end = next((j for j in range(i + 2, len(tokens)) if tokens[j] == ','), len(tokens))
            literal = ''.join(tokens[i + 2:end])
            if re.fullmatch(r'-?\d+(?:\.\d+)?', literal):
                value = float(literal)
                if math.isfinite(value) and value > 0:
                    row['minutes'] = value
        rows[slug] = row
    if not rows:
        raise ValueError('Empty DN.ARTICLES')
    return rows


class HeroPosition(HTMLParser):
    """Locate the same H1/first sibling paragraph as the runtime, byte-preserving."""
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0] + [m.end() for m in re.finditer('\n', source)]
        self.stack = []
        self.nodes = []
        self.heading = None

    def absolute(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'parent': self.stack[-1] if self.stack else None, 'end': None}
        self.nodes.append(node)
        if tag == 'h1' and self.heading is None and any(n['tag'] in {'section', 'article'} for n in self.stack):
            self.heading = node
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]['tag'] == tag:
                self.stack[i]['end'] = self.source.index('>', self.absolute()) + 1
                del self.stack[i:]
                break

    def insertion_point(self):
        if self.heading is None:
            return None
        lead = next((n for n in self.nodes if n['tag'] == 'p' and n['parent'] is self.heading['parent']), None)
        target = lead or self.heading
        if target['end'] is None:
            raise ValueError('Incomplete reading information insertion target')
        return target['end']


def reading_minutes(prose):
    # Match the existing runtime fallback's textContent/whitespace/count/round
    # semantics; scripts/styles are text nodes, comments are not. Not a clinical
    # recommendation or a promise of the time an individual needs to read.
    text = ''.join(str(n) for n in prose.descendants
                   if isinstance(n, NavigableString) and not isinstance(n, Comment))
    text = re.sub(r'\s+', '', text)
    cjk = len(re.findall(r'[一-鿿]', text))
    words = len(re.findall(r'[A-Za-z0-9]+', text))
    return max(2, math.floor(cjk / 350 + words / 200 + .5))


def prose_node(soup, language='zh'):
    if language == 'en':
        english = soup.find(id='proseEn')
        if english is not None:
            return english
    return soup.find(id='proseZh') or soup.select_one('article .prose')


def markup(minutes_zh, minutes_en, updated):
    def pill(label_zh, label_en, style, svg):
        return ('<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;'
                + style + '">' + svg +
                f'<span data-zh="{escape(label_zh, quote=True)}" data-en="{escape(label_en, quote=True)}">{escape(label_zh)}</span></span>')
    clock = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    calendar = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
    bar = pill(f'閱讀約 {minutes_zh:g} 分鐘', f'{minutes_en:g} min read',
               'background:var(--blue-soft);border:1px solid #b8cfe3;color:var(--blue-deep);font-weight:600', clock)
    if updated:
        bar += pill('最後更新 ' + updated, 'Last updated · ' + updated,
                    'background:#dcfce7;border:1px solid #86efac;color:#14532d;font-weight:600', calendar)
    bar += '<a href="/about" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;background:#fff;border:1px solid var(--border);color:var(--blue-deep);text-decoration:none;font-weight:600" data-zh="蕭閔謙 醫師 →" data-en="Dr. Hsiao →">蕭閔謙 醫師 →</a>'
    return START + '<div id="hs-reading-meta" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 8px;font-size:12.5px;color:var(--ink-2);">' + bar + '</div>' + END


def render_reading_meta(source, metadata):
    source = BLOCK.sub('', source)
    if START in source or END in source:
        raise ValueError('Incomplete generated reading information markers')
    soup = BeautifulSoup(source, 'html.parser')
    if soup.find(id='hs-reading-meta'):
        raise ValueError('Reserved reading helper exists outside generated markers')
    robots = soup.find('meta', attrs={'name': 'robots'})
    prose = prose_node(soup)
    if metadata is None or prose is None or robots and 'noindex' in (robots.get('content') or '').lower():
        return source
    locator = HeroPosition(source)
    locator.feed(source)
    locator.close()
    offset = locator.insertion_point()
    if offset is None:
        return source
    value = metadata.get('minutes')
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
        minutes_zh = minutes_en = value
    else:
        minutes_zh = reading_minutes(prose)
        english = prose_node(BeautifulSoup(_swap_inner_to_english(source), 'html.parser'), 'en')
        minutes_en = reading_minutes(english) if english is not None else minutes_zh
    bar = markup(minutes_zh, minutes_en, metadata.get('updated') or metadata.get('date') or '')
    return source[:offset] + bar + source[offset:]
