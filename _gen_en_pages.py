#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate /en/ mirrors for public HTML pages.

The English pages are static mirrors of the Chinese canonical pages.  They
still rely on the runtime language toggle for body copy, but crawler-visible
head metadata must be English-page accurate at build time:

- html lang="en"
- canonical, og:url, hreflang, and page-level JSON-LD point to /en/ URLs
- JSON-LD inLanguage is "en"
- title / description / OG title / OG description use available English text
"""

import html as html_lib
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
DOMAIN = 'https://hsiao.chendermatologist.com'

SKIP = {'404.html', 'offline.html', 'admin.html', 'dashboard.html'}

STATIC_META = {
    '/en/': {
        'title': 'Dr. Min-Chien Hsiao Ophthalmology Notes | HsiaoEye',
        'description': 'Ophthalmology patient-education notes by Min-Chien Hsiao, MD, covering dry eye, pediatric myopia, cataract, glaucoma, retina, and common eye symptoms.'
    },
    '/en/about': {
        'title': 'About Dr. Min-Chien Hsiao | HsiaoEye',
        'description': 'Profile of Min-Chien Hsiao, MD, an ophthalmology resident in Taiwan and author of HsiaoEye patient-education notes.'
    },
    '/en/tools': {
        'title': 'Ophthalmology Calculators | HsiaoEye',
        'description': 'Five ophthalmology self-education tools: OSDI, DEQ-5, Snellen to LogMAR conversion, spherical equivalent, and floater red-flag screening.'
    },
    '/en/notes': {
        'title': 'Ophthalmology Study Notes | HsiaoEye',
        'description': 'Ophthalmology study notes for residents, medical students, and clinicians, with deeper reading beyond patient-education articles.'
    },
    '/en/privacy': {
        'title': 'Privacy Policy | HsiaoEye',
        'description': 'HsiaoEye privacy policy covering analytics, cookies, third-party services, and how visitor data is handled.'
    },
    '/en/blog/': {
        'title': 'Ophthalmology Articles | HsiaoEye',
        'description': 'A bilingual index of HsiaoEye ophthalmology patient-education articles for common eye symptoms, diseases, surgery, and red flags.'
    },
    '/en/blog/topics': {
        'title': 'Ophthalmology Topic Map | HsiaoEye',
        'description': 'Browse HsiaoEye ophthalmology articles by topic, including glaucoma, cataract, dry eye, myopia, retina, and thyroid eye disease.'
    },
}

EN_BANNER = '''<div id="hs-en-banner" style="background:linear-gradient(180deg,#e3edf6,#b8cfe3);border-bottom:1px solid #3a5a7c;padding:9px 18px;text-align:center;font-size:12.5px;color:#243b56;font-family:Inter,system-ui,sans-serif;line-height:1.5;font-weight:500">
  You are reading the English-mode interface. Some article body content is currently Chinese-only; full translation is in progress.
  <a href="#" id="hs-en-banner-zh" style="margin-left:8px;color:#0f172a;font-weight:700;text-decoration:underline">Switch to Chinese</a>
</div>'''

EN_LANG_BOOTSTRAP = '''<script>
// Force English mode for /en/ pages before blog-shared.js loads.
try {
  localStorage.setItem('hs_lang', 'en');
  document.cookie = 'hs_lang=en;path=/;max-age=31536000;samesite=lax';
} catch (e) {}
document.addEventListener('DOMContentLoaded', function () {
  var sw = document.getElementById('hs-en-banner-zh');
  if (sw) sw.href = location.pathname.replace(/^\\/en\\//, '/').replace(/^\\/en$/, '/');
});
</script>'''


def clean_text(s):
    if not s:
        return ''
    s = html_lib.unescape(s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def truncate(s, n=145):
    s = clean_text(s)
    return s if len(s) <= n else s[:n - 1].rstrip() + '...'


def parse_articles():
    fp = os.path.join(ROOT, 'blog', 'blog-shared.js')
    with open(fp, 'r', encoding='utf-8') as f:
        js = f.read()
    m = re.search(r'DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];', js)
    if not m:
        return {}
    articles = {}
    for obj in re.finditer(r'\{([\s\S]*?)\}', m.group(1)):
        body = obj.group(1)
        row = {}
        for key in ('slug', 'title', 'title_en', 'tag', 'tag_en', 'date', 'cat'):
            km = re.search(rf"{key}\s*:\s*'([^']*)'", body)
            if km:
                row[key] = km.group(1)
        if row.get('slug'):
            articles[row['slug']] = row
    return articles


ARTICLES = parse_articles()


def en_path_for_same_site_url(url):
    if not isinstance(url, str) or not url.startswith(DOMAIN):
        return url
    path = url[len(DOMAIN):] or '/'
    if path.startswith('/en/'):
        return url
    if path == '/':
        return DOMAIN + '/en/'
    if path.startswith('/blog/'):
        return DOMAIN + '/en' + path
    if path in ('/about', '/tools', '/notes', '/privacy'):
        return DOMAIN + '/en' + path
    return url


def translate_jsonld_value(value):
    if isinstance(value, dict):
        return {k: ('en' if k == 'inLanguage' else translate_jsonld_value(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [translate_jsonld_value(v) for v in value]
    if isinstance(value, str):
        return en_path_for_same_site_url(value)
    return value


def update_jsonld_blocks(s):
    def repl(m):
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
        except Exception:
            return m.group(0)
        data = translate_jsonld_value(data)
        dumped = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        return f'<script type="application/ld+json">\n{dumped}\n</script>'
    return re.sub(r'<script\s+type="application/ld\+json">([\s\S]*?)</script>', repl, s)


def replace_or_insert_meta(s, pattern, replacement):
    if re.search(pattern, s, re.I):
        return re.sub(pattern, replacement, s, count=1, flags=re.I)
    return s.replace('</head>', replacement + '\n</head>', 1)


def set_head_text(s, title, desc, en_canonical):
    if title:
        s = re.sub(r'<title>[^<]*</title>', f'<title>{html_lib.escape(title)}</title>', s, count=1)
        s = replace_or_insert_meta(
            s,
            r'<meta\s+property="og:title"\s+content="[^"]*"\s*/?>',
            f'<meta property="og:title" content="{html_lib.escape(title, quote=True)}" />'
        )
        s = replace_or_insert_meta(
            s,
            r'<meta\s+name="twitter:title"\s+content="[^"]*"\s*/?>',
            f'<meta name="twitter:title" content="{html_lib.escape(title, quote=True)}" />'
        )
    if desc:
        desc = truncate(desc)
        s = replace_or_insert_meta(
            s,
            r'<meta\s+name="description"\s+content="[^"]*"\s*/?>',
            f'<meta name="description" content="{html_lib.escape(desc, quote=True)}" />'
        )
        s = replace_or_insert_meta(
            s,
            r'<meta\s+property="og:description"\s+content="[^"]*"\s*/?>',
            f'<meta property="og:description" content="{html_lib.escape(desc, quote=True)}" />'
        )
        s = replace_or_insert_meta(
            s,
            r'<meta\s+name="twitter:description"\s+content="[^"]*"\s*/?>',
            f'<meta name="twitter:description" content="{html_lib.escape(desc, quote=True)}" />'
        )
    s = replace_or_insert_meta(
        s,
        r'<meta\s+property="og:url"\s+content="[^"]*"\s*/?>',
        f'<meta property="og:url" content="{DOMAIN}{en_canonical}" />'
    )
    return s


def extract_en_description(html):
    # Use HTMLParser instead of regex — regex `[^>]*` breaks when attribute
    # values (e.g. data-zh) contain HTML markup like <strong>...</strong>
    # because the embedded `>` terminates the [^>] character class early.
    from html.parser import HTMLParser

    class _TldrFinder(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.result = None

        def handle_starttag(self, tag, attrs):
            if self.result is not None:
                return
            if tag not in ('p', 'div'):
                return
            ad = dict(attrs)
            if 'data-en' not in ad or not ad['data-en']:
                return
            classes = (ad.get('class') or '').split()
            wanted = {'tldr', 'lead', 'ans'} if tag == 'div' else {'tldr', 'lead'}
            if any(c in wanted for c in classes):
                self.result = ad['data-en']

    p = _TldrFinder()
    try:
        p.feed(html)
    except Exception:
        pass
    return truncate(p.result) if p.result else ''


def meta_for_page(en_canonical, slug=None, html=''):
    if slug and slug in ARTICLES:
        a = ARTICLES[slug]
        title = (a.get('title_en') or a.get('title') or slug) + ' | HsiaoEye'
        desc = extract_en_description(html)
        if not desc:
            topic = a.get('tag_en') or a.get('title_en') or slug.replace('-', ' ')
            desc = f"Evidence-based ophthalmology patient education about {topic}, reviewed by Min-Chien Hsiao, MD for general learning before an eye-care visit."
        return title, desc
    meta = STATIC_META.get(en_canonical)
    if meta:
        return meta['title'], meta['description']
    return '', extract_en_description(html)


def transform(html, zh_canonical, en_canonical, slug=None):
    s = html
    title, desc = meta_for_page(en_canonical, slug, html)

    # 1. <html lang="en">
    s = re.sub(r'<html\s+lang="[^"]*"', '<html lang="en"', s, count=1)

    # 2. canonical / head metadata
    new_canonical = f'{DOMAIN}{en_canonical}'
    s = re.sub(
        r'<link\s+rel="canonical"\s+href="[^"]*"\s*/?>',
        f'<link rel="canonical" href="{new_canonical}" />',
        s, count=1
    )
    s = set_head_text(s, title, desc, en_canonical)

    # 3. Replace hreflang block.
    new_hreflang = (
        f'<link rel="alternate" hreflang="x-default" href="{DOMAIN}{zh_canonical}" />\n'
        f'<link rel="alternate" hreflang="zh-Hant-TW" href="{DOMAIN}{zh_canonical}" />\n'
        f'<link rel="alternate" hreflang="en" href="{DOMAIN}{en_canonical}" />'
    )
    s = re.sub(
        r'(<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*/?>\s*\n?)+',
        new_hreflang + '\n',
        s, count=1
    )

    # 4. JSON-LD URLs and language.
    s = update_jsonld_blocks(s)

    # 5. Inject EN_LANG_BOOTSTRAP just before blog-shared.js.
    s = re.sub(
        r'(<script\s+src="/blog/blog-shared\.js[^"]*"[^>]*></script>)',
        EN_LANG_BOOTSTRAP + '\n\\1',
        s
    )

    # 6. Banner before header.
    if '<a href="#main-content" class="skip-link"' in s:
        s = re.sub(r'(\n<header\s+class="sticky)', '\n' + EN_BANNER + r'\1', s, count=1)
    else:
        s = re.sub(r'(</header>)', r'\1\n' + EN_BANNER, s, count=1)

    # 7. Open Graph locale.
    if '<meta property="og:locale"' in s:
        s = re.sub(r'<meta property="og:locale" content="[^"]*"\s*/?>', '<meta property="og:locale" content="en_US" />', s, count=1)
    else:
        s = s.replace('</head>', '<meta property="og:locale" content="en_US" />\n<meta property="og:locale:alternate" content="zh_TW" />\n</head>', 1)
    if '<meta property="og:locale:alternate"' in s:
        s = re.sub(r'<meta property="og:locale:alternate" content="[^"]*"\s*/?>', '<meta property="og:locale:alternate" content="zh_TW" />', s, count=1)

    return s


def main():
    n = 0
    en_dir = os.path.join(ROOT, 'en')
    blog_en_dir = os.path.join(en_dir, 'blog')
    os.makedirs(blog_en_dir, exist_ok=True)

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
        with open(zh_path, 'r', encoding='utf-8') as fp:
            html = fp.read()
        with open(en_path, 'w', encoding='utf-8') as fp:
            fp.write(transform(html, zh_canonical, en_canonical))
        n += 1

    blog_files = [f for f in os.listdir(os.path.join(ROOT, 'blog'))
                  if f.endswith('.html')]
    for f in blog_files:
        zh_path = os.path.join(ROOT, 'blog', f)
        if f == 'index.html':
            zh_canonical = '/blog/'
            en_canonical = '/en/blog/'
            slug = None
        else:
            stem = f[:-5]
            zh_canonical = '/blog/' + stem
            en_canonical = '/en/blog/' + stem
            slug = stem
        en_path = os.path.join(blog_en_dir, f)
        with open(zh_path, 'r', encoding='utf-8') as fp:
            html = fp.read()
        with open(en_path, 'w', encoding='utf-8') as fp:
            fp.write(transform(html, zh_canonical, en_canonical, slug=slug))
        n += 1

    print(f'Generated {n} /en/ pages')


if __name__ == '__main__':
    main()
