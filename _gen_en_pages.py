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

# v37.29 — pull in halfwidth converter so generated /en/ files are
# automatically halfwidth-clean. Without this, the CI halfwidth gate
# fails on /en/* whenever a ZH source has halfwidth `,` inside a
# data-zh="..." attribute: BeautifulSoup re-serializes the attribute
# with single quotes in the /en/ mirror (because attribute values
# contain `"`), which slips past halfwidth_to_fullwidth.ATTR_RE
# (it only stashes double-quoted attrs).
from halfwidth_to_fullwidth import convert as _halfwidth_convert

ROOT = os.path.dirname(os.path.abspath(__file__))
DOMAIN = 'https://hsiao.chendermatologist.com'
PERSON_ID = f'{DOMAIN}/about#person'

SKIP = {'404.html', 'offline.html', 'admin.html', 'dashboard.html'}

# v37.37 — keys MUST match the EN canonical Vercel serves at 200 OK
# (no trailing slash for /en, /en/blog — vercel.json `trailingSlash:false`
# redirects /en/ → /en, and the previous /en/ keys here meant the generated
# canonical pointed at the redirecting URL → GSC "redirect error" report).
STATIC_META = {
    '/en': {
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
    '/en/blog': {
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


def truncate(s, n=135):
    # v37.30 — lowered default from 145 → 135. When the unescaped text
    # contains `'` / `"`, HTML re-encoding into the `<meta content="…">`
    # attribute expands each character to `&#x27;` / `&quot;` (6 chars),
    # easily pushing the final attribute >160 — beyond Google's snippet
    # cutoff. 135 leaves headroom for ~5 quotes (~25 extra chars) and
    # still fits comfortably under 160.
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


def parse_slug_set(name):
    fp = os.path.join(ROOT, 'blog', 'blog-shared.js')
    with open(fp, 'r', encoding='utf-8') as f:
        js = f.read()
    m = re.search(rf'DN\.{re.escape(name)}\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]', js)
    return set(re.findall(r"'([^']+)'", m.group(1))) if m else set()


EN_STUB_SLUGS = parse_slug_set('EN_STUB_SLUGS')
HREFLANG_RE = re.compile(
    r'(<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*/?>\s*\n?)+',
    re.I,
)


def normalize_zh_article_hreflang(src, zh_canonical, en_canonical, slug):
    lines = [
        f'<link rel="alternate" hreflang="x-default" href="{DOMAIN}{zh_canonical}" />',
        f'<link rel="alternate" hreflang="zh-Hant-TW" href="{DOMAIN}{zh_canonical}" />',
    ]
    if slug not in EN_STUB_SLUGS:
        lines.append(f'<link rel="alternate" hreflang="en" href="{DOMAIN}{en_canonical}" />')
    return HREFLANG_RE.sub('\n'.join(lines) + '\n', src, count=1)


def mark_unpublished_english(src):
    src = re.sub(
        r'<meta\s+name="robots"\s+content="[^"]*"\s*/?>',
        '<meta name="robots" content="noindex, follow" />',
        src,
        count=1,
        flags=re.I,
    )
    return HREFLANG_RE.sub('', src, count=1)


def en_path_for_same_site_url(url):
    if not isinstance(url, str) or not url.startswith(DOMAIN):
        return url
    if url == PERSON_ID:
        return url
    path_with_suffix = url[len(DOMAIN):] or '/'
    m = re.match(r'([^?#]*)(.*)$', path_with_suffix)
    path = m.group(1) if m else path_with_suffix
    suffix = m.group(2) if m else ''
    if path.startswith('/en/') or path == '/en':
        return url
    if path == '/':
        # v37.37 — return /en (no slash) to match what Vercel serves at 200.
        return DOMAIN + '/en' + suffix
    if path == '/blog':
        return DOMAIN + '/en/blog' + suffix
    if path.startswith('/blog/'):
        slug = path[len('/blog/'):].split('/', 1)[0]
        if slug in EN_STUB_SLUGS:
            return url
        return DOMAIN + '/en' + path + suffix
    if path in ('/about', '/tools', '/notes', '/privacy'):
        return DOMAIN + '/en' + path + suffix
    return url


# v37.10: BreadcrumbList localization — articles ship with Chinese
# breadcrumb names ("首頁", "衛教文章") in JSON-LD. For the /en/ mirror,
# Google prefers locale-matching breadcrumb labels.
_BREADCRUMB_EN_MAP = {
    '首頁': 'Home',
    '眼科文章': 'Articles',
    '衛教文章': 'Articles',
    '主題地圖': 'Topic Map',
    '關於': 'About',
    '隱私權政策': 'Privacy',
    '眼科自評量表': 'Tools',
    '學習筆記': 'Notes',
}


def translate_jsonld_value(value, _ctx_type=None):
    if isinstance(value, dict):
        out = {}
        is_breadcrumb_item = value.get('@type') == 'ListItem'
        for k, v in value.items():
            if k == 'inLanguage':
                out[k] = 'en'
            elif k == 'name' and is_breadcrumb_item and isinstance(v, str) and v in _BREADCRUMB_EN_MAP:
                out[k] = _BREADCRUMB_EN_MAP[v]
            else:
                out[k] = translate_jsonld_value(v)
        return out
    if isinstance(value, list):
        return [translate_jsonld_value(v) for v in value]
    if isinstance(value, str):
        return en_path_for_same_site_url(value)
    return value


def localize_article_jsonld(data, slug, title, desc, en_canonical):
    if not slug or slug not in ARTICLES:
        return data
    title_clean = re.sub(r'\s*\|\s*HsiaoEye\s*$', '', title or '').strip()
    if not title_clean:
        title_clean = ARTICLES[slug].get('title_en') or ARTICLES[slug].get('title') or slug
    page_url = f'{DOMAIN}{en_canonical}'

    def types_of(obj):
        value = obj.get('@type')
        if isinstance(value, list):
            return set(str(x) for x in value)
        return {str(value)} if value else set()

    def walk(obj):
        if isinstance(obj, list):
            return [walk(x) for x in obj]
        if not isinstance(obj, dict):
            return obj

        out = {k: walk(v) for k, v in obj.items()}
        type_names = types_of(out)
        if type_names & {'Article', 'BlogPosting', 'NewsArticle', 'MedicalWebPage', 'MedicalScholarlyArticle'}:
            if 'headline' in out:
                out['headline'] = title_clean
            if 'name' in out:
                out['name'] = title_clean
            if 'description' in out and desc:
                out['description'] = desc
            if 'mainEntityOfPage' in out:
                out['mainEntityOfPage'] = page_url
            if 'url' in out:
                out['url'] = page_url
        if 'ImageObject' in type_names:
            image_url = out.get('url') or out.get('contentUrl')
            if isinstance(image_url, str) and f'/assets/og/{slug}.png' in image_url:
                out['name'] = title_clean
                out['caption'] = title_clean
        if 'BreadcrumbList' in type_names:
            items = out.get('itemListElement')
            if isinstance(items, list) and items:
                last = items[-1]
                if isinstance(last, dict):
                    last['name'] = title_clean
                    last['item'] = page_url
        return out

    return walk(data)


def _page_title_label(title):
    return re.sub(r'\s*\|\s*HsiaoEye\s*$', '', title or '').strip() or 'HsiaoEye'


def _slug_from_article_url(value):
    if not isinstance(value, str):
        return ''
    m = re.search(r'/blog/([^/?#]+)', value)
    return m.group(1) if m else ''


def localize_static_page_jsonld(data, title, desc, en_canonical):
    if en_canonical not in STATIC_META:
        return data
    title_clean = _page_title_label(title)
    page_url = f'{DOMAIN}{en_canonical}'

    def walk(obj):
        if isinstance(obj, list):
            return [walk(x) for x in obj]
        if not isinstance(obj, dict):
            return obj

        out = {k: walk(v) for k, v in obj.items()}
        type_names = _jsonld_type_names(out)

        if 'WebSite' in type_names and en_canonical == '/en':
            out['name'] = 'HsiaoEye Ophthalmology Notes'
            out['url'] = page_url
            out['inLanguage'] = 'en'

        if type_names & {'Blog', 'CollectionPage', 'MedicalWebPage', 'WebPage'}:
            if 'name' in out:
                out['name'] = title_clean
            if desc and 'description' in out:
                out['description'] = desc
            if 'url' in out:
                out['url'] = page_url
            if 'inLanguage' in out:
                out['inLanguage'] = 'en'

        if 'ItemList' in type_names and en_canonical in {'/en/blog', '/en/blog/topics'}:
            out['name'] = (
                'Published ophthalmology articles'
                if en_canonical == '/en/blog'
                else 'Ophthalmology topic article list'
            )
            items = out.get('itemListElement')
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    slug = _slug_from_article_url(item.get('url') or item.get('item'))
                    article = ARTICLES.get(slug)
                    if article:
                        title_en = article.get('title_en') or article.get('title') or item.get('name')
                        has_en = slug not in EN_STUB_SLUGS
                        article_url = f'{DOMAIN}/en/blog/{slug}' if has_en else f'{DOMAIN}/blog/{slug}'
                        item['url'] = article_url
                        item['name'] = title_en if has_en else article.get('title') or title_en
                        nested = item.get('item')
                        if isinstance(nested, dict):
                            nested['@id'] = f'{article_url}#article'
                            nested['url'] = article_url
                            nested['headline'] = title_en if has_en else article.get('title') or title_en
                            nested['name'] = title_en if has_en else article.get('title') or title_en
                            nested['inLanguage'] = 'en' if has_en else 'zh-Hant-TW'
                            nested['isPartOf'] = {'@id': f'{DOMAIN}/en#website' if has_en else f'{DOMAIN}/#website'}

        if 'BreadcrumbList' in type_names:
            items = out.get('itemListElement')
            if isinstance(items, list) and items:
                first = items[0]
                if isinstance(first, dict):
                    first['name'] = 'Home'
                    first['item'] = f'{DOMAIN}/en'
                last = items[-1]
                if isinstance(last, dict):
                    last['name'] = title_clean
                    last['item'] = page_url
        return out

    return walk(data)


def _jsonld_type_names(obj):
    if not isinstance(obj, dict):
        return set()
    value = obj.get('@type')
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def _jsonld_text(value):
    if isinstance(value, dict):
        return ' '.join(_jsonld_text(v) for v in value.values())
    if isinstance(value, list):
        return ' '.join(_jsonld_text(v) for v in value)
    return str(value) if isinstance(value, str) else ''


def _cjk_ratio(value):
    if not value:
        return 0.0
    cjk = len(re.findall(r'[\u4e00-\u9fff]', value))
    return cjk / max(len(value), 1)


def _is_zh_faqpage_node(node):
    """True for a single JSON-LD node that is a predominantly-Chinese FAQPage."""
    if not isinstance(node, dict):
        return False
    if 'FAQPage' not in _jsonld_type_names(node):
        return False
    return _cjk_ratio(_jsonld_text(node)) > 0.25


def should_drop_en_jsonld(data):
    """Drop ZH FAQ rich-result markup from /en/ pages.

    The English mirror may still contain Chinese-only FAQ body sections, but
    crawler-facing FAQPage schema on an English canonical should not advertise
    Chinese questions/answers as the page's rich-result payload.

    Only answers the TOP-LEVEL question; nesting is handled by
    prune_en_jsonld(), which callers should use instead.
    """
    if isinstance(data, list):
        return False
    return _is_zh_faqpage_node(data)


def prune_en_jsonld(data):
    """Remove ZH FAQPage nodes from an /en/ JSON-LD payload, at any nesting.

    Returns ``(data, drop_block)``.

    M-08: ``should_drop_en_jsonld`` only reads the top-level ``@type``, so a
    FAQPage carried inside ``@graph: [...]`` (or a top-level array) was invisible
    and the Chinese Q&A stayed on the English canonical.

    The fix must be node-level, NOT block-level. A ``@graph`` normally also
    carries Article / BreadcrumbList / WebPage nodes that MUST survive; dropping
    the whole <script> because one member is a ZH FAQPage would destroy valid
    schema and be worse than the bug it fixes. So prune the offending members and
    keep the container — and only drop the block when nothing is left.
    """
    if isinstance(data, list):
        kept = []
        for node in data:
            pruned, drop = prune_en_jsonld(node)
            if not drop:
                kept.append(pruned)
        # An originally-empty list is not a "pruned to nothing" signal.
        return (kept, bool(data) and not kept)

    if not isinstance(data, dict):
        return (data, False)

    if _is_zh_faqpage_node(data):
        return (None, True)

    # Recurse through EVERY container-valued property, not just @graph: a ZH
    # FAQPage can also sit under WebPage.mainEntity, inside a nested @graph
    # member, or in any other array. Anything that prunes to nothing loses its
    # property rather than taking the parent down with it.
    out = {}
    for key, value in data.items():
        if isinstance(value, (dict, list)):
            pruned, drop = prune_en_jsonld(value)
            if drop:
                continue
            out[key] = pruned
        else:
            out[key] = value

    # A container whose @graph was pruned away has no schema payload left.
    if '@graph' in data and '@graph' not in out:
        return (None, True)
    return (out, False)


def update_jsonld_blocks(s, slug=None, title='', desc='', en_canonical=''):
    def repl(m):
        raw = m.group(2).strip()
        try:
            data = json.loads(raw)
        except Exception:
            return m.group(0)
        data, drop_block = prune_en_jsonld(data)
        if drop_block:
            return ''
        data = translate_jsonld_value(data)
        data = localize_static_page_jsonld(data, title, desc, en_canonical)
        data = localize_article_jsonld(data, slug, title, desc, en_canonical)
        dumped = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        return f'{m.group(1)}\n{dumped}\n</script>'
    return re.sub(r'(<script\s+type="application/ld\+json"[^>]*>)([\s\S]*?)</script>', repl, s)


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
        title_label = _page_title_label(title)
        s = replace_or_insert_meta(
            s,
            r'<meta\s+property="og:image:alt"\s+content="[^"]*"\s*/?>',
            f'<meta property="og:image:alt" content="{html_lib.escape(title_label, quote=True)}" />'
        )
        s = replace_or_insert_meta(
            s,
            r'<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*/?>',
            f'<meta name="twitter:image:alt" content="{html_lib.escape(title_label, quote=True)}" />'
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


# v37.16: swap each [data-zh][data-en] element's inner content with its
# data-en value at BUILD TIME. Previously, /en/ pages were structurally
# identical to /blog/ pages — same visible Chinese text in initial HTML,
# only swapped at runtime by JS. Googlebot indexed both as "the same
# Chinese page", which is why GSC marked /en/blog/* as duplicates and
# chose /blog/* as the canonical despite our hreflang/canonical tags.
# Now /en/ HTML carries actual English text in the visible DOM, with
# the data-zh attribute preserved for the runtime language toggle.
def _swap_inner_to_english(html_str):
    """Swap [data-zh][data-en] elements' visible inner content with their
    data-en value. Operates ONLY on the <body> region; <head> stays
    byte-identical so canonical/meta/hreflang regex checks keep working
    (BeautifulSoup's whole-document re-serialization reorders attributes
    alphabetically and normalizes void elements, which other tooling
    isn't tolerant of)."""
    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:
        raise SystemExit(
            'ERROR: beautifulsoup4 is required for /en/ generation. '
            'Install it with `pip install beautifulsoup4` before running _gen_en_pages.py.'
        ) from exc

    # Locate the body boundaries; if no <body> found, bail without mutation.
    body_open = re.search(r'<body\b[^>]*>', html_str, re.IGNORECASE)
    body_close = html_str.rfind('</body>')
    if not body_open or body_close < 0:
        return html_str

    head_and_body_tag = html_str[:body_open.end()]
    body_inner = html_str[body_open.end():body_close]
    after_body = html_str[body_close:]

    soup = BeautifulSoup(body_inner, 'html.parser')
    swaps = 0
    for el in soup.select('[data-zh][data-en]'):
        en_val = el.get('data-en', '')
        if not en_val.strip():
            continue
        # Skip <option> (lang switcher) and elements inside <select>
        if el.name == 'option':
            continue
        if el.find_parent('select'):
            continue
        # Skip if inside <script>/<style>/<noscript>
        if el.find_parent(['script', 'style', 'noscript']):
            continue
        # Replace inner HTML with EN value (parsed so <strong> etc. survive)
        el.clear()
        en_soup = BeautifulSoup(en_val, 'html.parser')
        for child in list(en_soup.contents):
            el.append(child)
        swaps += 1

    # v37.37 — large Chinese-only text runs on /en/ pages were causing
    # Google's language detector to cluster them with the ZH originals
    # (GSC duplicate-canonical reports on cataract / lacrimal articles).
    # Wrap each substantial untranslated block in lang="zh-Hant" so
    # Google's segmentation knows that subtree is Chinese and the page
    # itself is still English-dominant.
    import re as _re
    CN_CHAR_RE = _re.compile(r'[一-鿿]')
    BLOCK_TAGS = {'p', 'li', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
                  'figcaption', 'caption', 'summary', 'dt', 'dd', 'td', 'th',
                  'div'}
    annotated = 0
    for el in soup.find_all(True):
        if el.name not in BLOCK_TAGS:
            continue
        # Skip if already labelled or inside a labelled ancestor.
        if el.get('lang'):
            continue
        if any(getattr(p, 'get', lambda *_: None)('lang') for p in el.parents):
            continue
        # Skip if it has a data-en that the swap just consumed; those
        # are now English.
        if el.get('data-en'):
            continue
        if el.find_parent(['script', 'style', 'noscript']):
            continue
        text = el.get_text(' ', strip=True)
        if not text or len(text) < 15:
            continue
        cn_chars = len(CN_CHAR_RE.findall(text))
        if cn_chars < 10:
            continue   # not enough Chinese to bother labelling
        # Only label when CJK dominates this block (>= 40%).
        if cn_chars * 100 // max(len(text), 1) < 40:
            continue
        el['lang'] = 'zh-Hant'
        annotated += 1

    if swaps == 0 and annotated == 0:
        return html_str

    new_body_inner = soup.decode(formatter='html5')
    return head_and_body_tag + new_body_inner + after_body


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

    # 4. JSON-LD URLs, language, and article-facing English labels.
    s = update_jsonld_blocks(s, slug=slug, title=title, desc=desc, en_canonical=en_canonical)

    # 5. Inject EN_LANG_BOOTSTRAP just before blog-shared(.min).js.
    #    Matches both blog-shared.js and the minified blog-shared.min.js
    #    (pages ship the .min build; source stays for tooling/regex parsing).
    s = re.sub(
        r'(<script\s+src="/blog/blog-shared(?:\.min)?\.js[^"]*"[^>]*></script>)',
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
    else:
        s = re.sub(
            r'(<meta property="og:locale" content="en_US"\s*/?>)',
            r'\1\n<meta property="og:locale:alternate" content="zh_TW" />',
            s,
            count=1,
        )

    # 8. Rewrite <a href="/foo"> → <a href="/en/foo"> for any path with an
    # existing /en/ mirror. Keeps asset links (/favicon.ico, /assets/*,
    # /pagefind/*, /icon.svg, /manifest.json) and external/anchor links
    # untouched. This stops EN users from being kicked back to the ZH side
    # when they click the logo, the breadcrumb, or any nav item.
    ASSET_PREFIXES = (
        '/_vercel/', '/api/', '/assets/', '/blog/feed.xml', '/blog/atom.xml',
        '/blog/blog-shared.js', '/blog/blog-shared.min.js', '/pagefind/',
        '/favicon.ico', '/icon-', '/icon.svg',
        '/manifest.json', '/sitemap.xml', '/apple-touch-icon', '/logo-', '/sw.js',
        '/robots.txt', '/humans.txt', '/ads.txt', '/SUNN1302',
    )
    # v37.37 — keep BOTH '/blog/' (trailing-slash) and '/blog' so a ZH href
    # written either way maps to '/en/blog' (no slash). vercel.json's
    # `trailingSlash:false` strips the slash, so '/en/blog' is the URL the
    # server actually serves at 200 OK.
    PREFIXABLE_PAGES = ('/', '/about', '/privacy', '/notes', '/tools', '/blog', '/blog/', '/blog/topics')

    def _en_rewrite_href(m):
        href = m.group(1)
        if not href.startswith('/'):
            return m.group(0)
        if href.startswith('//') or href.startswith('/en/') or href == '/en':
            return m.group(0)
        # Strip query/fragment for prefix matching
        clean = href.split('?', 1)[0].split('#', 1)[0]
        # Skip asset paths
        if clean.startswith(ASSET_PREFIXES):
            return m.group(0)
        # Single-page paths: /about, /privacy, /tools, /notes, /blog, /blog/topics
        if clean in PREFIXABLE_PAGES:
            # v37.37 — emit canonical forms (no trailing slash on /en or
            # /en/blog) regardless of how the ZH source wrote them. Matches
            # what vercel.json `trailingSlash:false` actually serves at 200 OK.
            if href == '/':
                new_href = '/en'
            elif href == '/blog/' or href == '/blog':
                new_href = '/en/blog'
            else:
                new_href = '/en' + href
            return m.group(0).replace(f'href="{href}"', f'href="{new_href}"').replace(f"href='{href}'", f"href='{new_href}'")
        # /blog/<slug> articles — check if EN mirror exists
        if clean.startswith('/blog/'):
            slug_path = clean[len('/blog/'):]
            if slug_path not in EN_STUB_SLUGS and os.path.exists(os.path.join(ROOT, 'en', 'blog', f'{slug_path}.html')):
                new_href = '/en' + href
                return m.group(0).replace(f'href="{href}"', f'href="{new_href}"').replace(f"href='{href}'", f"href='{new_href}'")
        return m.group(0)

    # v37.16 — swap inner visible content from data-zh (default) to data-en
    # at build time so Googlebot indexing without JS sees genuine English.
    # This fixes the "Google chose the ZH page as canonical" GSC warning
    # for /en/blog/* duplicates. Must run BEFORE _en_rewrite_href so the
    # anchor rewriter can prefix /blog/x links that come from inside
    # data-en values.
    s = _swap_inner_to_english(s)

    s = re.sub(r'<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>', _en_rewrite_href, s)
    if slug in EN_STUB_SLUGS:
        s = mark_unpublished_english(s)

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
            # v37.37 — /en (no trailing slash) so it matches what vercel
            # actually serves at 200 OK.
            en_canonical = '/en'
        else:
            stem = f[:-5]
            zh_canonical = '/' + stem
            en_canonical = '/en/' + stem
        en_path = os.path.join(en_dir, f)
        with open(zh_path, 'r', encoding='utf-8') as fp:
            html = fp.read()
        out = transform(html, zh_canonical, en_canonical)
        out, _ = _halfwidth_convert(out)
        with open(en_path, 'w', encoding='utf-8') as fp:
            fp.write(out)
        n += 1

    blog_files = [f for f in os.listdir(os.path.join(ROOT, 'blog'))
                  if f.endswith('.html')]
    for f in blog_files:
        zh_path = os.path.join(ROOT, 'blog', f)
        if f == 'index.html':
            # v37.37 — both /blog/ and /en/blog/ get redirected by Vercel
            # (`trailingSlash:false`) to no-slash variants. Use the no-slash
            # form in canonical / hreflang for both languages.
            zh_canonical = '/blog'
            en_canonical = '/en/blog'
            slug = None
        else:
            stem = f[:-5]
            zh_canonical = '/blog/' + stem
            en_canonical = '/en/blog/' + stem
            slug = stem
        en_path = os.path.join(blog_en_dir, f)
        with open(zh_path, 'r', encoding='utf-8') as fp:
            html = fp.read()
        html = normalize_zh_article_hreflang(html, zh_canonical, en_canonical, slug)
        with open(zh_path, 'w', encoding='utf-8') as fp:
            fp.write(html)
        out = transform(html, zh_canonical, en_canonical, slug=slug)
        out, _ = _halfwidth_convert(out)
        with open(en_path, 'w', encoding='utf-8') as fp:
            fp.write(out)
        n += 1

    print(f'Generated {n} /en/ pages')


if __name__ == '__main__':
    main()
