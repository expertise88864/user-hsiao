"""Generate the bilingual article filter without rewriting article cards."""
from collections import Counter
from html import escape
from pathlib import Path
import re

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
START = '<!-- hs-static-filter:start -->'
END = '<!-- hs-static-filter:end -->'
BLOCK = re.compile(re.escape(START) + r'[\s\S]*?' + re.escape(END))
PLACEHOLDER = '<div id="hs-blog-filter" class="hs-blog-filter" hidden></div>'
CATEGORIES = {
    'myth': ('迷思澄清', 'Myth-busting'),
    'alert': ('警訊辨識', 'Red Flags'),
    'rx': ('衛教', 'Patient Ed'),
    'notes': ('學習筆記', 'Study Notes'),
    'research': ('最新研究', 'Latest Research'),
}


def label(zh, en):
    return (f'<span data-zh="{escape(zh, quote=True)}" '
            f'data-en="{escape(en, quote=True)}">{escape(zh)}</span>')


def render(source, css):
    """Replace only the reserved helper block; fail on ambiguous ownership."""
    if source.count(START) != source.count(END) or source.count(START) > 1:
        raise ValueError('Ambiguous static filter markers')
    blocks = BLOCK.findall(source)
    if len(blocks) != source.count(START):
        raise ValueError('Misordered static filter markers')
    if blocks:
        prior = BeautifulSoup(blocks[0], 'html.parser')
        if len(prior.select('#hs-blog-filter')) != 1 or prior.select('.article-list-item'):
            raise ValueError('Static filter markers must not own article cards')
    source = BLOCK.sub(PLACEHOLDER, source)
    if source.count(PLACEHOLDER) != 1:
        raise ValueError('Missing or duplicate article filter placeholder')
    doc = BeautifulSoup(source, 'html.parser')
    if len(doc.select('#hs-blog-filter')) != 1:
        raise ValueError('Duplicate article filter ID')
    items = doc.select('.article-list-item')
    if len(items) < 4:
        return source
    cats, tags, translations = Counter(), Counter(), {}
    for item in items:
        cat_chip = item.select_one('[class*="cat-"]')
        cat = next((c[4:] for c in cat_chip.get('class', [])
                    if c.startswith('cat-')), '') if cat_chip else ''
        if cat not in CATEGORIES:
            raise ValueError(f'Unknown article category: {cat!r}')
        cats[cat] += 1
        chip = next((c for c in item.select('.chip')
                     if not any(k.startswith('cat-') for k in c.get('class', []))), None)
        if chip is not None:
            zh, en = chip.get('data-zh', ''), chip.get('data-en', '')
            if not zh.strip() or not en.strip():
                raise ValueError('Tag requires both language labels')
            # Existing cards use both "Myopia" and "Pediatric myopia" for
            # 兒童近視. Group by the canonical Chinese tag and display the
            # first card's English label; leave all authored cards untouched.
            translations.setdefault(zh, en)
            tags[zh] += 1

    def button(kind, value, names, count, active=False):
        return (f'<button type="button" class="chip-btn{" active" if active else ""}" '
                f'data-{kind}="{escape(value, quote=True)}" '
                f'aria-pressed="{"true" if active else "false"}" disabled>'
                + label(*names) + f'<span class="count">{count}</span></button>')

    controls = ['<div class="row">',
                '<span class="label" data-zh="分類" data-en="Category">分類</span>',
                button('cat', '', ('全部', 'All'), len(items), True)]
    controls.extend(button('cat', cat, CATEGORIES[cat], count)
                    for cat, count in cats.items())
    controls.append('<button type="button" class="reset" data-zh="清除篩選" '
                    'data-en="Reset" disabled>清除篩選</button></div>')
    if tags:
        controls.append('<div class="row"><span class="label" data-zh="標籤" '
                        'data-en="Tags">標籤</span>')
        controls.extend(button('tag', tag, (tag, translations[tag]), tags[tag])
                        for tag in sorted(tags, key=lambda t: -tags[t]))
        controls.append('</div>')
    controls.append('<div class="row"><label class="label" for="hs-blog-search" '
                    'data-zh="搜尋" data-en="Search">搜尋</label>'
                    '<input id="hs-blog-search" type="search" placeholder="輸入關鍵字…" '
                    'data-zh-placeholder="輸入關鍵字…" data-en-placeholder="Type to search…" '
                    'autocomplete="off" disabled></div>')
    if '</style' in css.lower():
        raise ValueError('Invalid filter stylesheet')
    block = (START + '\n<style id="hs-blog-filter-css">' + css.strip() + '</style>\n'
             '<noscript><style>#hs-blog-filter{display:none}</style></noscript>\n'
             '<div id="hs-blog-filter" class="hs-blog-filter" data-static-filter="1">'
             + ''.join(controls) + '</div>\n' + END)
    return source.replace(PLACEHOLDER, block)


def main():
    path = ROOT / 'blog/index.html'
    source = path.read_text(encoding='utf8')
    result = render(source, (ROOT / 'assets/blog-filter.css').read_text(encoding='utf8'))
    if result != source:
        path.write_text(result, encoding='utf8')
    print('Bilingual blog filter generated; article cards preserved')


if __name__ == '__main__':
    main()
