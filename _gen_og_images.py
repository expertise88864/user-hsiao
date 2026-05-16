#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — generate per-article 1200×630 Open Graph cards (PNG + WebP).

Why: Twitter / Facebook / LINE / Threads etc. show <meta property="og:image">
when an article URL is shared. Without per-article cards, every share looks
like the same generic icon — terrible CTR. Per-article cards let each link
preview show a unique branded card with the article title.

Strategy mirrors DermNotes' assets/og/ pattern:
  - Output: assets/og/<slug>.png (1200×630) + .webp (smaller, modern)
  - Layout: paper-cream background, magazine-style typography
      ┌─────────────────────────────────────┐
      │ EYEBROW   (tag uppercase, blue)     │
      │                                     │
      │ ARTICLE TITLE                       │
      │ in Noto Serif TC, 60pt              │
      │                                     │
      │ ── divider ──                       │
      │                                     │
      │ HsiaoEye · 蕭閔謙 醫師 · YYYY-MM-DD │
      └─────────────────────────────────────┘
  - Then update each article's <meta property="og:image"> to point at the
    per-article PNG (was previously /icon-512.png — generic).

Idempotent. Safe to re-run after adding/editing articles.
"""
import os, re
from PIL import Image, ImageDraw, ImageFont

# ── Brand palette ──
BG_COLOR     = (250, 247, 242)   # paper cream
INK_COLOR    = (15, 23, 42)      # ink-900
INK2_COLOR   = (94, 87, 78)      # ink-2
BLUE_DEEP    = (36, 59, 86)      # --blue-deep
BLUE_TINT    = (164, 196, 221)   # --teal-bright (Tiffany blue)
OCHRE        = (201, 169, 97)    # --gold
MUTED        = (139, 131, 120)   # --muted

W, H = 1200, 630
DOMAIN = 'https://hsiao.chendermatologist.com'
AUTHOR = '蕭閔謙 醫師'
SITE = 'HsiaoEye · 眼科衛教筆記'

# ── Font discovery — Windows fallback chain ──
FONT_CANDIDATES_CJK = [
    'C:/Windows/Fonts/msjh.ttc',          # Microsoft JhengHei
    'C:/Windows/Fonts/msjh.ttf',
    'C:/Windows/Fonts/msyh.ttc',          # MS YaHei (fallback)
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc',  # Linux/CI
    '/usr/share/fonts/truetype/noto/NotoSerifCJK-Bold.ttc',
    '/System/Library/Fonts/PingFang.ttc',  # macOS
]
FONT_CANDIDATES_LATIN = [
    'C:/Windows/Fonts/seguibl.ttf',  # Segoe UI Black
    'C:/Windows/Fonts/segoeuib.ttf', # Segoe UI Bold
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]

def load_font(candidates, size):
    for fp in candidates:
        if os.path.exists(fp):
            try: return ImageFont.truetype(fp, size)
            except OSError: continue
    return ImageFont.load_default()

# ── Article metadata — pulled from blog-shared.js ──
def parse_articles():
    with open('blog/blog-shared.js', 'r', encoding='utf-8') as f: js = f.read()
    m = re.search(r'DN\.ARTICLES\s*=\s*\[(.*?)\];', js, re.DOTALL)
    arts = []
    if m:
        for line in m.group(1).split('\n'):
            slug_m  = re.search(r"slug\s*:\s*'([^']+)'",     line)
            title_m = re.search(r"title\s*:\s*'([^']+)'",    line)
            ten_m   = re.search(r"title_en\s*:\s*'([^']+)'", line)
            tag_m   = re.search(r"tag\s*:\s*'([^']+)'",      line)
            ten2_m  = re.search(r"tag_en\s*:\s*'([^']+)'",   line)
            date_m  = re.search(r"date\s*:\s*'([^']+)'",     line)
            if slug_m and title_m:
                arts.append({
                    'slug':     slug_m.group(1),
                    'title':    title_m.group(1),
                    'title_en': ten_m.group(1) if ten_m else '',
                    'tag':      tag_m.group(1) if tag_m else '',
                    'tag_en':   ten2_m.group(1) if ten2_m else '',
                    'date':     date_m.group(1) if date_m else '',
                })
    return arts

# ── Wrap CJK title to fit width ──
def wrap_cjk(text, font, draw, max_width):
    """Greedy wrap by character — works for CJK because every char ~ same width."""
    lines, cur = [], ''
    for ch in text:
        test = cur + ch
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > max_width and cur:
            lines.append(cur); cur = ch
        else:
            cur = test
    if cur: lines.append(cur)
    return lines

# ── Card renderer ──
def render_card(article, out_dir):
    slug = article['slug']
    img = Image.new('RGB', (W, H), BG_COLOR)
    d = ImageDraw.Draw(img)

    # Decorative blob top-left (Tiffany blue, soft circle)
    try:
        ovl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ov_d = ImageDraw.Draw(ovl)
        ov_d.ellipse((-150, -200, 360, 310), fill=(*BLUE_TINT, 120))
        ov_d.ellipse((W - 360, H - 280, W + 200, H + 220), fill=(*OCHRE, 60))
        img = Image.alpha_composite(img.convert('RGBA'), ovl).convert('RGB')
        d = ImageDraw.Draw(img)
    except Exception:
        pass

    # Top-left: site brand
    f_brand = load_font(FONT_CANDIDATES_CJK, 26)
    d.text((68, 56), 'HsiaoEye', font=f_brand, fill=BLUE_DEEP)
    f_subbrand = load_font(FONT_CANDIDATES_CJK, 16)
    d.text((68, 92), '眼科衛教筆記', font=f_subbrand, fill=MUTED)

    # Top-right: tag chip (uppercase Latin variant for monospaced look)
    tag_en = (article['tag_en'] or article['tag'] or '').upper()
    if tag_en:
        f_tag = load_font(FONT_CANDIDATES_LATIN, 22)
        bbox = d.textbbox((0, 0), tag_en, font=f_tag)
        tw = bbox[2] - bbox[0]
        chip_x = W - 68 - tw - 36
        chip_y = 60
        d.rounded_rectangle((chip_x, chip_y, chip_x + tw + 36, chip_y + 38),
                            radius=19, fill=BLUE_DEEP)
        d.text((chip_x + 18, chip_y + 5), tag_en, font=f_tag, fill=(255, 255, 255))

    # Title (Chinese, big)
    f_title = load_font(FONT_CANDIDATES_CJK, 64)
    title = article['title']
    title_lines = wrap_cjk(title, f_title, d, W - 136)
    # Cap at 3 lines
    if len(title_lines) > 3:
        title_lines = title_lines[:3]
        title_lines[-1] = title_lines[-1][:-1] + '⋯'
    y = 220
    for line in title_lines:
        d.text((68, y), line, font=f_title, fill=INK_COLOR)
        y += 80

    # Divider
    div_y = max(440, y + 30)
    d.line((68, div_y, 320, div_y), fill=BLUE_DEEP, width=3)

    # Footer line: author · date
    f_meta = load_font(FONT_CANDIDATES_CJK, 22)
    meta_text = f'{AUTHOR}  ·  {article["date"]}  ·  {DOMAIN.replace("https://", "")}'
    d.text((68, div_y + 24), meta_text, font=f_meta, fill=INK2_COLOR)

    # English subtitle (italic-ish via lighter weight)
    if article['title_en']:
        f_en = load_font(FONT_CANDIDATES_LATIN, 24)
        en_text = article['title_en']
        bbox = d.textbbox((0, 0), en_text, font=f_en)
        if bbox[2] - bbox[0] > W - 136:
            # truncate
            while d.textbbox((0,0), en_text + '…', font=f_en)[2] > W - 136 and len(en_text) > 10:
                en_text = en_text[:-1]
            en_text = en_text + '…'
        d.text((68, div_y - 50), en_text, font=f_en, fill=BLUE_DEEP)

    # Save PNG + WebP
    os.makedirs(out_dir, exist_ok=True)
    png_path  = os.path.join(out_dir, f'{slug}.png')
    webp_path = os.path.join(out_dir, f'{slug}.webp')
    img.save(png_path,  'PNG',  optimize=True)
    img.save(webp_path, 'WEBP', quality=85, method=6)
    return png_path, webp_path

# ── Update each article HTML with per-slug og:image ──
def update_meta_og(slug):
    paths = [
        f'blog/{slug}.html',
        f'en/blog/{slug}.html',
    ]
    new_url = f'{DOMAIN}/assets/og/{slug}.png'
    for p in paths:
        if not os.path.exists(p): continue
        with open(p, encoding='utf-8') as f: text = f.read()
        old_text = text
        # og:image
        text = re.sub(
            r'<meta property="og:image" content="[^"]+" ?/?>',
            f'<meta property="og:image" content="{new_url}" />',
            text, count=1
        )
        # twitter:image (if present)
        text = re.sub(
            r'<meta name="twitter:image" content="[^"]+" ?/?>',
            f'<meta name="twitter:image" content="{new_url}" />',
            text
        )
        # Add og:image:width / height if missing (CLS hint for crawler)
        if 'og:image:width' not in text:
            text = text.replace(
                f'<meta property="og:image" content="{new_url}" />',
                f'<meta property="og:image" content="{new_url}" />\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />\n<meta property="og:image:alt" content="HsiaoEye 文章封面卡" />',
                1
            )
        if text != old_text:
            with open(p, 'w', encoding='utf-8') as f: f.write(text)
            print(f'  updated meta: {p}')

def main():
    # v37.12: --only-changed flag — skip OG regeneration for articles whose
    # PNG already exists and is newer than the source HTML. ~10x faster on
    # typical commits that only touch 1-2 articles.
    import sys
    only_changed = '--only-changed' in sys.argv

    arts = parse_articles()
    if not arts:
        print('No articles found in DN.ARTICLES — nothing to do.')
        return
    out_dir = 'assets/og'

    to_render = []
    if only_changed:
        for a in arts:
            png_path = os.path.join(out_dir, f"{a['slug']}.png")
            html_path = os.path.join('blog', f"{a['slug']}.html")
            if not os.path.exists(png_path):
                to_render.append(a)
                continue
            # Skip if PNG newer than HTML source
            try:
                if os.path.getmtime(png_path) >= os.path.getmtime(html_path):
                    continue
            except OSError:
                pass
            to_render.append(a)
        skipped = len(arts) - len(to_render)
        if skipped:
            print(f'  --only-changed: skipping {skipped} up-to-date OG cards')
    else:
        to_render = arts

    print(f'Generating {len(to_render)} OG cards into {out_dir}/...')
    for a in to_render:
        png, webp = render_card(a, out_dir)
        print(f'  ok  {png}')
        update_meta_og(a['slug'])
    print(f'Done. Generated {len(to_render)} card pairs (PNG + WebP).')

if __name__ == '__main__':
    main()
