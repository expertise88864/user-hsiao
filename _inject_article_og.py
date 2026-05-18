"""
One-off: add OpenGraph Article tags (`article:published_time`,
`article:modified_time`, `article:author`, `article:section`,
`article:tag`) to every published article that currently has only
`og:type=article`. These are required for:
  - Google News (article timestamps shown in carousel)
  - Facebook / LinkedIn article cards (clean byline + date)
  - X / Twitter card metadata enrichment

Data comes from each article's existing JSON-LD `datePublished`,
`dateModified`, `keywords` — we just promote it to head meta tags so
crawlers that don't parse JSON-LD still see structured timestamps.

Safe to re-run: skips files that already have article:published_time.
"""
from __future__ import annotations

import glob
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
AUTHOR_URL = 'https://hsiao.chendermatologist.com/about'


def parse_jsonld(html: str) -> dict:
    """Pull datePublished, dateModified, keywords from MedicalScholarlyArticle."""
    m = re.search(
        r'<script type="application/ld\+json">\s*\{[^<]*?"@type":"MedicalScholarlyArticle"[\s\S]*?</script>',
        html,
    )
    if not m:
        return {}
    block = m.group(0)
    def find(key):
        mm = re.search(rf'"{re.escape(key)}":"([^"]*)"', block)
        return mm.group(1) if mm else ''
    return {
        'datePublished': find('datePublished'),
        'dateModified': find('dateModified'),
        'keywords': find('keywords'),
        'articleSection': find('articleSection'),
    }


def main():
    n_added = 0
    for fp in sorted(glob.glob(os.path.join(ROOT, 'blog', '*.html'))):
        base = os.path.basename(fp)
        if base in ('index.html', 'topics.html'):
            continue
        with open(fp, encoding='utf-8') as f:
            html = f.read()
        if 'property="article:published_time"' in html:
            continue
        meta = parse_jsonld(html)
        if not meta.get('datePublished'):
            print(f'  skip (no datePublished): {base}')
            continue

        # Build the OG article block
        tags = []
        if meta['datePublished']:
            tags.append(f'<meta property="article:published_time" content="{meta["datePublished"]}T00:00:00+08:00" />')
        if meta['dateModified']:
            tags.append(f'<meta property="article:modified_time" content="{meta["dateModified"]}T00:00:00+08:00" />')
        tags.append(f'<meta property="article:author" content="{AUTHOR_URL}" />')
        if meta['articleSection']:
            tags.append(f'<meta property="article:section" content="{meta["articleSection"]}" />')
        if meta['keywords']:
            for tag in meta['keywords'].split(',')[:6]:
                t = tag.strip()
                if t:
                    tags.append(f'<meta property="article:tag" content="{t}" />')
        block = '\n'.join(tags) + '\n'

        # Insert after <meta property="og:type" content="article" /> — match
        # both self-closing (`/>`) and HTML5 unclosed (`>`) forms.
        anchor = None
        for cand in ('<meta property="og:type" content="article" />',
                     '<meta property="og:type" content="article">'):
            if cand in html:
                anchor = cand
                break
        if not anchor:
            print(f'  skip (no og:type anchor): {base}')
            continue
        new_html = html.replace(anchor, anchor + '\n' + block, 1)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(new_html)
        n_added += 1
        print(f'  + {base}  ({len(tags)} OG tags)')

    print(f'\nadded article OG tags to {n_added} file(s)')


if __name__ == '__main__':
    main()
