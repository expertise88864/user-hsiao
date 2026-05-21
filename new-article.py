#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — scaffold a new patient-education article.

Usage:
  python new-article.py --slug=my-new-topic \
                        --title-zh="新文章標題" \
                        --title-en="New Article Title" \
                        --desc-zh="一句話描述（120 字內）" \
                        --desc-en="One-sentence description (<160 chars)" \
                        --cat=rx \
                        --tag-zh="乾眼症" --tag-en="Dry Eye"

Generates `blog/<slug>.html` with the full HsiaoEye template (head meta,
JSON-LD MedicalScholarlyArticle + BreadcrumbList + MedicalWebPage with
speakable/accessibility, body skeleton with required regions). Refuses
to overwrite an existing file.

After running, follow the manual steps printed at the end:
  1. Add a DN.ARTICLES entry in blog/blog-shared.js
  2. Add cards on index.html / blog/index.html / blog/topics.html
  3. Generate the OG card (python _gen_og_images.py)
  4. Regenerate feeds, EN mirror, CSP hashes, related.json
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.abspath(__file__))
DOMAIN = 'https://hsiao.chendermatologist.com'

# Valid `cat` values (mirror DN.ARTICLES category enum).
VALID_CATS = {'rx', 'alert', 'myth', 'tool', 'research'}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description='Scaffold a HsiaoEye article')
    p.add_argument('--slug', required=True, help='lowercase-dash slug (no .html)')
    p.add_argument('--title-zh', required=True)
    p.add_argument('--title-en', required=True)
    p.add_argument('--desc-zh', required=True, help='<=160 chars meta description (ZH)')
    p.add_argument('--desc-en', required=True, help='<=160 chars meta description (EN)')
    p.add_argument('--cat', required=True, choices=sorted(VALID_CATS))
    p.add_argument('--tag-zh', required=True, help='primary topic tag in ZH (eg 乾眼症)')
    p.add_argument('--tag-en', required=True, help='primary topic tag in EN (eg "Dry Eye")')
    p.add_argument('--condition-icd10', default='H99',
                   help='ICD-10 code for MedicalCondition (default H99 = unspec eye disorder)')
    p.add_argument('--date', default=date.today().isoformat(),
                   help='Publish date YYYY-MM-DD (default: today)')
    args = p.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]+', args.slug):
        sys.exit('slug must be lowercase alphanumerics + dashes only')
    if len(args.desc_zh) > 160:
        print(f'[WARN] desc-zh is {len(args.desc_zh)} chars (>160 - Google snippet cutoff)')
    if len(args.desc_en) > 160:
        print(f'[WARN] desc-en is {len(args.desc_en)} chars (>160 - Google snippet cutoff)')
    return args


def attr(s: str) -> str:
    return s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;').replace('>', '&gt;')


def render(args) -> str:
    slug = args.slug
    today = args.date
    url = f'{DOMAIN}/blog/{slug}'
    en_url = f'{DOMAIN}/en/blog/{slug}'
    og = f'{DOMAIN}/assets/og/{slug}.png'
    article_id = f'{url}#article'
    webpage_id = f'{url}#webpage'
    breadcrumb_id = f'{url}#breadcrumb'
    image_id = f'{url}#primaryimage'

    return f'''<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>{args.title_zh} | HsiaoEye · 蕭閔謙醫師</title>
<meta name="description" content="{attr(args.desc_zh)}" />
<meta name="theme-color" content="#3a5a7c" />
<meta name="keywords" content="{attr(args.tag_zh)}，{attr(args.tag_en)}，蕭閔謙醫師，眼科衛教，HsiaoEye" />
<meta name="author" content="蕭閔謙 醫師 · HsiaoEye" />

<link rel="canonical" href="{url}" />
<link rel="author" href="{DOMAIN}/about" />
<link rel="publisher" href="{DOMAIN}/" />
<link rel="alternate" hreflang="x-default" href="{url}" />
<link rel="alternate" hreflang="zh-Hant-TW" href="{url}" />
<link rel="alternate" hreflang="en" href="{en_url}" />
<link rel="alternate" type="application/rss+xml" title="HsiaoEye RSS" href="/blog/feed.xml" />
<link rel="alternate" type="application/atom+xml" title="HsiaoEye Atom" href="/blog/atom.xml" />

<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png" />
<link rel="icon" sizes="any" href="/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="HsiaoEye">
<meta name="mobile-web-app-capable" content="yes">
<meta name="application-name" content="HsiaoEye">
<link rel="manifest" href="/manifest.json" />

<meta property="og:type" content="article" />
<meta property="og:url" content="{url}" />
<meta property="og:title" content="{attr(args.title_zh)}" />
<meta property="og:description" content="{attr(args.desc_zh)}" />
<meta property="og:image" content="{og}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="HsiaoEye 文章封面卡 — {attr(args.title_zh)}" />
<meta property="og:locale" content="zh_TW" />
<meta property="og:locale:alternate" content="en_US" />
<meta property="og:site_name" content="HsiaoEye · 蕭閔謙醫師 眼科筆記" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{attr(args.title_zh)}" />
<meta name="twitter:description" content="{attr(args.desc_zh)}" />
<meta name="twitter:image" content="{og}" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="dns-prefetch" href="https://www.googletagmanager.com" />
<link rel="dns-prefetch" href="https://www.google-analytics.com" />
<link rel="preload" as="style" href="/assets/app.css" />
<link rel="stylesheet" href="/assets/app.css" />

<script type="application/ld+json">
{{ "@context":"https://schema.org","@type":"MedicalScholarlyArticle","@id":"{article_id}","headline":"{attr(args.title_zh)}","description":"{attr(args.desc_zh)}","datePublished":"{today}","dateModified":"{today}","inLanguage":"zh-Hant-TW","keywords":"{attr(args.tag_zh)},{attr(args.tag_en)}","articleSection":"Ophthalmology Patient Education","author":{{"@id":"{DOMAIN}/about#person"}},"publisher":{{"@id":"{DOMAIN}/about#person"}},"image":{{"@type":"ImageObject","@id":"{image_id}","url":"{og}","contentUrl":"{og}","width":1200,"height":630,"name":"{attr(args.title_zh)}","caption":"{attr(args.title_zh)}"}},"thumbnailUrl":"{og}","mainEntityOfPage":"{url}","isPartOf":{{"@id":"{DOMAIN}/#website"}},"audience":{{"@type":"MedicalAudience","audienceType":["Patient","Clinician"],"geographicArea":{{"@type":"Country","name":"Taiwan"}},"healthCondition":{{"@type":"MedicalCondition","name":"Ophthalmology"}}}} }}
</script>
<script type="application/ld+json">
{{ "@context":"https://schema.org","@type":"BreadcrumbList","@id":"{breadcrumb_id}","itemListElement":[{{"@type":"ListItem","position":1,"name":"首頁","item":"{DOMAIN}/"}},{{"@type":"ListItem","position":2,"name":"衛教文章","item":"{DOMAIN}/blog"}},{{"@type":"ListItem","position":3,"name":"{attr(args.title_zh)}","item":"{url}"}}]}}
</script>
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"MedicalWebPage","@id":"{webpage_id}","url":"{url}","inLanguage":["zh-TW","en"],"name":"{attr(args.title_zh)}","audience":{{"@type":"MedicalAudience","audienceType":"Patient"}},"lastReviewed":"{today}","reviewedBy":{{"@id":"{DOMAIN}/about#person"}},"author":{{"@id":"{DOMAIN}/about#person"}},"publisher":{{"@id":"{DOMAIN}/about#person"}},"speakable":{{"@type":"SpeakableSpecification","cssSelector":["h1","h2",".tldr"]}},"keywords":"{attr(args.tag_zh)},{attr(args.tag_en)}","articleSection":"Ophthalmology Patient Education","about":{{"@type":"MedicalCondition","name":"{attr(args.tag_zh)}","alternateName":["{attr(args.tag_zh)}","{attr(args.tag_en)}"],"code":{{"@type":"MedicalCode","code":"{args.condition_icd10}","codingSystem":"ICD-10"}}}},"image":{{"@id":"{image_id}"}},"primaryImageOfPage":{{"@id":"{image_id}"}},"thumbnailUrl":"{og}","mainEntity":{{"@id":"{article_id}"}},"breadcrumb":{{"@id":"{breadcrumb_id}"}},"accessibilityFeature":["alternativeText","highContrastDisplay","largePrint","readingOrder","structuralNavigation","tableOfContents","ARIA"],"accessibilityHazard":["noFlashingHazard","noMotionSimulationHazard","noSoundHazard"],"educationalUse":"patient education","learningResourceType":"reference material","isAccessibleForFree":true,"isPartOf":{{"@id":"{DOMAIN}/#website"}}}}
</script>
</head>
<body class="font-sans antialiased text-ink-900">

<header class="sticky top-0 z-40 backdrop-blur border-b" style="background:rgba(247,245,240,.92); border-color:var(--border)">
  <div class="max-w-6xl mx-auto px-5 sm:px-8">
    <div class="h-16 flex items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-3 min-w-0">
        <img src="/icon.svg" alt="HsiaoEye" class="w-9 h-9 rounded-lg flex-shrink-0" width="36" height="36" fetchpriority="high" decoding="async" loading="eager">
        <div class="font-display font-semibold text-[16px] sm:text-[18px] blue-text">HsiaoEye</div>
      </a>
    </div>
  </div>
</header>

<main id="main-content">

<section class="max-w-3xl mx-auto px-5 sm:px-8 pt-10">
  <div class="text-[11px] uppercase tracking-[.24em] font-semibold" style="color:var(--blue-deep)" data-zh="衛教文章" data-en="Patient Education">衛教文章</div>
  <h1 class="font-display font-bold leading-[1.18] text-[32px] sm:text-[44px]" style="color:var(--ink)">
    <span data-zh="{attr(args.title_zh)}" data-en="{attr(args.title_en)}">{args.title_zh}</span>
  </h1>
  <p class="mt-6 text-[15.5px] leading-[1.95] tldr" style="color:var(--ink-2)"
     data-zh="TODO ── 在這裡寫 1-2 句中文摘要。"
     data-en="TODO ── 1-2 sentence English lede.">
    TODO ── 在這裡寫 1-2 句中文摘要。
  </p>
</section>

<article class="max-w-3xl mx-auto px-5 sm:px-8 mb-16">

  <h2 id="section-1" data-zh="一、TODO 第一個段落" data-en="1. TODO first section">一、TODO 第一個段落</h2>
  <p data-zh="TODO 內文。"
     data-en="TODO body.">TODO 內文。</p>

  <h2 id="references" data-zh="主要參考文獻" data-en="Key references">主要參考文獻</h2>
  <ol style="font-size:14px;line-height:1.85;color:var(--ink-2)">
    <li>TODO author. <em>TODO journal</em>. {today[:4]}.</li>
  </ol>

</article>

<!-- Related articles mount — populated by DN.addRelatedArticles() at runtime -->
<div id="hs-related"></div>

</main>

<script src="/blog/blog-shared.js" defer></script>
</body>
</html>
'''


def main():
    args = parse_args()
    out_path = os.path.join(ROOT, 'blog', f'{args.slug}.html')
    if os.path.exists(out_path):
        sys.exit(f'refuse to overwrite: {out_path}')

    html = render(args)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'[OK] wrote {out_path}')
    print()
    print('Next steps:')
    print(f'  1. Edit {out_path} — replace all "TODO" markers with real content.')
    print(f'  2. Add a DN.ARTICLES entry near the top of blog/blog-shared.js:')
    print(f"       {{ slug:'{args.slug}', title:'{args.title_zh}', "
          f"title_en:'{args.title_en}', cat:'{args.cat}', "
          f"tag:'{args.tag_zh}', tag_en:'{args.tag_en}', date:'{args.date}' }},")
    print('  3. Add article cards on index.html / blog/index.html / blog/topics.html.')
    print('  4. Generate the OG card:        python _gen_og_images.py')
    print('  5. Regenerate the build chain:  python halfwidth_to_fullwidth.py && '
          'python _gen_feeds.py && python _gen_related.py && '
          'python _gen_en_pages.py && python _gen_csp_hashes.py')
    print('  6. Bump the cache stamp in admin.html + 6 articles + sw.js CACHE.')


if __name__ == '__main__':
    main()
