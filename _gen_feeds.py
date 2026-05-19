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
FEED_DESCRIPTION = '蕭閔謙醫師的眼科筆記，整理眼科衛教、疾病警訊與實用就醫資訊。'

# ── Parse DN.ARTICLES from blog/blog-shared.js ──
with open('blog/blog-shared.js', 'r', encoding='utf-8') as f:
    js = f.read()
m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
articles = []
if m:
    stub_m = re.search(r'DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)', js)
    stubs = set(re.findall(r"'([^']+)'", stub_m.group(1))) if stub_m else set()

    def field(body, key):
        mm = re.search(rf"{key}\s*:\s*'([^']*)'", body)
        return mm.group(1) if mm else ''

    for obj in re.finditer(r'\{([\s\S]*?)\}', m.group(1)):
        body = obj.group(1)
        slug = field(body, 'slug')
        title = field(body, 'title')
        if slug and title and slug not in stubs:
            published = field(body, 'date') or '2026-01-01'
            # v34.15: optional `updated` field — used as <lastmod> when present.
            # Falls back to `date` (publication date). Lets the author bump
            # sitemap freshness on substantive edits without changing the
            # canonical publish-date used for citations / FAQ schema.
            updated = field(body, 'updated') or published
            articles.append({
                'slug':     slug,
                'title':    title,
                'title_en': field(body, 'title_en'),
                'tag':      field(body, 'tag'),
                'date':     published,
                'updated':  updated,
                'cat':      field(body, 'cat') or 'myth',
            })

articles.sort(key=lambda a: a['updated'], reverse=True)

def clean_text(value):
    value = html.unescape(value or '')
    value = re.sub(r'<[^>]+>', ' ', value)
    return re.sub(r'\s+', ' ', value).strip()

def meta_content(path, key, attr='name'):
    try:
        src = open(path, encoding='utf-8').read()
    except OSError:
        return ''
    m = re.search(rf'<meta\s+{attr}="{re.escape(key)}"\s+content="([^"]*)"\s*/?>', src, re.I)
    return clean_text(m.group(1)) if m else ''

def html_title(path):
    try:
        src = open(path, encoding='utf-8').read()
    except OSError:
        return ''
    m = re.search(r'<title>([^<]+)</title>', src, re.I)
    if not m:
        return ''
    return re.sub(r'\s*\|\s*HsiaoEye.*$', '', clean_text(m.group(1))).strip()

def article_title(a, lang='zh'):
    if lang == 'en':
        path = os.path.join('en', 'blog', f'{a["slug"]}.html')
        return html_title(path) or a.get('title_en') or a.get('title') or a['slug']
    path = os.path.join('blog', f'{a["slug"]}.html')
    return html_title(path) or a.get('title') or a['slug']

def article_summary(a, lang='zh'):
    path = os.path.join('en', 'blog', f'{a["slug"]}.html') if lang == 'en' else os.path.join('blog', f'{a["slug"]}.html')
    desc = meta_content(path, 'description')
    if desc:
        return desc
    title = article_title(a, lang=lang)
    if lang == 'en':
        return f'{title} - Ophthalmology patient education by {AUTHOR}.'
    return f'{title} - {AUTHOR}整理的眼科衛教文章。'

def rfc822_date(date_str):
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        d = SITE_UPDATED_DT
    return d.strftime('%a, %d %b %Y 00:00:00 +0000')

def atom_date(date_str):
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        d = SITE_UPDATED_DT
    return d.strftime('%Y-%m-%dT00:00:00Z')

def parse_ymd(date_str, fallback='2026-01-01'):
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return datetime.strptime(fallback, '%Y-%m-%d').replace(tzinfo=timezone.utc)

SITE_UPDATED = articles[0]['updated'] if articles else '2026-01-01'
SITE_UPDATED_DT = parse_ymd(SITE_UPDATED)
SITE_UPDATED_YMD = SITE_UPDATED_DT.strftime('%Y-%m-%d')
SITE_UPDATED_RFC822 = SITE_UPDATED_DT.strftime('%a, %d %b %Y 00:00:00 +0000')
SITE_UPDATED_ATOM = SITE_UPDATED_DT.strftime('%Y-%m-%dT00:00:00Z')
COPYRIGHT_YEAR = SITE_UPDATED_DT.year

# ── Static pages (with explicit priority/changefreq) ──
# v37.37 — `/blog/` (trailing slash) listed here previously caused GSC
# "redirect error" reports: vercel.json sets `trailingSlash: false`, so
# /blog/ → 308 → /blog. Sitemap and canonical must match the no-slash
# form Vercel actually serves at 200 OK. Only `/` keeps its slash (root
# is the one URL Vercel doesn't strip).
STATIC_PAGES = [
    {'url': '/',              'priority': '1.0',  'changefreq': 'weekly'},
    {'url': '/about',         'priority': '0.8',  'changefreq': 'monthly'},
    {'url': '/tools',         'priority': '0.85', 'changefreq': 'monthly'},
    {'url': '/blog',          'priority': '0.95', 'changefreq': 'weekly'},
    {'url': '/blog/topics',   'priority': '0.7',  'changefreq': 'monthly'},
    {'url': '/notes',         'priority': '0.5',  'changefreq': 'monthly'},
    {'url': '/privacy',       'priority': '0.4',  'changefreq': 'yearly'},
]

# Unpublished landing pages are deliberately excluded from sitemap/feed.
LANDING_STUBS = []

# ── sitemap.xml ──
def build_sitemap():
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
        en = '/en' if zh == '/' else '/en' + zh
        emit(zh, en, SITE_UPDATED_YMD, p['changefreq'], p['priority'])

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
        emit(zh, en, SITE_UPDATED_YMD, 'monthly', '0.6')

    # English mirror as own URL entries
    out.append('')
    out.append('  <!-- ===== English mirror (/en/) ===== -->')
    for p in STATIC_PAGES:
        zh = p['url']
        en = '/en' if zh == '/' else '/en' + zh
        out.append('  <url>')
        out.append(f'    <loc>{DOMAIN}{en}</loc>')
        out.append(f'    <lastmod>{SITE_UPDATED_YMD}</lastmod>')
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
        # v37.31 — also expose the OG image for /en/ article URLs so Google
        # Image Search and Discover see the EN URL as a candidate too.
        out.append('    <image:image>')
        out.append(f'      <image:loc>{DOMAIN}/assets/og/{a["slug"]}.png</image:loc>')
        title_en = a.get('title_en') or a.get('title') or a['slug']
        out.append(f'      <image:title>{html.escape(title_en)}</image:title>')
        out.append('    </image:image>')
        out.append('  </url>')

    out.append('')
    out.append('</urlset>')
    return '\n'.join(out) + '\n'

# ── feed.xml (RSS 2.0) ──
def build_rss():
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
           '<channel>',
           f'  <title>{html.escape(SITE_NAME)}</title>',
           f'  <link>{DOMAIN}/</link>',
           f'  <atom:link href="{DOMAIN}/blog/feed.xml" rel="self" type="application/rss+xml" />',
           f'  <description>{html.escape(FEED_DESCRIPTION)}</description>',
           '  <language>zh-Hant-TW</language>',
           f'  <copyright>© {COPYRIGHT_YEAR} HsiaoEye · {AUTHOR}</copyright>',
           f'  <managingEditor>{EMAIL} ({AUTHOR})</managingEditor>',
           f'  <webMaster>{EMAIL} ({AUTHOR})</webMaster>',
           f'  <lastBuildDate>{SITE_UPDATED_RFC822}</lastBuildDate>',
           '  <generator>HsiaoEye auto-feed v1 (_gen_feeds.py)</generator>',
           '  <image>',
           f'    <url>{DOMAIN}/SUNN1302-200.jpg</url>',
           '    <title>HsiaoEye</title>',
           f'    <link>{DOMAIN}/</link>',
           '    <width>144</width>',
           '    <height>144</height>',
           '  </image>',
           '']
    for a in articles[:30]:
        url = f'{DOMAIN}/blog/{a["slug"]}'
        title = article_title(a)
        summary = article_summary(a)
        rfc822 = rfc822_date(a['date'])
        og = f'{DOMAIN}/assets/og/{a["slug"]}.png'
        content = (
            f'<p>{html.escape(summary)}</p>'
            f'<p><a href="{html.escape(url)}">閱讀全文</a></p>'
        )
        out.append('  <item>')
        out.append(f'    <title>{html.escape(title)}</title>')
        out.append(f'    <link>{url}</link>')
        out.append(f'    <guid isPermaLink="true">{url}</guid>')
        out.append(f'    <pubDate>{rfc822}</pubDate>')
        out.append(f'    <dc:creator>{html.escape(AUTHOR)}</dc:creator>')
        out.append(f'    <category>{html.escape(a["tag"])}</category>')
        out.append(f'    <description>{html.escape(summary)}</description>')
        out.append(f'    <enclosure url="{og}" length="0" type="image/png" />')
        out.append(f'    <content:encoded><![CDATA[{content}]]></content:encoded>')
        out.append('  </item>')
    out.append('</channel>')
    out.append('</rss>')
    return '\n'.join(out) + '\n'

# ── atom.xml (Atom 1.0) ──
def build_atom():
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-Hant-TW">',
           f'  <title>{html.escape(SITE_NAME)}</title>',
           f'  <subtitle>{html.escape(FEED_DESCRIPTION)}</subtitle>',
           f'  <link href="{DOMAIN}/" rel="alternate" />',
           f'  <link href="{DOMAIN}/blog/atom.xml" rel="self" />',
           f'  <id>{DOMAIN}/</id>',
           f'  <updated>{SITE_UPDATED_ATOM}</updated>',
           '  <author>',
           f'    <name>{html.escape(AUTHOR)}</name>',
           f'    <email>{EMAIL}</email>',
           f'    <uri>{DOMAIN}/about</uri>',
           '  </author>',
           '  <rights>© ' + str(COPYRIGHT_YEAR) + ' ' + AUTHOR + '</rights>',
           f'  <generator uri="{DOMAIN}">HsiaoEye auto-feed v1</generator>',
           '']
    for a in articles[:30]:
        url = f'{DOMAIN}/blog/{a["slug"]}'
        en_url = f'{DOMAIN}/en/blog/{a["slug"]}'
        title = article_title(a)
        summary = article_summary(a)
        published_iso = atom_date(a['date'])
        updated_iso = atom_date(a.get('updated') or a.get('date'))
        out.append('  <entry>')
        out.append(f'    <title>{html.escape(title)}</title>')
        out.append(f'    <link href="{url}" rel="alternate" />')
        out.append(f'    <link href="{en_url}" rel="alternate" hreflang="en" />')
        out.append(f'    <id>{url}</id>')
        out.append(f'    <updated>{updated_iso}</updated>')
        out.append(f'    <published>{published_iso}</published>')
        out.append(f'    <category term="{html.escape(a["tag"])}" />')
        out.append(f'    <summary>{html.escape(summary)}</summary>')
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
