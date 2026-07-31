"""
HsiaoEye — generate /assets/related.json from DN.ARTICLES metadata.

`blog-shared.js`'s DN.addRelatedArticles() fetches this file and uses it
to render 4 contextual "Related reads" cards under each article. When
the file is missing or empty the JS falls back to random category-mates,
which leaves topical clusters weakly linked.

Scoring per candidate B (relative to current article A):
  +6  same category (`cat`)
  +4  same tag (`tag`)
  +3  shared slug-token count >=2 (e.g. cataract-* clusters)
  +2  newer than A (encourages forward-pointing freshness)
  +0.5*random  tiebreak

The top 4 candidates per article are written to assets/related.json:
  { "<slug>": [{"slug":"…","reasons":["same-tag","cluster"]}, …], … }

`reasons` are surfaced in the rendered card as the small subtitle, so
the user understands WHY this article was suggested.
"""
import html
import json
import _jsonld  # M-13: JSON-LD must be escaped for <script> embedding
import random
import re
from pathlib import Path

ROOT = Path(__file__).parent
random.seed(42)  # deterministic output between runs

JS = (ROOT / 'blog' / 'blog-shared.js').read_text(encoding='utf-8')
m = re.search(r'DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];', JS)
if not m:
    raise SystemExit('DN.ARTICLES not found in blog-shared.js')

# Each {…} object on its own; not all keys are present on every line.
articles = []
for body in re.finditer(r'\{([^{}]*)\}', m.group(1)):
    rec = {}
    for k in ('slug', 'title', 'title_en', 'cat', 'tag', 'tag_en', 'date', 'updated'):
        mm = re.search(rf"{k}\s*:\s*'([^']*)'", body.group(1))
        if mm:
            rec[k] = mm.group(1)
    if rec.get('slug') and rec.get('title'):
        articles.append(rec)

# Drop stubs (DN.STUB_SLUGS is a runtime Set; mirror it from the JS source).
stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', JS)
stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()
articles = [a for a in articles if a['slug'] not in stubs]
ARTICLE_BY_SLUG = {a['slug']: a for a in articles}
STATIC_START = '<!-- hs-static-related:start -->'
STATIC_END = '<!-- hs-static-related:end -->'
STATIC_RE = re.compile(
    rf'\n?{re.escape(STATIC_START)}[\s\S]*?{re.escape(STATIC_END)}\n?',
    re.MULTILINE,
)
EMPTY_MOUNT_RE = re.compile(
    r'(?:<!-- Related articles mount[^\n]*-->\s*)?'
    r'<div\s+id="hs-related"(?P<attrs>[^>]*)>\s*</div>',
    re.IGNORECASE,
)


def slug_tokens(slug):
    return set(slug.split('-'))


def score(a, b):
    s = 0.5 * random.random()  # tiebreak
    reasons = []
    if a.get('cat') and a.get('cat') == b.get('cat'):
        s += 6
        reasons.append('same-cat')
    if a.get('tag') and a.get('tag') == b.get('tag'):
        s += 4
        reasons.append('same-tag')
    shared = slug_tokens(a['slug']) & slug_tokens(b['slug'])
    shared.discard('comprehensive')   # too common
    shared.discard('guide')
    if len(shared) >= 2:
        s += 3
        reasons.append('cluster')
    # Freshness bias
    if (b.get('updated') or b.get('date') or '') > (a.get('updated') or a.get('date') or ''):
        s += 2
        reasons.append('newer')
    return s, reasons


def esc(value):
    return html.escape(str(value or ''), quote=True)


def related_block(slug, rows):
    scored = [ARTICLE_BY_SLUG[r['slug']] for r in rows if r['slug'] in ARTICLE_BY_SLUG][:4]
    if not scored:
        return ''

    cards = []
    for a in scored:
        title_en = a.get('title_en') or a['title']
        tag_en = a.get('tag_en') or a.get('tag') or ''
        meta_zh = f"{a.get('tag', '')} · {a.get('date', '')}".strip(' ·')
        meta_en = f"{tag_en} · {a.get('date', '')}".strip(' ·')
        cards.append(
            '      <a href="/blog/{slug}" style="display:flex;flex-direction:column;gap:6px;padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:var(--ink);transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)">\n'
            '        <span style="font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--blue-deep);text-transform:uppercase" data-zh="{tag_zh}" data-en="{tag_en}">{tag_zh}</span>\n'
            '        <span style="font-size:14px;font-weight:700;line-height:1.4;font-family:Noto Serif TC,Georgia,serif" data-zh="{title_zh}" data-en="{title_en}">{title_zh}</span>\n'
            '        <span style="font-size:11.5px;color:var(--muted)" data-zh="{meta_zh}" data-en="{meta_en}">{meta_zh}</span>\n'
            '      </a>'.format(
                slug=esc(a['slug']),
                tag_zh=esc(a.get('tag') or ''),
                tag_en=esc(tag_en),
                title_zh=esc(a['title']),
                title_en=esc(title_en),
                meta_zh=esc(meta_zh),
                meta_en=esc(meta_en),
            )
        )

    ld = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'name': 'Related ophthalmology articles',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': i + 1,
                'url': f"https://hsiao.chendermatologist.com/blog/{a['slug']}",
                'name': a['title'],
            }
            for i, a in enumerate(scored)
        ],
    }
    ld_json = _jsonld.dumps(ld, ensure_ascii=False, separators=(',', ':'))
    return (
        f'{STATIC_START}\n'
        '<style id="hs-related-css">@media (max-width:520px){.hs-related-grid{grid-template-columns:1fr!important}}</style>\n'
        '<section id="hs-related" class="max-w-3xl mx-auto px-5 sm:px-8 my-10" aria-labelledby="hs-related-title">\n'
        '  <div style="border-top:1px solid var(--line);padding-top:24px">\n'
        '    <h2 id="hs-related-title" style="font-size:11px;text-transform:uppercase;letter-spacing:.22em;color:var(--blue-deep);font-weight:700;margin:0 0 12px" data-zh="你可能也會想看" data-en="Related reads">你可能也會想看</h2>\n'
        '    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px" class="hs-related-grid">\n'
        + '\n'.join(cards) + '\n'
        '    </div>\n'
        '  </div>\n'
        '</section>\n'
        f'<script type="application/ld+json">{ld_json}</script>\n'
        f'{STATIC_END}'
    )


def write_static_related(out):
    changed = 0
    skipped = []
    for slug, rows in out.items():
        path = ROOT / 'blog' / f'{slug}.html'
        if not path.exists():
            skipped.append(slug)
            continue
        text = path.read_text(encoding='utf-8')
        block = related_block(slug, rows)
        if not block:
            skipped.append(slug)
            continue

        cleaned = STATIC_RE.sub('\n', text)
        if EMPTY_MOUNT_RE.search(cleaned):
            new = EMPTY_MOUNT_RE.sub(block, cleaned, count=1)
        elif '<div id="hs-share"' in cleaned:
            new = cleaned.replace('<div id="hs-share"', block + '\n<div id="hs-share"', 1)
        elif '</article>' in cleaned:
            new = cleaned.replace('</article>', block + '\n</article>', 1)
        else:
            skipped.append(slug)
            continue

        if new != text:
            path.write_text(new, encoding='utf-8')
            changed += 1

    if skipped:
        print('Skipped static related blocks for: ' + ', '.join(sorted(skipped)))
    print(f'Updated static related blocks in {changed} article(s)')


def main():
    out = {}
    for a in articles:
        scored = []
        for b in articles:
            if b['slug'] == a['slug']:
                continue
            s, reasons = score(a, b)
            scored.append({'slug': b['slug'], '_s': s, 'reasons': reasons})
        scored.sort(key=lambda x: x['_s'], reverse=True)
        out[a['slug']] = [
            {'slug': x['slug'], 'reasons': x['reasons']}
            for x in scored[:4]
        ]
    assets = ROOT / 'assets'
    assets.mkdir(exist_ok=True)
    target = assets / 'related.json'
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {target.relative_to(ROOT)} ({len(out)} articles)')
    write_static_related(out)


if __name__ == '__main__':
    main()
