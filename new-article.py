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


def asset_version() -> str:
    """Use the homepage's cache epoch; refuse a missing/ambiguous bootstrap."""
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as source:
        versions = re.findall(r"\bvar T='(2026[0-9]{4})'", source.read())
    if len(versions) != 1:
        raise ValueError('index.html must contain exactly one site cache epoch')
    return versions[0]


def render(args) -> str:
    version = asset_version()
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
<link rel="preload" as="style" href="/assets/app.css?v={version}" />
<link rel="stylesheet" href="/assets/app.css?v={version}" />

<script type="application/ld+json">
{{ "@context":"https://schema.org","@type":"MedicalScholarlyArticle","@id":"{article_id}","headline":"{attr(args.title_zh)}","description":"{attr(args.desc_zh)}","datePublished":"{today}","dateModified":"{today}","inLanguage":"zh-Hant-TW","keywords":"{attr(args.tag_zh)},{attr(args.tag_en)}","articleSection":"Ophthalmology Patient Education","author":{{"@id":"{DOMAIN}/about#person"}},"publisher":{{"@id":"{DOMAIN}/about#person"}},"image":{{"@type":"ImageObject","@id":"{image_id}","url":"{og}","contentUrl":"{og}","width":1200,"height":630,"name":"{attr(args.title_zh)}","caption":"{attr(args.title_zh)}"}},"thumbnailUrl":"{og}","mainEntityOfPage":"{url}","isPartOf":{{"@id":"{DOMAIN}/#website"}},"audience":{{"@type":"MedicalAudience","audienceType":["Patient","Clinician"],"geographicArea":{{"@type":"Country","name":"Taiwan"}},"healthCondition":{{"@type":"MedicalCondition","name":"Ophthalmology"}}}} }}
</script>
<script type="application/ld+json">
{{ "@context":"https://schema.org","@type":"BreadcrumbList","@id":"{breadcrumb_id}","itemListElement":[{{"@type":"ListItem","position":1,"name":"首頁","item":"{DOMAIN}/"}},{{"@type":"ListItem","position":2,"name":"衛教文章","item":"{DOMAIN}/blog"}},{{"@type":"ListItem","position":3,"name":"{attr(args.title_zh)}","item":"{url}"}}]}}
</script>
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"MedicalWebPage","@id":"{webpage_id}","url":"{url}","inLanguage":["zh-TW","en"],"name":"{attr(args.title_zh)}","audience":{{"@type":"MedicalAudience","audienceType":"Patient"}},"lastReviewed":"{today}","reviewedBy":{{"@type":["Person","Physician"],"@id":"{DOMAIN}/about#person","name":"蕭閔謙 醫師","alternateName":"Min-Chien Hsiao, MD","honorificSuffix":"M.D.","jobTitle":"Resident Physician, Ophthalmology","medicalSpecialty":"https://schema.org/Ophthalmologic","url":"{DOMAIN}/about"}},"author":{{"@id":"{DOMAIN}/about#person"}},"publisher":{{"@id":"{DOMAIN}/about#person"}},"speakable":{{"@type":"SpeakableSpecification","cssSelector":["h1","h2",".tldr"]}},"keywords":"{attr(args.tag_zh)},{attr(args.tag_en)}","articleSection":"Ophthalmology Patient Education","about":{{"@type":"MedicalCondition","name":"{attr(args.tag_zh)}","alternateName":["{attr(args.tag_zh)}","{attr(args.tag_en)}"],"code":{{"@type":"MedicalCode","code":"{args.condition_icd10}","codingSystem":"ICD-10"}}}},"image":{{"@id":"{image_id}"}},"primaryImageOfPage":{{"@id":"{image_id}"}},"thumbnailUrl":"{og}","mainEntity":{{"@id":"{article_id}"}},"breadcrumb":{{"@id":"{breadcrumb_id}"}},"accessibilityFeature":["alternativeText","highContrastDisplay","largePrint","readingOrder","structuralNavigation","tableOfContents","ARIA"],"accessibilityHazard":["noFlashingHazard","noMotionSimulationHazard","noSoundHazard"],"educationalUse":"patient education","learningResourceType":"reference material","isAccessibleForFree":true,"isPartOf":{{"@id":"{DOMAIN}/#website"}}}}
</script>
<script defer src="/assets/telemetry.js?v={version}"></script>
</head>
<body class="font-sans antialiased text-ink-900">

<header class="sticky top-0 z-40 backdrop-blur border-b" style="background:rgba(247,245,240,.92); border-color:var(--border)">
  <div class="max-w-6xl mx-auto px-5 sm:px-8">
    <div class="h-16 flex items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-3 min-w-0">
        <img src="/icon.svg" alt="HsiaoEye" class="w-9 h-9 rounded-lg flex-shrink-0" width="36" height="36" fetchpriority="high" loading="eager" decoding="async">
        <div class="min-w-0 leading-tight">
          <div class="font-display font-semibold text-[16px] sm:text-[18px] blue-text">HsiaoEye</div>
          <div class="text-[10.5px] sm:text-[11.5px] text-ink-500 mt-0.5 truncate" data-zh="蕭閔謙醫師 · 眼科衛教筆記" data-en="Dr. Min-Chien Hsiao · Ophthalmology Notes">蕭閔謙醫師 · 眼科衛教筆記</div>
        </div>
      </a>
      <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <a href="/blog" class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)" data-zh="衛教文章" data-en="Articles">衛教文章</a>
        <a href="/exam" class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)" data-zh="眼科專科醫師考試" data-en="Board Exam">眼科專科醫師考試</a>
        <a href="/tools" class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)" data-zh="量表" data-en="Tools">量表</a>
        <a href="/about" class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)" data-zh="關於我" data-en="About">關於我</a>
        <button type="button" aria-label="搜尋" title="搜尋 (Cmd/Ctrl + K)" class="inline-flex items-center justify-center w-9 h-9 rounded-full" style="background:#fff;border:1px solid var(--border);color:var(--blue-deep)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        </button>
        <select id="langToggle" class="lang-select" aria-label="Language">
          <option value="zh">中文</option>
          <option value="en">EN</option>
        </select>
      </div>
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

<footer class="mag-footer cv-auto-short">
  <div class="mag-foot-top">
    <div class="mag-foot-brand">
      <h2 class="mag-foot-brand-h3" data-zh="HsiaoEye<br>蕭閔謙醫師 眼科筆記" data-en="HsiaoEye<br>Dr. Min-Chien Hsiao · Ophthalmology Notes">HsiaoEye<br>蕭閔謙醫師 眼科筆記</h2>
    </div>
    <div class="mag-foot-cols">
      <div>
        <h3 data-zh="網站" data-en="Site">網站</h3>
        <ul>
          <li><a href="/" data-zh="首頁" data-en="Home">首頁</a></li>
          <li><a href="/blog" data-zh="衛教文章" data-en="Articles">衛教文章</a></li>
          <li><a href="/about" data-zh="關於作者" data-en="About">關於作者</a></li>
        </ul>
      </div>
      <div>
        <h3 data-zh="關於" data-en="About">關於</h3>
        <ul>
          <li><a href="/privacy" data-zh="隱私權政策" data-en="Privacy">隱私權政策</a></li>
          <li><a href="mailto:f94001115@gmail.com" data-zh="聯絡 Email" data-en="Contact">聯絡 Email</a></li>
        </ul>
      </div>
      <div>
        <h3 id="dn-subscribe" data-zh="訂閱" data-en="Subscribe">訂閱</h3>
        <ul>
          <li><a href="/blog/feed.xml">RSS Feed</a></li>
          <li><a href="/blog/atom.xml">Atom Feed</a></li>
        </ul>
      </div>
    </div>
  </div>

  <div class="mag-foot-disclaimer">
    <span class="mag-disc-tag">Disclaimer</span>
    <p data-zh="本網站內容僅作為一般醫學教育與資訊參考，不構成個別醫療建議，亦不能取代面對面的問診、檢查與處方。任何用藥、停藥、調整劑量或就醫決定，請以您的主治醫師判斷為準。" data-en="This website is for general medical education and information only. It is not individual medical advice and cannot replace an in-person consultation, examination or prescription. For any decision to start, stop or adjust a medication, or to seek care, follow your treating physician's judgement.">本網站內容僅作為一般醫學教育與資訊參考，不構成個別醫療建議，亦不能取代面對面的問診、檢查與處方。任何用藥、停藥、調整劑量或就醫決定，請以您的主治醫師判斷為準。</p>
  </div>

  <div class="mag-foot-bot">
    <span>© <span id="yr">2026</span> Min-Chien Hsiao M.D. · <span data-zh="眼科衛教筆記" data-en="Ophthalmology Notes">眼科衛教筆記</span></span>
    <span data-zh="Made with patience, in Taiwan." data-en="Made with patience, in Taiwan.">Made with patience, in Taiwan.</span>
  </div>
</footer>

<script src="/blog/blog-shared.js?v={version}" defer></script>
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
    print('  5. Bump the current site-wide asset/cache epoch with '
          'python _bump_cache_version.py <old> <new>, then run npm run minify.')
    print('  6. Run the complete authoritative build chain in AGENTS.md '
          'and python preflight.py; verify a second generation pass is stable.')
    print('  7. Follow REMOTE_CI_DELIVERY.md: independent review, candidate CI/'
          'Preview/visual acceptance, then verified normal main delivery.')


if __name__ == '__main__':
    main()
