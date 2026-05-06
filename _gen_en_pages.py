#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — generate /en/ mirror of every public HTML page.

Strategy mirrors DermNotes' _gen_en_pages.py:
  - /en/<file>.html derived from the Chinese source
  - <html lang="en">
  - canonical → /en/<path>
  - hreflang block points zh-Hant-TW back to original, en to mirror
  - Inline bootstrap script forces hs_lang='en' BEFORE blog-shared.js loads,
    so DN.applyTextOnly() picks up English on first paint (no FOUC)
  - Top banner explains the article body may still be Chinese
  - og:locale flipped to en_US, og:locale:alternate to zh_TW
  - Skip 404 / offline / admin / dashboard (private/utility pages)

Run as a build step before `git push`. Idempotent — re-running overwrites
the previous /en/ directory cleanly.
"""
import os, re, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
DOMAIN = 'https://hsiao.chendermatologist.com'

SKIP = {'404.html', 'offline.html', 'admin.html', 'dashboard.html'}

EN_BANNER = '''<div id="hs-en-banner" style="background:linear-gradient(180deg,#e3edf6,#b8cfe3);border-bottom:1px solid #3a5a7c;padding:9px 18px;text-align:center;font-size:12.5px;color:#243b56;font-family:Inter,system-ui,sans-serif;line-height:1.5;font-weight:500">
  🌐 You are reading the English-mode interface. Some article body content is currently Chinese-only — full translation in progress.
  <a href="#" id="hs-en-banner-zh" style="margin-left:8px;color:#0f172a;font-weight:700;text-decoration:underline">Switch to 中文 ↗</a>
</div>'''

EN_LANG_BOOTSTRAP = '''<script>
// Force English mode for /en/ pages — runs before blog-shared.js so the
// first applyTextOnly() pass uses English (no FOUC).
try {
  localStorage.setItem('hs_lang', 'en');
  document.cookie = 'hs_lang=en;path=/;max-age=31536000;samesite=lax';
} catch (e) {}
document.addEventListener('DOMContentLoaded', function () {
  var sw = document.getElementById('hs-en-banner-zh');
  if (sw) sw.href = location.pathname.replace(/^\\/en\\//, '/').replace(/^\\/en$/, '/');
});
</script>'''


def transform(html, zh_canonical, en_canonical):
    s = html
    # 1. <html lang="en">
    s = re.sub(r'<html\s+lang="[^"]*"', '<html lang="en"', s, count=1)

    # 2. canonical → en
    new_canonical = f'{DOMAIN}{en_canonical}'
    s = re.sub(
        r'<link\s+rel="canonical"\s+href="[^"]*"\s*/?>',
        f'<link rel="canonical" href="{new_canonical}" />',
        s, count=1
    )

    # 3. Replace hreflang block — point en → self, zh-Hant-TW + x-default → original
    new_hreflang = (
        f'<link rel="alternate" hreflang="x-default" href="{DOMAIN}{zh_canonical}" />\n'
        f'<link rel="alternate" hreflang="zh-Hant-TW" href="{DOMAIN}{zh_canonical}" />\n'
        f'<link rel="alternate" hreflang="en" href="{DOMAIN}{en_canonical}" />'
    )
    # Greedy match the run of <link rel="alternate" hreflang="..."> tags
    s = re.sub(
        r'(<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*/?>\s*\n?)+',
        new_hreflang + '\n',
        s, count=1
    )

    # 4. Inject EN_LANG_BOOTSTRAP just before blog-shared.js
    s = re.sub(
        r'(<script\s+src="/blog/blog-shared\.js[^"]*"[^>]*></script>)',
        EN_LANG_BOOTSTRAP + '\n\\1',
        s
    )

    # 5. Banner after <a class="skip-link">…</a> (HsiaoEye uses a skip-link, not <main>)
    if '<a href="#main-content" class="skip-link"' in s:
        # Insert banner right before <header> so it sits at very top of viewport
        s = re.sub(
            r'(\n<header\s+class="sticky)',
            '\n' + EN_BANNER + r'\1',
            s, count=1
        )
    else:
        s = re.sub(r'(</header>)', r'\1\n' + EN_BANNER, s, count=1)

    # 6. og:locale
    if '<meta property="og:locale"' in s:
        s = re.sub(r'<meta property="og:locale" content="[^"]*"\s*/?>', '<meta property="og:locale" content="en_US" />', s, count=1)
    else:
        # Add it just before </head>
        s = s.replace('</head>', '<meta property="og:locale" content="en_US" />\n<meta property="og:locale:alternate" content="zh_TW" />\n</head>', 1)
    if '<meta property="og:locale:alternate"' in s:
        s = re.sub(r'<meta property="og:locale:alternate" content="[^"]*"\s*/?>', '<meta property="og:locale:alternate" content="zh_TW" />', s, count=1)

    return s


def main():
    n = 0
    en_dir = os.path.join(ROOT, 'en')
    blog_en_dir = os.path.join(en_dir, 'blog')
    os.makedirs(blog_en_dir, exist_ok=True)

    # Top-level HTML
    top_files = [f for f in os.listdir(ROOT)
                 if f.endswith('.html') and f not in SKIP and not f.startswith('_')]
    for f in top_files:
        zh_path = os.path.join(ROOT, f)
        if f == 'index.html':
            zh_canonical = '/'
            en_canonical = '/en/'
        else:
            stem = f[:-5]
            zh_canonical = '/' + stem
            en_canonical = '/en/' + stem
        en_path = os.path.join(en_dir, f)
        with open(zh_path, 'r', encoding='utf-8') as fp: html = fp.read()
        with open(en_path, 'w', encoding='utf-8') as fp: fp.write(transform(html, zh_canonical, en_canonical))
        n += 1

    # Blog HTML
    blog_files = [f for f in os.listdir(os.path.join(ROOT, 'blog'))
                  if f.endswith('.html')]
    for f in blog_files:
        zh_path = os.path.join(ROOT, 'blog', f)
        if f == 'index.html':
            zh_canonical = '/blog/'
            en_canonical = '/en/blog/'
        else:
            stem = f[:-5]
            zh_canonical = '/blog/' + stem
            en_canonical = '/en/blog/' + stem
        en_path = os.path.join(blog_en_dir, f)
        with open(zh_path, 'r', encoding='utf-8') as fp: html = fp.read()
        with open(en_path, 'w', encoding='utf-8') as fp: fp.write(transform(html, zh_canonical, en_canonical))
        n += 1

    print(f'Generated {n} /en/ pages')

if __name__ == '__main__':
    main()
