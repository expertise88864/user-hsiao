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
import json
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


if __name__ == '__main__':
    main()
