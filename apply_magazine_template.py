"""
HsiaoEye — apply DermNotes-style magazine template:
  - new color palette: paper cream + ink black + Tiffany blue / navy
  - add Fraunces (italic serif) + JetBrains Mono fonts
  - replace existing footer with magazine footer (deep ink bg)
  - remove Email subscribe button (RSS / Atom only per spec)
  - bump cache-busting to ?v=20260506

Usage: python apply_magazine_template.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent

# ============================================================
# 1. NEW CSS VARS — replace any :root{} block
# ============================================================
NEW_ROOT = """:root{
    --bg:#faf7f2; --surface:#ffffff; --ink:#2a2620; --ink-2:#5e574e; --muted:#8b8378;
    --teal:#6b8caf; --teal-deep:#3a5a7c; --teal-bright:#a4c4dd; --mint-soft:#dcd9d1;
    --blue:#6b8caf; --blue-deep:#3a5a7c; --blue-soft:#d6e4f0;
    --gold:#c9a961; --ochre:#c9a961; --border:#dcd5c8; --line:#ebe4d8;
  }"""

ROOT_RE = re.compile(r':root\{[^}]+\}', re.DOTALL)

# ============================================================
# 2. NEW FONT LINK — Fraunces + JetBrains Mono added
# ============================================================
NEW_FONT_LINK = '''<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,500;1,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@500;700&display=swap" rel="stylesheet" />'''

FONT_LINK_RE = re.compile(
    r'<link\s+href="https://fonts\.googleapis\.com/css2\?[^"]*Noto\+Serif\+TC[^"]*"\s+rel="stylesheet"\s*/>',
    re.IGNORECASE
)

# ============================================================
# 3. MAGAZINE FOOTER — deep ink bg, serif italic brand
# ============================================================
MAG_FOOTER = '''<!-- ============= MAGAZINE FOOTER (deep ink, editorial) ============= -->
<footer class="mag-footer">
  <div class="mag-foot-top">
    <div class="mag-foot-brand">
      <h3 data-zh="HsiaoEye · 蕭閔謙醫師 眼科筆記" data-en="HsiaoEye · Dr. Min-Chien Hsiao Ophthalmology Notes">HsiaoEye · 蕭閔謙醫師 眼科筆記</h3>
      <p data-zh="從診間到日常,好好照顧你的眼睛。本網站全部衛教文章由作者親自撰寫,無業配、無贊助。" data-en="From the clinic to your everyday eyes. All notes written by Dr. Hsiao. No ads, no sponsorships.">從診間到日常,好好照顧你的眼睛。本網站全部衛教文章由作者親自撰寫,無業配、無贊助。</p>
    </div>
    <div class="mag-foot-cols">
      <div>
        <h4 data-zh="網站" data-en="Site">網站</h4>
        <ul>
          <li><a href="/" data-zh="首頁" data-en="Home">首頁</a></li>
          <li><a href="/blog/" data-zh="衛教文章" data-en="Articles">衛教文章</a></li>
          <li><a href="/about" data-zh="關於作者" data-en="About">關於作者</a></li>
        </ul>
      </div>
      <div>
        <h4 data-zh="關於" data-en="About">關於</h4>
        <ul>
          <li><a href="/about" data-zh="作者簡介" data-en="Author">作者簡介</a></li>
          <li><a href="/privacy" data-zh="隱私權政策" data-en="Privacy">隱私權政策</a></li>
          <li><a href="mailto:f94001115@gmail.com" data-zh="聯絡 Email" data-en="Contact">聯絡 Email</a></li>
        </ul>
      </div>
      <div>
        <h4 data-zh="訂閱" data-en="Subscribe">訂閱</h4>
        <ul>
          <li><a href="/blog/feed.xml">RSS Feed</a></li>
          <li><a href="/blog/atom.xml">Atom Feed</a></li>
        </ul>
      </div>
    </div>
  </div>

  <div class="mag-foot-disclaimer">
    <span class="mag-disc-tag">Disclaimer</span>
    <p data-zh="本網站內容僅作為一般醫學教育與資訊參考,不構成個別醫療建議,亦不能取代面對面的問診、檢查與處方。本站不從事醫療廣告,亦不收受任何業配或贊助;依《醫療法》§85-86 及《醫師法》§17,個別治療效果因人而異,本文不保證任何結果。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。" data-en="All content is for general educational reference only, does not constitute individual medical advice, and cannot replace an in-person consultation. This site does not engage in medical advertising and does not endorse any clinic, hospital, drug, or procedure. Per Taiwan Medical Care Act §§85–86 and Physicians Act §17, individual outcomes vary; no result is guaranteed.">本網站內容僅作為一般醫學教育與資訊參考,不構成個別醫療建議,亦不能取代面對面的問診、檢查與處方。本站不從事醫療廣告,亦不收受任何業配或贊助;依《醫療法》§85-86 及《醫師法》§17,個別治療效果因人而異,本文不保證任何結果。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。</p>
  </div>

  <div class="mag-foot-bot">
    <span>© <span id="yr">2026</span> Min-Chien Hsiao M.D. · <span data-zh="眼科衛教筆記" data-en="Ophthalmology Notes">眼科衛教筆記</span></span>
    <span data-zh="Made with patience, in Taiwan." data-en="Made with patience, in Taiwan.">Made with patience, in Taiwan.</span>
  </div>
</footer>'''

# Match any <footer ...>...</footer> block
FOOTER_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.DOTALL | re.IGNORECASE)

# ============================================================
# 4. REMOVE EMAIL SUBSCRIBE BUTTON (only the mailto: anchor with data-subscribe-link)
# ============================================================
EMAIL_BTN_RE = re.compile(
    r'<a\s+href="mailto:f94001115@gmail\.com\?subject=[^"]*"\s+data-subscribe-link[^>]*>.*?</a>',
    re.DOTALL
)

# ============================================================
# 5. CACHE BUSTING — bump version
# ============================================================
SCRIPT_RE = re.compile(r'(<script\s+src="/blog/blog-shared\.js)(\?v=[^"]*)?(")')
VERSION = '20260506'

# ============================================================
# Skip files
# ============================================================
EXTS = {'.html', '.htm'}
SKIP_DIRS = {'.git', 'node_modules', '.vercel', '__pycache__'}

def update_file(fp: Path):
    text = fp.read_text(encoding='utf-8')
    original = text
    actions = []

    # 1. CSS vars — replace any :root{} block
    if ROOT_RE.search(text):
        new_text, n = ROOT_RE.subn(NEW_ROOT, text, count=1)
        if n:
            text = new_text
            actions.append(f'css-vars({n})')

    # 2. Font link
    if FONT_LINK_RE.search(text):
        text, n = FONT_LINK_RE.subn(NEW_FONT_LINK, text, count=1)
        if n:
            actions.append(f'fonts({n})')

    # 3. Footer (replace last footer block with magazine footer)
    footers = list(FOOTER_RE.finditer(text))
    if footers:
        last = footers[-1]
        # only replace if it isn't already the magazine footer
        if 'mag-footer' not in last.group(0):
            text = text[:last.start()] + MAG_FOOTER + text[last.end():]
            actions.append('footer')

    # 4. Remove Email subscribe button
    text, n = EMAIL_BTN_RE.subn('', text)
    if n:
        actions.append(f'rm-email-btn({n})')

    # 5. Cache-busting bump
    text, n = SCRIPT_RE.subn(rf'\g<1>?v={VERSION}\g<3>', text)
    if n:
        actions.append(f'cache-bust({n})')

    if text != original:
        fp.write_text(text, encoding='utf-8')
        rel = fp.relative_to(ROOT)
        print(f'  {rel}: {", ".join(actions)}')
        return True
    return False

def walk(root: Path):
    for p in root.rglob('*'):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in EXTS and p.is_file():
            yield p

def main():
    changed = 0
    for fp in walk(ROOT):
        if update_file(fp):
            changed += 1
    print(f'\nDone. {changed} files updated.')

if __name__ == '__main__':
    main()
