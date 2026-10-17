"""Generate the bilingual article filters without rewriting article cards.

- blog/index.html: the category/tag filter between the hs-static-filter markers.
- index.html: the homepage 「快速查找眼科主題」 hub between the hs-home-hub
  markers (owner 2026-10-17, modelled on chendermatologist.com #dn-hub): one
  search box with a live result count, 「全部主題」 + category chips and topic
  group cards, every count taken from the homepage article cards.
  DN.bindHomeHub (blog/blog-shared.js) wires it to #hs-article-list.
"""
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
        controls.append('<details class="hs-topic-disclosure"><summary>'
                        + label('按主題找文章', 'Browse by topic')
                        + f'<span class="count"> ({len(tags)})</span>'
                        '<span class="hs-topic-selected" data-zh="未選取主題" '
                        'data-en="No selected topic" hidden>未選取主題</span>'
                        '</summary><div class="row"><span class="label" data-zh="標籤" '
                        'data-en="Tags">標籤</span>')
        controls.extend(button('tag', tag, (tag, translations[tag]), tags[tag])
                        for tag in sorted(tags, key=lambda t: -tags[t]))
        controls.append('</div></details>')
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


HOME_START = '<!-- hs-home-hub:start -->'
HOME_END = '<!-- hs-home-hub:end -->'
HOME_BLOCK = re.compile(re.escape(HOME_START) + r'[\s\S]*?' + re.escape(HOME_END))
HOME_CAP = 5  # newest articles shown while nothing is searched (DN.HOME_CAP)
# Topic group cards: (zh, en, [(topic tag, display zh, display en), ...]).
# A card's topic is its first tag chip; tags not listed here land in 「其他主題」.
HOME_GROUPS = [
    ('青光眼', 'Glaucoma', [('青光眼', '青光眼', 'Glaucoma')]),
    ('白內障', 'Cataract', [('白內障', '白內障', 'Cataract')]),
    ('視網膜與黃斑部', 'Retina & macula', [
        ('飛蚊症', '飛蚊症／視網膜剝離', 'Floaters / retinal detachment'),
        ('黃斑部病變', '黃斑部病變', 'Macular degeneration'),
        ('糖尿病視網膜病變', '糖尿病視網膜病變', 'Diabetic retinopathy')]),
    ('角膜與乾眼', 'Cornea & dry eye', [
        ('乾眼症', '乾眼症', 'Dry eye'),
        ('角膜炎', '角膜炎', 'Keratitis'),
        ('翼狀贅肉', '翼狀贅肉', 'Pterygium')]),
    ('兒童眼科與近視', 'Children & myopia', [('兒童近視', '兒童近視', 'Childhood myopia')]),
    ('眼整形與眼眶', 'Oculoplastics & orbit', [
        ('甲狀腺眼疾', '甲狀腺眼疾', 'Thyroid eye disease'),
        ('淚腺腫瘤', '淚腺腫瘤', 'Lacrimal gland tumour')]),
    ('葡萄膜炎', 'Uveitis', [('葡萄膜炎', '葡萄膜炎', 'Uveitis')]),
    ('眼外傷', 'Eye injury', [('眼外傷', '眼外傷', 'Eye injury')]),
]


def home_cards(doc):
    """(category, first topic tag zh, en) of every homepage article card."""
    out = []
    for item in doc.select('#hs-article-list .article-list-item'):
        cat_chip = item.select_one('.chip[class*="cat-"]')
        cat = next((c[4:] for c in cat_chip.get('class', [])
                    if c.startswith('cat-')), '') if cat_chip else ''
        if cat not in CATEGORIES:
            raise ValueError(f'Unknown article category: {cat!r}')
        tag = item.select_one('.chip.tag')
        zh = tag.get('data-zh', '').strip() if tag else ''
        en = tag.get('data-en', '').strip() if tag else ''
        if tag is not None and (not zh or not en):
            raise ValueError('Tag requires both language labels')
        out.append((cat, zh, en))
    return out


def render_home_hub(source):
    """Fill the homepage hub block; every byte outside the markers is kept."""
    if (source.count(HOME_START) != 1 or source.count(HOME_END) != 1
            or len(HOME_BLOCK.findall(source)) != 1):
        raise ValueError('index.html needs exactly one hs-home-hub marker pair')
    cards = home_cards(BeautifulSoup(HOME_BLOCK.sub('', source), 'html.parser'))
    if len(cards) < 4:
        raise ValueError('The homepage hub needs the #hs-article-list article cards')
    total = len(cards)
    cats = Counter(cat for cat, _, _ in cards)
    topics = Counter(zh for _, zh, _ in cards if zh)
    english = {}
    for _, zh, en in cards:
        if zh:
            english.setdefault(zh, en)

    def chip(kind, value, names, count, extra='', pressed='false'):
        return (f'<button type="button" class="hub-chip{extra}" data-hub-{kind}="{escape(value, quote=True)}" '
                f'aria-pressed="{pressed}" disabled>{label(*names)}'
                f'<span class="hub-n" aria-hidden="true">{count}</span></button>')

    shown = min(HOME_CAP, total)
    status = (f'最新 {shown} 篇・共 {total} 篇文章', f'Latest {shown} of {total} articles')
    parts = [
        '<h2 id="hs-hub-title" class="hub-title" data-zh="快速查找眼科主題" data-en="Find articles by topic">快速查找眼科主題</h2>',
        '<form id="hs-hub-search" class="hub-search-row" action="/blog" method="get" role="search">',
        '<div class="hs-search-wrap"><svg class="dn-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" '
        'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>'
        '<input id="hs-search-input" name="q" type="search" class="hs-search-input" maxlength="120" '
        'autocomplete="off" placeholder="搜尋文章標題或關鍵字…" data-zh-placeholder="搜尋文章標題或關鍵字…" '
        'data-en-placeholder="Search article titles or keywords…" aria-label="搜尋文章" '
        'data-zh-aria-label="搜尋文章" data-en-aria-label="Search articles" aria-describedby="hs-hub-status" /></div>',
        f'<p id="hs-hub-status" class="hub-status" role="status" aria-live="polite" '
        f'data-zh="{status[0]}" data-en="{status[1]}">{status[0]}</p></form>',
        '<div class="hub-chips hub-primary">',
        chip('all', '', ('全部主題', 'All topics'), total, ' hub-all active', 'true'),
    ]
    parts.extend(chip('cat', cat, CATEGORIES[cat], cats[cat]) for cat in CATEGORIES if cats[cat])
    parts.append('</div><div class="hub-cards">')
    grouped = {tag for _, _, members in HOME_GROUPS for tag, _, _ in members}
    groups = [(gzh, gen, [m for m in members if topics[m[0]]]) for gzh, gen, members in HOME_GROUPS]
    other = [(zh, zh, english[zh]) for zh in sorted(topics, key=lambda z: (-topics[z], z)) if zh not in grouped]
    groups.append(('其他主題', 'Other topics', other))
    for index, (gzh, gen, members) in enumerate(g for g in groups if g[2]):
        hid = f'hs-hub-g{index + 1}'
        parts.append(f'<section class="hub-card" aria-labelledby="{hid}"><h3 id="{hid}" class="hub-card-title" '
                     f'data-zh="{escape(gzh, quote=True)}" data-en="{escape(gen, quote=True)}">{escape(gzh)}</h3>'
                     '<div class="hub-chips">')
        parts.extend(chip('topic', tag, (zh, en), topics[tag]) for tag, zh, en in members)
        parts.append('</div></section>')
    parts.append('</div>')
    block = HOME_START + ''.join(parts) + HOME_END
    return HOME_BLOCK.sub(lambda _: block, source)


def main():
    home = ROOT / 'index.html'
    raw = home.read_bytes().decode('utf-8')
    crlf = '\r\n' in raw
    new = render_home_hub(raw.replace('\r\n', '\n'))
    new = new.replace('\n', '\r\n') if crlf else new
    if new != raw:
        home.write_bytes(new.encode('utf-8'))
    path = ROOT / 'blog/index.html'
    source = path.read_text(encoding='utf8')
    result = render(source, (ROOT / 'assets/blog-filter.css').read_text(encoding='utf8'))
    if result != source:
        path.write_text(result, encoding='utf8')
    print('Bilingual blog filter and homepage hub generated; article cards preserved')


if __name__ == '__main__':
    main()
