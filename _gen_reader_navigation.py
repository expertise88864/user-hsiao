"""Render article contents/reading information before paint, preserving authored HTML bytes.

The runtime already skips an existing hs-inline-toc. Its reserved helper ID is
also stripped by both CMS serializers; the normal generation chain rebuilds
the contents from the saved headings. Reading metadata follows the same reserved
helper/strip/rebuild contract. English mirrors consume both results.
"""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import quote

from bs4 import BeautifulSoup
from _article_reading_meta import catalog_metadata, render_reading_meta

ROOT = Path(__file__).resolve().parent
START = '<!-- hs-static-toc:start -->'
END = '<!-- hs-static-toc:end -->'
BLOCK = re.compile(re.escape(START) + r'[\s\S]*?' + re.escape(END))
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}


class ArticlePosition(HTMLParser):
    """Locate insertion points without serializing the author's document."""
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0] + [m.end() for m in re.finditer('\n', source)]
        self.stack = []
        self.article = None
        self.heading_end = None
        self.article_closed = False

    def absolute_position(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag == 'article' and self.article is None:
            self.article = self.absolute_position() + len(self.get_starttag_text())
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'h1' and 'article' in self.stack and self.heading_end is None:
            self.heading_end = self.source.find('>', self.absolute_position()) + 1
        if tag == 'article' and self.article is not None:
            self.article_closed = True
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i] == tag:
                del self.stack[i:]
                break


class HeadingText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, value):
        self.parts.append(value)


def plain(value):
    # HTMLParser's character-reference conversion preserves unknown literal
    # ampersands (e.g. trailing Q&A), while still decoding encoded rich text.
    parser = HeadingText()
    parser.feed(value or '')
    parser.close()
    return ''.join(parser.parts).strip()


def toc_markup(headings):
    def links(lang):
        rows = []
        for index, item in enumerate((h[lang] for h in headings if h[lang]), 1):
            target, label = item
            rows.append(
                '<li style="counter-increment:toc;position:relative;padding:5px 4px 5px 32px">'
                '<span style="position:absolute;left:0;top:5px;width:24px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:var(--blue-deep);background:#fff;border:1px solid #b8cfe3;border-radius:6px">'
                f'{index}</span><a href="#{quote(target, safe="-._~")}" '
                'style="display:block;color:var(--ink-2);text-decoration:none;font-size:13.5px;line-height:1.6;font-weight:500">'
                f'{escape(label)}</a></li>')
        return ''.join(rows)

    zh, en = links('zh'), links('en')
    return (
        START + '\n<details id="hs-inline-toc" open '
        'style="margin:18px 0 24px;background:linear-gradient(135deg,#f3f7fb 0%,#e6eef6 100%);border:1px solid #b8cfe3;border-radius:14px;padding:0;overflow:hidden">'
        '<summary style="cursor:pointer;list-style:none;padding:14px 18px;font-size:13px;font-weight:700;color:var(--blue-deep);display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none">'
        '<span style="display:inline-flex;align-items:center;gap:8px">'
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>'
        '<line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
        '<span data-zh="本篇大綱" data-en="In this article">本篇大綱</span>'
        f'<span style="font-size:11px;font-weight:600;color:var(--ink-2);opacity:.7" data-zh="· {len(headings)} 段" data-en="· {sum(bool(h["en"]) for h in headings)} sections">· {len(headings)} 段</span></span>'
        '<span style="font-size:11px;color:var(--ink-2);opacity:.7" data-zh="點擊收合" data-en="Click to collapse">點擊收合</span></summary>'
        '<ol style="list-style:none;counter-reset:toc;padding:4px 18px 14px;margin:0;display:flex;flex-direction:column;gap:2px" '
        f'data-zh="{escape(zh, quote=True)}" data-en="{escape(en, quote=True)}">{zh}</ol>'
        '</details>\n' + END)


def render_navigation(source):
    # A CMS save can strip the helper while leaving its marker comments.
    source = BLOCK.sub('', source)
    if START in source or END in source:
        raise ValueError('Incomplete generated contents markers')
    soup = BeautifulSoup(source, 'html.parser')
    if soup.find(id='hs-inline-toc'):
        raise ValueError('Reserved contents helper exists outside generated markers')
    article = soup.find('article')
    prose = soup.find(id='proseZh') or (article.select_one('.prose') if article else None)
    if not article or not prose:
        return source
    headings = []
    prose_en = soup.find(id='proseEn')
    for heading in prose.select('h2[id]'):
        target = heading['id']
        if len(soup.find_all(id=target)) != 1:
            raise ValueError(f'Ambiguous contents target: {target}')
        zh = plain(heading.get('data-zh')) or heading.get_text().strip()
        counterpart = prose_en.find(id=target + '-en') if prose_en else None
        en = (counterpart.get_text().strip() if counterpart else
              plain(heading.get('data-en'))) or zh
        en_id = counterpart['id'] if counterpart else target
        # Separate English prose can omit a Chinese-only section. Do not
        # promise a jump to a heading hidden in the other language's body.
        english = None if prose_en and counterpart is None else (en_id, en)
        if counterpart and len(soup.find_all(id=en_id)) != 1:
            raise ValueError(f'Ambiguous contents target: {en_id}')
        headings.append({'zh': (target, zh), 'en': english})
    if len(headings) < 3:
        return source
    position = ArticlePosition(source)
    position.feed(source)
    position.close()
    if position.article is None or not position.article_closed:
        raise ValueError('Contents requires a complete article')
    offset = position.heading_end or position.article
    return source[:offset] + toc_markup(headings) + source[offset:]


def main():
    changed = 0
    catalog = catalog_metadata((ROOT / 'blog/blog-shared.js').read_text(encoding='utf8'))
    for path in sorted((ROOT / 'blog').glob('*.html')):
        original = path.read_bytes()
        try:
            navigation = render_navigation(original.decode('utf-8'))
            result = render_reading_meta(navigation, catalog.get(path.stem)).encode('utf-8')
        except ValueError as error:
            raise ValueError(f'{path.name}: {error}') from error
        if result != original:
            path.write_bytes(result)
            changed += 1
    print(f'Static contents/reading information pages updated: {changed}')


if __name__ == '__main__':
    main()
