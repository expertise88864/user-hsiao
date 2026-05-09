#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — auto-regenerate sitemap.xml + blog/feed.xml + blog/atom.xml
from DN.ARTICLES (in blog/blog-shared.js). Idempotent.

Strategy mirrors DermNotes' _gen_feeds.py:
  - Parse DN.ARTICLES list out of blog-shared.js with regex
  - Sort by date desc
  - Emit sitemap with hreflang triplet (zh + en + x-default) per URL
    and image:image entries for articles that have OG cards
  - Emit RSS 2.0 feed.xml + Atom 1.0 atom.xml (last 30 articles each)

Run as a build step before `git push` (also wired into the GH Actions
quality.yml workflow).
"""
import os, re, html
from datetime import datetime, timezone

DOMAIN = 'https://hsiao.chendermatologist.com'
SITE_NAME = 'HsiaoEye · 蕭閔謙醫師 眼科筆記'
AUTHOR = '蕭閔謙 醫師'
EMAIL = 'f94001115@gmail.com'

# ── Parse DN.ARTICLES from blog/blog-shared.js ──
with open('blog/blog-shared.js', 'r', encoding='utf-8') as f:
    js = f.read()
m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
articles = []
if m:
    for line in m.group(1).split('\n'):
        slug_m    = re.search(r"slug\s*:\s*'([^']+)'", line)
        title_m   = re.search(r"title\s*:\s*'([^']+)'", line)
        tag_m     = re.search(r"tag\s*:\s*'([^']+)'", line)
        date_m    = re.search(r"date\s*:\s*'([^']+)'", line)
        updated_m = re.search(r"updated\s*:\s*'([^']+)'", line)
        cat_m     = re.search(r"cat\s*:\s*'([^']+)'", line)
        if slug_m and title_m:
            published = date_m.group(1)    if date_m    else '2026-01-01'
            # v34.15: optional `updated` field — used as <lastmod> when present.
            # Falls back to `date` (publication date). Lets the author bump
            # sitemap freshness on substantive edits without changing the
            # canonical publish-date used for citations / FAQ schema.
            updated   = updated_m.group(1) if updated_m else published
            articles.append({
                'slug':    slug_m.group(1),
                'title':   title_m.group(1),
                'tag':     tag_m.group(1)  if tag_m  else '',
                'date':    published,
                'updated': updated,
                'cat':     cat_m.group(1)  if cat_m  else 'myth',
            })

articles.sort(key=lambda a: a['updated'], reverse=True)

# ── Static pages (with explicit priority/changefreq) ──
STATIC_PAGES = [
    {'url': '/',              'priority': '1.0',  'changefreq': 'weekly'},
    {'url': '/about',         'priority': '0.8',  'changefreq': 'monthly'},
    {'url': '/tools',         'priority': '0.85', 'changefreq': 'monthly'},
    {'url': '/blog/',         'priority': '0.95', 'changefreq': 'weekly'},
    {'url': '/blog/topics',   'priority': '0.7',  'changefreq': 'monthly'},
    {'url': '/notes',         'priority': '0.5',  'changefreq': 'monthly'},
    {'url': '/privacy',       'priority': '0.4',  'changefreq': 'yearly'},
]

# Stub landing pages that aren't in DN.ARTICLES yet (lower priority)
LANDING_STUBS = [
    'cataract-surgery-faq',
    'glaucoma-warnings',
    'contact-lens-safety',
    'red-eye-conjunctivitis',
]

# ── sitemap.xml ──
def build_sitemap():
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
           '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
           '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
           '',
           '  <!-- ===== Chinese (canonical) ===== -->']

    def emit(zh_url, en_url, lastmod, cf, pri, image=None, image_title=None):
        out.append('  <url>')
        out.append(f'    <loc>{DOMAIN}{zh_url}</loc>')
        out.append(f'    <lastmod>{lastmod}</lastmod>')
        out.append(f'    <changefreq>{cf}</changefreq>')
        out.append(f'    <priority>{pri}</priority>')
        out.append(f'    <xhtml:link rel="alternate" hreflang="x-default"  href="{DOMAIN}{zh_url}" />')
        out.append(f'    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="{DOMAIN}{zh_url}" />')
        out.append(f'    <xhtml:link rel="alternate" hreflang="en"         href="{DOMAIN}{en_url}" />')
        if image:
            out.append('    <image:image>')
            out.append(f'      <image:loc>{image}</image:loc>')
            if image_title:
                out.append(f'      <image:title>{html.escape(image_title)}</image:title>')
            out.append('    </image:image>')
        out.append('  </url>')

    # Static pages
    for p in STATIC_PAGES:
        zh = p['url']
        en = '/en/' if zh == '/' else ('/en/blog/' if zh == '/blog/' else '/en' + zh)
        emit(zh, en, today, p['changefreq'], p['priority'])

    # Articles (with per-article OG image). lastmod = `updated` (falls back to `date`)
    out.append('')
    out.append('  <!-- ===== Published articles ===== -->')
    for a in articles:
        zh = f'/blog/{a["slug"]}'
        en = f'/en/blog/{a["slug"]}'
        og = f'{DOMAIN}/assets/og/{a["slug"]}.png'
        emit(zh, en, a['updated'], 'monthly', '0.95', image=og, image_title=a['title'])

    # Landing-page stubs
    out.append('')
    out.append('  <!-- ===== Landing-page stubs ===== -->')
    for slug in LANDING_STUBS:
        zh = f'/blog/{slug}'
        en = f'/en/blog/{slug}'
        emit(zh, en, today, 'monthly', '0.6')

    # English mirror as own URL entries
    out.append('')
    out.append('  <!-- ===== English mirror (/en/) ===== -->')
    for p in STATIC_PAGES:
        zh = p['url']
        en = '/en/' if zh == '/' else ('/en/blog/' if zh == '/blog/' else '/en' + zh)
        out.append('  <url>')
        out.append(f'    <loc>{DOMAIN}{en}</loc>')
        out.append(f'    <lastmod>{today}</lastmod>')
        out.append(f'    <changefreq>{p["changefreq"]}</changefreq>')
        # /en/ is secondary, slightly lower priority
        try: pri = max(0.3, float(p['priority']) - 0.1)
        except ValueError: pri = 0.5
        out.append(f'    <priority>{pri:.2f}</priority>')
        out.append(f'    <xhtml:link rel="alternate" hreflang="x-default"  href="{DOMAIN}{zh}" />')
        out.append(f'    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="{DOMAIN}{zh}" />')
        out.append(f'    <xhtml:link rel="alternate" hreflang="en"         href="{DOMAIN}{en}" />')
        out.append('  </url>')
    for a in articles:
        out.append('  <url>')
        out.append(f'    <loc>{DOMAIN}/en/blog/{a["slug"]}</loc>')
        out.append(f'    <lastmod>{a["updated"]}</lastmod>')
        out.append('    <changefreq>monthly</changefreq>')
        out.append('    <priority>0.85</priority>')
        out.append(f'    <xhtml:link rel="alternate" hreflang="x-default"  href="{DOMAIN}/blog/{a["slug"]}" />')
        out.append(f'    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="{DOMAIN}/blog/{a["slug"]}" />')
        out.append(f'    <xhtml:link rel="alternate" hreflang="en"         href="{DOMAIN}/en/blog/{a["slug"]}" />')
        out.append('  </url>')

    out.append('')
    out.append('</urlset>')
    return '\n'.join(out) + '\n'

# ── feed.xml (RSS 2.0) ──
def build_rss():
    today = datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
           '<channel>',
           f'  <title>{html.escape(SITE_NAME)}</title>',
           f'  <link>{DOMAIN}/</link>',
           f'  <atom:link href="{DOMAIN}/blog/feed.xml" rel="self" type="application/rss+xml" />',
           '  <description>蕭閔謙醫師（眼科）整理的眼科衛教與學習筆記。每月最多 1–2 篇新文章。</description>',
           '  <language>zh-Hant-TW</language>',
           f'  <copyright>© {datetime.now().year} HsiaoEye · {AUTHOR}</copyright>',
           f'  <managingEditor>{EMAIL} ({AUTHOR})</managingEditor>',
           f'  <webMaster>{EMAIL} ({AUTHOR})</webMaster>',
           f'  <lastBuildDate>{today}</lastBuildDate>',
           '  <generator>HsiaoEye auto-feed v1 (_gen_feeds.py)</generator>',
           '  <image>',
           f'    <url>{DOMAIN}/logo-512.png</url>',
           '    <title>HsiaoEye</title>',
           f'    <link>{DOMAIN}/</link>',
           '    <width>144</width>',
           '    <height>144</height>',
           '  </image>',
           '']
    for a in articles[:30]:
        try:
            d = datetime.strptime(a['date'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
            rfc822 = d.strftime('%a, %d %b %Y 00:00:00 +0000')
        except ValueError:
            rfc822 = today
        out.append('  <item>')
        out.append(f'    <title>{html.escape(a["title"])}</title>')
        out.append(f'    <link>{DOMAIN}/blog/{a["slug"]}</link>')
        out.append(f'    <guid isPermaLink="true">{DOMAIN}/blog/{a["slug"]}</guid>')
        out.append(f'    <pubDate>{rfc822}</pubDate>')
        out.append(f'    <dc:creator>{html.escape(AUTHOR)}</dc:creator>')
        out.append(f'    <category>{html.escape(a["tag"])}</category>')
        out.append(f'    <description>{html.escape(a["title"])} — {html.escape(AUTHOR)}（眼科）整理的衛教文章。</description>')
        out.append('  </item>')
    out.append('</channel>')
    out.append('</rss>')
    return '\n'.join(out) + '\n'

# ── atom.xml (Atom 1.0) ──
def build_atom():
    today = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-Hant-TW">',
           f'  <title>{html.escape(SITE_NAME)}</title>',
           '  <subtitle>眼科衛教與學習筆記</subtitle>',
           f'  <link href="{DOMAIN}/" rel="alternate" />',
           f'  <link href="{DOMAIN}/blog/atom.xml" rel="self" />',
           f'  <id>{DOMAIN}/</id>',
           f'  <updated>{today}</updated>',
           '  <author>',
           f'    <name>{html.escape(AUTHOR)}</name>',
           f'    <email>{EMAIL}</email>',
           f'    <uri>{DOMAIN}/about</uri>',
           '  </author>',
           '  <rights>© ' + str(datetime.now().year) + ' ' + AUTHOR + '</rights>',
           f'  <generator uri="{DOMAIN}">HsiaoEye auto-feed v1</generator>',
           '']
    for a in articles[:30]:
        try:
            d = datetime.strptime(a['date'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
            iso = d.strftime('%Y-%m-%dT00:00:00Z')
        except ValueError:
            iso = today
        out.append('  <entry>')
        out.append(f'    <title>{html.escape(a["title"])}</title>')
        out.append(f'    <link href="{DOMAIN}/blog/{a["slug"]}" rel="alternate" />')
        out.append(f'    <id>{DOMAIN}/blog/{a["slug"]}</id>')
        out.append(f'    <updated>{iso}</updated>')
        out.append(f'    <published>{iso}</published>')
        out.append(f'    <category term="{html.escape(a["tag"])}" />')
        out.append(f'    <summary>{html.escape(a["title"])} — {html.escape(AUTHOR)}（眼科）整理的衛教文章。</summary>')
        out.append('  </entry>')
    out.append('</feed>')
    return '\n'.join(out) + '\n'

# ── Write files ──
def main():
    with open('sitemap.xml', 'w', encoding='utf-8') as f: f.write(build_sitemap())
    print(f'Wrote sitemap.xml ({len(articles)} articles + {len(STATIC_PAGES)} static + {len(LANDING_STUBS)} stubs)')
    os.makedirs('blog', exist_ok=True)
    with open('blog/feed.xml', 'w', encoding='utf-8') as f: f.write(build_rss())
    print(f'Wrote blog/feed.xml ({min(30, len(articles))} items)')
    with open('blog/atom.xml', 'w', encoding='utf-8') as f: f.write(build_atom())
    print(f'Wrote blog/atom.xml ({min(30, len(articles))} items)')

if __name__ == '__main__':
    main()
