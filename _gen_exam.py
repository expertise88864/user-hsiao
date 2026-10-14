"""Generate the ophthalmology board-exam review section (/exam/**) from data/exam/.

Sources (hand-maintained):
  data/exam/questions.json      1774 past board-exam MCQs, built by _exam_import.py
  data/exam/tags.json           question number -> BCSC chapters ("12-4") it tests
  data/exam/explanations.json   answers + per-option explanations with BCSC page refs
  data/exam/chapters.json       BCSC 2025-2026 sections, chapter titles, printed pages
  data/exam/notes/bcsc<b>-<c>.htm   chapter study notes (trusted HTML fragments; .htm keeps
                                    the site-wide *.html page audits off them)

Outputs (generated, never hand-edit):
  exam/index.html, exam/bcsc<b>-<c>.html, exam/practice.html, exam/review.html,
  exam/search.html, exam/exam-data.json

The question bank carries no official answer key, so an answer exists only once
explanations.json has determined it from BCSC; unanswered questions render in
browse form with a pending note and are left out of graded practice.

Pages ship no inline executable script: unknown routes get the fail-closed
fallback CSP, so all behaviour lives in exam/exam.js. The generator runs early in
the build chain (right after halfwidth_to_fullwidth.py), applies the same
punctuation normalisation itself, and lets the later injectors post-process its
output, so every chain run regenerates byte-identical pages.
"""
from __future__ import annotations

import html
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from halfwidth_to_fullwidth import convert as fullwidth

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "exam"
OUT = ROOT / "exam"
DOMAIN = "https://hsiao.chendermatologist.com"
HUB_TITLE = "眼科專科醫師考試重點及歷屆考古題"
SITE_SUFFIX = " | HsiaoEye · 蕭閔謙醫師"
REFERENCE = "AAO Basic and Clinical Science Course (BCSC) 2025–2026"
OG_IMAGE = f"{DOMAIN}/assets/og/notes.png"
TOP_N = 25


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


# Genus names (and "G. species" abbreviations) are set in italics wherever they appear.
GENERA = (
    "Staphylococcus Streptococcus Pseudomonas Neisseria Haemophilus Moraxella Chlamydia Treponema "
    "Toxoplasma Toxocara Bartonella Mycobacterium Nocardia Acanthamoeba Candida Fusarium Aspergillus "
    "Histoplasma Cryptococcus Pneumocystis Cutibacterium Propionibacterium Bacillus Serratia Klebsiella "
    "Enterococcus Escherichia Borrelia Leptospira Onchocerca Loa Cysticercus Taenia Echinococcus "
    "Microsporidia Encephalitozoon Corynebacterium Clostridium Clostridioides Listeria Rickettsia Coxiella "
    "Brucella Francisella Yersinia Acinetobacter Stenotrophomonas Actinomyces Demodex Phthirus "
    "Sporothrix Blastomyces Coccidioides Mucor Rhizopus Curvularia Alternaria Paecilomyces Trypanosoma "
    "Plasmodium Giardia Entamoeba"
).split()
EPITHETS = (
    "aureus epidermidis pneumoniae pyogenes viridans aeruginosa gonorrhoeae meningitidis influenzae "
    "catarrhalis lacunata trachomatis pallidum gondii canis cati henselae tuberculosis leprae chelonae "
    "fortuitum abscessus asteroides albicans solani fumigatus flavus capsulatum neoformans jirovecii acnes "
    "cereus marcescens faecalis coli burgdorferi interrogans volvulus loa diphtheriae difficile "
    "monocytogenes folliculorum brevis pubis schenckii dermatitidis immitis"
).split()
# A genus, optionally followed by a known species epithet, or an abbreviated "S. aureus".
TAXON_RE = re.compile(
    r"(?<![\w>])((?:" + "|".join(GENERA) + r")(?:\s(?:" + "|".join(EPITHETS) + r"))?"
    r"|[A-Z]\.\s?(?:" + "|".join(EPITHETS) + r"))(?![\w<])"
)
SIMPLIFIED = set((ROOT / "data" / "exam" / "simplified_chars.txt").read_text(encoding="utf-8").splitlines()[-1])


def taxa(text: str) -> str:
    """Italicise organism names in already-escaped text."""
    return TAXON_RE.sub(lambda m: f"<i>{m.group(1)}</i>", text)


def rich(text: str) -> str:
    return taxa(esc(text))


def taxa_html(fragment: str) -> str:
    """Italicise organism names in the text nodes of a trusted fragment, skipping <i>/<em>."""
    out, depth = [], 0
    for part in re.split(r"(<[^>]+>)", fragment):
        if part.startswith("<"):
            tag = re.match(r"</?\s*([a-z0-9]+)", part)
            if tag and tag.group(1) in ("i", "em"):
                depth += -1 if part.startswith("</") else 1
            out.append(part)
        else:
            out.append(part if depth else taxa(part))
    return "".join(out)


def check_traditional(label: str, text: str) -> None:
    bad = sorted({c for c in text if c in SIMPLIFIED})
    if bad:
        raise SystemExit(f"{label}: Simplified Chinese characters are not allowed: {''.join(bad)}")


NOTE_TAGS = {"h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "i", "mark", "br", "span", "div",
             "table", "thead", "tbody", "tr", "th", "td"}
NOTE_CLASSES = {"ref", "num", "ex-trap", "keypoint", "hs-tip-box", "hs-warn-box", "ted-table", "ex-ddx"}


def check_note_markup(key: str, fragment: str) -> None:
    for m in re.finditer(r"<\s*(/?)([a-zA-Z0-9]+)([^>]*)>", fragment):
        tag, attrs = m.group(2).lower(), m.group(3)
        if tag not in NOTE_TAGS:
            raise SystemExit(f"notes {key}: tag <{tag}> is not allowed")
        for name, value in re.findall(r'([a-zA-Z-]+)\s*=\s*"([^"]*)"', attrs):
            if name == "class" and not set(value.split()) <= NOTE_CLASSES:
                raise SystemExit(f"notes {key}: class {value!r} is not allowed")
            if name not in ("class", "id", "scope", "colspan", "rowspan"):
                raise SystemExit(f"notes {key}: attribute {name} is not allowed")


def site_version() -> str:
    match = re.search(r"/assets/app\.css\?v=(\d+)", (ROOT / "index.html").read_text(encoding="utf-8"))
    if not match:
        raise SystemExit("index.html has no app.css cache-bust version")
    return match.group(1)


# ---------------------------------------------------------------- data

def load() -> dict:
    questions = json.loads((DATA / "questions.json").read_text(encoding="utf-8"))
    tags = json.loads((DATA / "tags.json").read_text(encoding="utf-8"))
    explanations = json.loads((DATA / "explanations.json").read_text(encoding="utf-8"))
    books = json.loads((DATA / "chapters.json").read_text(encoding="utf-8"))
    chapters = {}
    for book in books:
        for ch in book["chapters"]:
            key = f"{book['book']}-{ch['ch']}"
            chapters[key] = {**ch, "book": book["book"], "bookTitle": book["title"], "key": key}
    numbers = {str(q["n"]) for q in questions}
    missing = sorted(numbers - set(tags), key=int)
    if missing:
        raise SystemExit(f"tags.json is missing {len(missing)} questions, e.g. {missing[:5]}")
    for n, tag in tags.items():
        unknown = [c for c in tag["ch"] if c not in chapters]
        if unknown or not tag["ch"]:
            raise SystemExit(f"Q{n}: bad chapter tags {tag['ch']}")
    for n, expl in explanations.items():
        if n not in numbers:
            raise SystemExit(f"explanations.json has unknown question {n}")
        keys = [it["key"] for it in expl["items"]]
        if keys != ["A", "B", "C", "D"] or sum(it["answer"] for it in expl["items"]) != 1:
            raise SystemExit(f"Q{n}: explanation needs items A-D with exactly one answer")
        if next(it["key"] for it in expl["items"] if it["answer"]) != expl["answer"]:
            raise SystemExit(f"Q{n}: answer field disagrees with items")
        for it in expl["items"]:
            for book, _page in it["refs"]:
                if not any(c["book"] == book for c in chapters.values()):
                    raise SystemExit(f"Q{n}: reference to unknown BCSC section {book}")
    for q in questions:
        check_traditional(f"Q{q['n']}", q["stem"] + "".join(q["options"].values()))
    for n, expl in explanations.items():
        check_traditional(f"explanation Q{n}", json.dumps(expl, ensure_ascii=False))
    notes = {}
    for path in sorted((DATA / "notes").glob("bcsc*.htm")):
        key = path.stem.removeprefix("bcsc")
        if key not in chapters:
            raise SystemExit(f"{path.name}: no such chapter {key}")
        notes[key] = path.read_text(encoding="utf-8")
        check_traditional(path.name, notes[key])
        check_note_markup(key, notes[key])
    by_chapter: dict[str, list] = defaultdict(list)
    for q in questions:
        for key in tags[str(q["n"])]["ch"]:
            by_chapter[key].append(q)
    return {"questions": questions, "tags": tags, "explanations": explanations, "books": books,
            "chapters": chapters, "notes": notes, "by_chapter": by_chapter}


def slug(key: str) -> str:
    return "bcsc" + key


def chapter_label(ch: dict) -> str:
    return f"BCSC {ch['book']} Ch.{ch['ch']}"


def indexable(key: str, data: dict) -> bool:
    """Only chapters with written notes are substantive enough to index (D-02)."""
    return key in data["notes"]


# ---------------------------------------------------------------- page shell

HEADER_LINK = 'class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)"'


def font_bootstrap() -> str:
    """The site's non-blocking font loader (preload + noscript + inline swap), copied
    byte-for-byte from 404.html. /exam routes are not in the CSP route map, so they get
    the fallback (404) hashes; reusing the identical inline script keeps it allowed."""
    src = (ROOT / "404.html").read_text(encoding="utf-8")
    match = re.search(r'<link rel="preload" as="style" href="https://fonts\.googleapis\.com[^>]*id="hs-fonts" />'
                      r"<noscript>.*?</noscript><script>.*?</script>", src, re.S)
    if not match:
        raise SystemExit("404.html no longer carries the hs-fonts bootstrap that /exam pages reuse")
    return match.group(0)


def head(*, title: str, description: str, path: str, robots: str, jsonld: list[dict], version: str) -> str:
    url = DOMAIN + path
    full_title = title + SITE_SUFFIX
    hreflang = ""
    if robots.startswith("index"):
        hreflang = (f'<link rel="alternate" hreflang="zh-Hant-TW" href="{url}" />\n'
                    f'<link rel="alternate" hreflang="x-default" href="{url}" />\n')
    blocks = "".join(
        '<script type="application/ld+json">'
        + json.dumps(block, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        + "</script>\n"
        for block in jsonld
    )
    return (
        "<!doctype html>\n"
        '<html lang="zh-Hant-TW">\n<head>\n'
        f'<script src="/assets/trusted-types.js?v={version}"></script>\n'
        '<meta charset="UTF-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />\n'
        f"<title>{esc(full_title)}</title>\n"
        f'<meta name="description" content="{esc(description)}" />\n'
        '<meta name="theme-color" content="#3a5a7c" />\n'
        f'<meta name="robots" content="{robots}" />\n'
        f'<link rel="canonical" href="{url}" />\n'
        f"{hreflang}"
        '<link rel="icon" type="image/svg+xml" href="/icon.svg" />\n'
        '<link rel="icon" sizes="any" href="/favicon.ico" />\n'
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />\n'
        '<link rel="manifest" href="/manifest.json" />\n'
        '<meta property="og:type" content="website" />\n'
        f'<meta property="og:url" content="{url}" />\n'
        f'<meta property="og:title" content="{esc(full_title)}" />\n'
        f'<meta property="og:description" content="{esc(description)}" />\n'
        f'<meta property="og:image" content="{OG_IMAGE}" />\n'
        '<meta property="og:image:width" content="1200" />\n'
        '<meta property="og:image:height" content="630" />\n'
        '<meta property="og:locale" content="zh_TW" />\n'
        '<meta property="og:site_name" content="HsiaoEye" />\n'
        '<meta name="twitter:card" content="summary_large_image" />\n'
        f'<meta name="twitter:title" content="{esc(full_title)}" />\n'
        f'<meta name="twitter:image" content="{OG_IMAGE}" />\n'
        f"{blocks}"
        '<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
        f"{font_bootstrap()}\n"
        f'<link rel="stylesheet" href="/assets/app.css?v={version}">\n'
        f"{EXAM_STYLE}"
        f'<script defer src="/assets/telemetry.js?v={version}"></script>\n'
        "</head>\n"
    )


def header() -> str:
    return (
        '<header class="sticky top-0 z-40 backdrop-blur border-b" style="background:rgba(250,247,242,.92); border-color:var(--border)">\n'
        '  <div class="max-w-6xl mx-auto px-5 sm:px-8">\n'
        '    <div class="h-16 flex items-center justify-between gap-4">\n'
        '      <a href="/" class="flex items-center gap-3 min-w-0">\n'
        '        <img src="/icon.svg" alt="HsiaoEye" class="w-9 h-9 rounded-lg flex-shrink-0" width="36" height="36" fetchpriority="high" decoding="async" loading="eager">\n'
        '        <div class="min-w-0 leading-tight">\n'
        '          <div class="font-display font-semibold text-[16px] sm:text-[18px] blue-text">HsiaoEye</div>\n'
        '          <div class="text-[10.5px] sm:text-[11.5px] mt-0.5 truncate" style="color:var(--muted)" data-zh="蕭閔謙醫師 · 眼科衛教筆記" data-en="Dr. Min-Chien Hsiao · Ophthalmology Notes">蕭閔謙醫師 · 眼科衛教筆記</div>\n'
        "        </div>\n"
        "      </a>\n"
        '      <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">\n'
        f'        <a href="/blog" {HEADER_LINK} data-zh="衛教文章" data-en="Articles">衛教文章</a>\n'
        f'        <a href="/exam" aria-current="page" {HEADER_LINK} data-zh="眼科專科醫師考試" data-en="Board Exam">眼科專科醫師考試</a>\n'
        f'        <a href="/tools" {HEADER_LINK} data-zh="量表" data-en="Tools">量表</a>\n'
        '        <button type="button" aria-label="搜尋" title="搜尋 (Cmd/Ctrl + K)" class="inline-flex items-center justify-center w-9 h-9 rounded-full" style="background:#fff;border:1px solid var(--border);color:var(--blue-deep)">\n'
        '          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>\n'
        "        </button>\n"
        '        <select id="langToggle" class="lang-select" aria-label="Language">\n'
        '          <option value="zh">中文</option><option value="en">EN</option>\n'
        "        </select>\n"
        "      </div>\n"
        "    </div>\n"
        "  </div>\n"
        "</header>\n"
    )


FOOTER = """<footer class="mag-footer cv-auto-short">
  <div class="mag-foot-top">
    <div class="mag-foot-brand">
      <h2 class="mag-foot-brand-h3" data-zh="HsiaoEye<br>蕭閔謙醫師 眼科筆記" data-en="HsiaoEye<br>Dr. Min-Chien Hsiao · Ophthalmology Notes">HsiaoEye<br>蕭閔謙醫師 眼科筆記</h2>
      <p data-zh="從診間到日常，好好照顧你的眼睛。" data-en="From the clinic to your everyday eyes.">從診間到日常，好好照顧你的眼睛。</p>
    </div>
    <div class="mag-foot-cols">
      <div><h3 data-zh="網站" data-en="Site">網站</h3><ul><li><a href="/" data-zh="首頁" data-en="Home">首頁</a></li><li><a href="/blog" data-zh="衛教文章" data-en="Articles">衛教文章</a></li><li><a href="/exam" data-zh="眼科專科醫師考試" data-en="Board Exam">眼科專科醫師考試</a></li><li><a href="/about" data-zh="關於作者" data-en="About">關於作者</a></li></ul></div>
      <div><h3 data-zh="關於" data-en="About">關於</h3><ul><li><a href="/privacy" data-zh="隱私權政策" data-en="Privacy">隱私權政策</a></li><li><a href="mailto:f94001115@gmail.com" data-zh="聯絡 Email" data-en="Contact">聯絡 Email</a></li></ul></div>
      <div><h3 id="dn-subscribe" data-zh="訂閱" data-en="Subscribe">訂閱</h3><ul><li><a href="/blog/feed.xml">RSS Feed</a></li><li><a href="/blog/atom.xml">Atom Feed</a></li></ul></div>
    </div>
  </div>
  <div class="mag-foot-bot">
    <span>© <span id="yr">2026</span> Min-Chien Hsiao M.D. · <span data-zh="眼科衛教筆記" data-en="Ophthalmology Notes">眼科衛教筆記</span></span>
    <span data-zh="Made with patience, in Taiwan." data-en="Made with patience, in Taiwan.">Made with patience, in Taiwan.</span>
  </div>
</footer>
"""


def breadcrumb(items: list[tuple[str, str]], path: str) -> dict:
    return {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "@id": f"{DOMAIN}{path}#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": DOMAIN + href}
            for i, (name, href) in enumerate(items)
        ],
    }


def crumbs_html(items: list[tuple[str, str]]) -> str:
    parts = []
    for i, (name, href) in enumerate(items):
        parts.append(f"<span>{esc(name)}</span>" if i == len(items) - 1 else f'<a href="{href}">{esc(name)}</a>')
    sep = '<span class="ex-sep" aria-hidden="true">/</span>'
    return f'<nav class="ex-crumbs" aria-label="麵包屑">{sep.join(parts)}</nav>'


TITLE_MAX = 70   # validate.py --strict warns above these (escaped length)
DESC_MAX = 160


def fit(text: str, limit: int) -> str:
    """Shorten text (with an ellipsis) so its HTML-escaped form fits in limit characters."""
    if len(esc(text)) <= limit:
        return text
    while text and len(esc(text)) > limit - 1:
        text = text[:-1]
    return text.rstrip(" ,:–-") + "…"


def page(*, path, title, description, crumbs, schema_type, body, kind, robots, version) -> str:
    if len(esc(title + SITE_SUFFIX)) > TITLE_MAX or not 50 <= len(esc(description)) <= DESC_MAX:
        raise SystemExit(f"{path}: title/description outside validate.py limits")
    items = [("首頁", "/"), ("專科考試", "/exam")] + crumbs
    jsonld = [
        {"@context": "https://schema.org", "@type": schema_type, "@id": f"{DOMAIN}{path}#webpage",
         "name": title, "description": description, "url": DOMAIN + path, "inLanguage": "zh-Hant-TW",
         "isPartOf": {"@id": f"{DOMAIN}/#website"}, "publisher": {"@id": f"{DOMAIN}/about#person"},
         "audience": {"@type": "MedicalAudience", "audienceType": ["MedicalResident", "Resident"]},
         "breadcrumb": {"@id": f"{DOMAIN}{path}#breadcrumb"}},
        breadcrumb(items, path),
    ]
    out = (
        head(title=title, description=description, path=path, robots=robots, jsonld=jsonld, version=version)
        + f'<body class="hs-exam" data-exam-page="{kind}">\n'
        + header()
        + f'<main id="main-content" class="ex-main max-w-3xl mx-auto px-5 sm:px-8 pt-10 pb-16">{crumbs_html(items)}{body}</main>\n'
        + FOOTER
        + f'<script src="/blog/blog-shared.min.js?v={version}" defer></script>\n'
        + f'<script src="/exam/exam.js?v={version}" defer></script>\n'
        + "</body>\n</html>\n"
    )
    return fullwidth(out)[0]


MODE_BAR = (
    '<div class="ex-toolbar" role="group" aria-label="作答模式">'
    '<button type="button" class="ex-mode" data-mode="quiz" aria-pressed="false">作答模式</button>'
    '<button type="button" class="ex-mode" data-mode="browse" aria-pressed="true">瀏覽模式</button>'
    '<span class="ex-toolbar-hint">作答模式：選完送出才顯示答案與詳解。瀏覽模式：直接顯示答案與詳解。</span>'
    "</div>"
)


# ---------------------------------------------------------------- questions

def ref_label(ref) -> str:
    book, pages = ref
    return f"BCSC {book} p.{pages}"


def chip_html(key: str, n: int, current: str | None, data: dict) -> str:
    book, ch = key.split("-")
    label = f"BCSC {book} · Ch.{ch}"
    title = esc(data["chapters"][key]["title"])
    if key == current:
        return f'<span class="ex-chip ex-chip-on" title="{title}">{esc(label)}</span>'
    return f'<a class="ex-chip" href="/exam/{slug(key)}#q-{n}" title="{title}">{esc(label)}</a>'


def question_html(q: dict, data: dict, *, current: str | None = None) -> str:
    n = q["n"]
    expl = data["explanations"].get(str(n))
    answer = expl["answer"] if expl else ""
    chips = "".join(chip_html(k, n, current, data) for k in data["tags"][str(n)]["ch"])
    figure = ""
    if q.get("image"):
        img = q["image"]
        figure = (f'<img class="ex-fig" src="{img["src"]}" alt="第 {n} 題附圖" width="{img["width"]}" '
                  f'height="{img["height"]}" loading="lazy" decoding="async">')
    opts = "".join(
        f'<label class="ex-opt" data-key="{k}"{" data-correct" if k == answer else ""}>'
        f'<input type="radio" name="ans-{n}" value="{k}"{"" if expl else " disabled"}>'
        f'<span class="ex-opt-key">{k}</span><span class="ex-opt-text">{rich(v)}</span></label>'
        for k, v in q["options"].items()
    )
    if expl:
        items = "".join(
            f'<li class="{"ex-ok" if it["answer"] else "ex-no"}"><span class="ex-item-key">{it["key"]}</span>'
            f'<span class="ex-item-label">{esc(it["label"])}</span>'
            f'<span class="ex-item-text">{rich(it["text"])}</span>'
            f'<span class="ex-item-refs">{"；".join(f"<span class=\"ex-ref\">{esc(ref_label(r))}</span>" for r in it["refs"])}</span></li>'
            for it in expl["items"]
        )
        flags = "".join(f'<p class="ex-warn">⚠ {rich(f)}</p>' for f in expl.get("flags", []))
        reveal = (f'<p class="ex-answer">答案：<strong>{answer}</strong><span class="ex-answer-src">依 BCSC 判斷</span></p>'
                  f'<p class="ex-summary">{rich(expl["summary"])}</p><ul class="ex-items">{items}</ul>{flags}')
        actions = ('<div class="ex-actions"><button type="button" class="ex-submit">送出答案</button>'
                   '<button type="button" class="ex-reset">重新作答</button>'
                   '<span class="ex-result" aria-live="polite"></span></div>')
    else:
        reveal = '<p class="ex-pending">這題的答案與詳解尚未整理（讀到相關章節時會補上）。</p>'
        actions = '<div class="ex-actions"><span class="ex-result">尚未整理答案，暫時無法作答。</span></div>'
    return (
        f'<article class="ex-q{"" if expl else " ex-unanswered"}" id="q-{n}" data-qid="{n}" data-answer="{answer}">'
        f'<div class="ex-q-head"><span class="ex-q-no">第 {n} 題</span><span class="ex-chips">{chips}</span></div>'
        f'<p class="ex-stem">{rich(q["stem"])}</p>{figure}'
        f'<fieldset class="ex-opts"><legend class="ex-sr">第 {n} 題選項</legend>{opts}</fieldset>'
        f'{actions}<div class="ex-reveal">{reveal}</div></article>'
    )


def expand_hits(fragment: str, key: str, on_page: set[int]) -> str:
    def repl(m: re.Match) -> str:
        nums = [int(i) for i in re.split(r"\s*,\s*", m.group(1).strip()) if i]
        bad = [i for i in nums if i not in on_page]
        if bad:
            raise SystemExit(f"notes {key}: {{{{q:...}}}} cites questions not on this chapter page: {bad}")
        links = "、".join(f'<a href="#q-{i}">第 {i} 題</a>' for i in nums)
        return f'<span class="ex-hit">考過：{links}</span>'
    out = re.sub(r"\{\{q:([0-9,\s]+)\}\}", repl, fragment)
    if "{{" in out:
        raise SystemExit(f"notes {key}: unexpanded placeholder")
    return out


# ---------------------------------------------------------------- pages

def chapter_page(data: dict, key: str, version: str) -> str:
    ch = data["chapters"][key]
    qs = data["by_chapter"].get(key, [])
    note = data["notes"].get(key)
    if note:
        toc = "".join(
            f'<li><a href="#{hid}">{esc(html.unescape(re.sub(r"<[^>]+>", "", text)).strip())}</a></li>'
            for hid, text in re.findall(r'<h2[^>]*\sid="([^"]+)"[^>]*>(.*?)</h2>', note, re.S)
        )
        toc_html = (f'<nav class="ex-toc" aria-label="章節目錄"><p class="ex-toc-h">章節目錄</p><ol>{toc}'
                    '<li><a href="#qs-h">歷屆考題</a></li></ol></nav>') if toc else ""
        notes_html = (f'<section class="ex-notes" aria-labelledby="notes-h"><h2 id="notes-h" class="ex-h2">課本重點整理</h2>{toc_html}'
                      f'<p class="ex-meta">依 BCSC {ch["book"]} 第 {ch["ch"]} 章自行摘要整理，非原文；'
                      f'<span class="ex-ref">p.</span> 標示為原書印刷頁碼。</p>'
                      f'<div class="ex-note">{taxa_html(expand_hits(note, key, {q["n"] for q in qs}))}</div></section>')
    else:
        notes_html = ('<section class="ex-notes" aria-labelledby="notes-h"><h2 id="notes-h" class="ex-h2">課本重點整理</h2>'
                      '<p class="ex-pending">這一章的重點尚未整理。</p></section>')
    if qs:
        q_html = MODE_BAR + "".join(question_html(q, data, current=key) for q in qs)
    else:
        q_html = '<p class="ex-pending">歷屆題庫中沒有標到這一章的題目。</p>'
    body = (
        f'<p class="ex-kicker">BCSC {ch["book"]} · {esc(ch["bookTitle"])}</p>'
        f'<h1 class="ex-h1">Ch.{ch["ch"]} {esc(ch["title"])}</h1>'
        f'<p class="ex-meta">原書 p.{esc(ch["pages"])} · 歷屆考題 {len(qs)} 題</p>'
        f"{notes_html}"
        f'<section aria-labelledby="qs-h"><h2 id="qs-h" class="ex-h2">歷屆考題</h2>{q_html}</section>'
    )
    head_label = f"BCSC {ch['book']} Ch.{ch['ch']} "
    title = head_label + fit(ch["title"], TITLE_MAX - len(SITE_SUFFIX) - len(head_label) - len("：重點與考古題")) + "：重點與考古題"
    tail = ("的課本重點整理，" if note else "，") + f"以及標到本章的歷屆考題 {len(qs)} 題。"
    lead = f"眼科專科醫師考試讀書筆記：BCSC 2025–2026 第 {ch['book']} 冊第 {ch['ch']} 章 "
    desc = lead + fit(ch["title"], DESC_MAX - len(lead) - len(tail)) + tail
    return page(path=f"/exam/{slug(key)}", title=title, description=desc,
                crumbs=[(f"BCSC {ch['book']} Ch.{ch['ch']}", f"/exam/{slug(key)}")], schema_type="WebPage",
                body=body, kind="chapter", version=version,
                robots="index,follow,max-image-preview:large" if indexable(key, data) else "noindex,follow")


def hub_page(data: dict, version: str) -> str:
    chapters, by_chapter = data["chapters"], data["by_chapter"]
    ranked = sorted(by_chapter.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:TOP_N]
    peak = len(ranked[0][1]) if ranked else 1
    badge = '<span class="ex-badge">有重點</span>'
    rows = "".join(
        f'<tr><td><a href="/exam/{slug(k)}">BCSC {chapters[k]["book"]} Ch.{chapters[k]["ch"]} {esc(chapters[k]["title"])}</a>'
        f'{" " + badge if k in data["notes"] else ""}</td><td class="ex-num">{len(qs)}</td>'
        f'<td class="ex-bar-cell"><span class="ex-bar" style="width:{round(100 * len(qs) / peak)}%"></span></td></tr>'
        for k, qs in ranked
    )
    books_html = []
    for book in data["books"]:
        items = []
        count = 0
        for ch in book["chapters"]:
            key = f"{book['book']}-{ch['ch']}"
            n = len(by_chapter.get(key, []))
            count += n
            label = f"Ch.{ch['ch']} {esc(ch['title'])}"
            extra = f' <span class="ex-count">{n} 題</span>' + (" " + badge if key in data["notes"] else "")
            items.append(f'<li><a href="/exam/{slug(key)}">{label}</a>{extra}</li>' if n or key in data["notes"]
                         else f'<li class="ex-none">{label}{extra}</li>')
        books_html.append(
            f'<details class="ex-part"><summary>BCSC {book["book"]} {esc(book["title"])} '
            f'<span class="ex-count">{count} 題次</span></summary><ul class="ex-chapter-list">{"".join(items)}</ul></details>'
        )
    body = (
        f'<h1 class="ex-h1">{HUB_TITLE}</h1>'
        f'<p class="ex-lead">依 {esc(REFERENCE)} 章節整理課本重點，並把歷屆考題標到每一題考到的所有章節；'
        "讀完一章就能在同一頁快速複習重點與考古題。陸續更新中。</p>"
        '<ul class="ex-tools">'
        '<li><a class="ex-cta" href="/exam/practice">模擬考：自選範圍／隨機出題</a></li>'
        '<li><a class="ex-cta ex-cta-alt" href="/exam/review">錯題本與 Anki 匯出</a></li>'
        '<li><a class="ex-cta ex-cta-alt" href="/exam/search">搜尋重點與考題</a></li></ul>'
        + f'<h2 class="ex-h2">出題頻率：最常考的 {TOP_N} 章</h2>'
        '<p class="ex-meta">一題可能同時考到多章，會計入每一章，所以加總會超過題數。題庫沒有年份資訊，這裡統計的是累計題數。</p>'
        '<table class="ex-rank"><thead><tr><th scope="col">章節</th><th scope="col">題數</th>'
        '<th scope="col"><span class="ex-sr">相對比例</span></th></tr></thead>'
        f"<tbody>{rows}</tbody></table>"
        '<h2 class="ex-h2">依 BCSC 章節瀏覽</h2>' + "".join(books_html)
    )
    desc = ("眼科專科醫師考試讀書筆記：依 BCSC 2025–2026 章節整理課本重點，收錄歷屆考題並標註所屬章節，"
            "附出題頻率統計、作答與瀏覽模式、模擬考、錯題本、搜尋與 Anki 匯出。")
    return page(path="/exam", title=HUB_TITLE, description=desc, crumbs=[], schema_type="CollectionPage",
                body=body, kind="hub", robots="index,follow,max-image-preview:large", version=version)


def practice_page(data: dict, version: str) -> str:
    per_book = defaultdict(int)
    for q in data["questions"]:
        for b in {data["chapters"][k]["book"] for k in data["tags"][str(q["n"])]["ch"]}:
            per_book[b] += 1
    boxes = "".join(
        f'<label class="ex-check"><input type="checkbox" name="ex-book" value="{b["book"]}" checked> '
        f'BCSC {b["book"]} <span class="ex-count">（{per_book.get(b["book"], 0)} 題）</span></label>'
        for b in data["books"]
    )
    body = (
        '<p class="ex-kicker">模擬考</p><h1 class="ex-h1">自選範圍／隨機出題</h1>'
        '<p class="ex-meta">一題考到多冊時，勾選其中任一冊就會被抽到。尚未整理答案的題目一樣會出，'
        "但交卷時不計分，只顯示題目供自我練習。</p>"
        '<form class="ex-practice-form" data-practice-form>'
        '<fieldset class="ex-fieldset"><legend>出題範圍（BCSC 冊別）</legend>'
        f'<div class="ex-checks">{boxes}</div>'
        '<div class="ex-toolbar"><button type="button" class="ex-books-all">全選</button>'
        '<button type="button" class="ex-books-none">全不選</button></div>'
        '<label class="ex-check"><input type="checkbox" name="ex-answered-only"> 只出已整理答案、可計分的題目</label></fieldset>'
        '<fieldset class="ex-fieldset"><legend>題數</legend>'
        '<select name="ex-count" class="ex-select" aria-label="題數">'
        '<option value="10">10 題</option><option value="25">25 題</option><option value="50" selected>50 題</option>'
        '<option value="100">100 題</option><option value="0">全部</option></select></fieldset>'
        '<fieldset class="ex-fieldset"><legend>出題順序</legend>'
        '<label class="ex-check"><input type="radio" name="ex-order" value="random" checked> 隨機</label>'
        '<label class="ex-check"><input type="radio" name="ex-order" value="number"> 依題號</label></fieldset>'
        '<div class="ex-toolbar"><button type="button" class="ex-build">產生試卷並開始計時</button>'
        '<span class="ex-build-note" aria-live="polite"></span></div></form>'
        '<div class="ex-exam-bar" data-exam-bar hidden>'
        '<span class="ex-timer" aria-live="off">00:00</span>'
        '<button type="button" class="ex-finish">交卷並計分</button>'
        '<span class="ex-score" aria-live="polite"></span></div>'
        '<div id="ex-practice-list" class="ex-list">'
        '<p class="ex-pending">選好範圍、題數與順序後按「產生試卷」。這個功能需要啟用 JavaScript。</p></div>'
    )
    return page(path="/exam/practice", title="眼科專科考試模擬考：自選範圍與隨機出題",
                description="眼科專科醫師考試模擬考：從歷屆考題中自選 BCSC 冊別與題數，隨機或依題號出題，計時作答、交卷計分，並對照答案與 BCSC 詳解。",
                crumbs=[("模擬考", "/exam/practice")], schema_type="WebPage", body=body, kind="practice",
                robots="noindex,follow", version=version)


def review_page(version: str) -> str:
    body = (
        '<p class="ex-kicker">複習工具</p><h1 class="ex-h1">錯題本與 Anki 匯出</h1>'
        '<p class="ex-meta">在作答模式答錯的題目會自動記在這台裝置的瀏覽器裡（不同電腦或手機不會同步）。答對後可以把題目移出錯題本。</p>'
        '<div class="ex-toolbar"><button type="button" class="ex-anki" data-scope="wrong">錯題匯出 Anki（CSV）</button>'
        '<button type="button" class="ex-anki" data-scope="answered">已整理題目匯出 Anki（CSV）</button>'
        '<button type="button" class="ex-clear-wrong">清空錯題本</button></div>'
        '<p class="ex-meta">Anki 匯入：檔案 → 匯入，欄位分隔選逗號，第一欄為正面、第二欄為背面，並勾選「允許在欄位中使用 HTML」。</p>'
        f"{MODE_BAR}"
        '<div id="ex-review-list" class="ex-list"><p class="ex-pending">目前沒有錯題，或瀏覽器停用了 JavaScript。</p></div>'
    )
    return page(path="/exam/review", title="眼科專科考試錯題本與 Anki 匯出",
                description="眼科專科醫師考試讀書筆記的錯題本：集中重練作答模式答錯的歷屆考題，並可把題目與詳解匯出成 Anki 卡片。",
                crumbs=[("錯題本", "/exam/review")], schema_type="WebPage", body=body, kind="review",
                robots="noindex,follow", version=version)


def search_page(version: str) -> str:
    body = (
        '<p class="ex-kicker">搜尋</p><h1 class="ex-h1">搜尋課本重點與歷屆考題</h1>'
        '<form class="ex-search" role="search" data-search-form>'
        '<label class="ex-sr" for="ex-q">關鍵字</label>'
        '<input id="ex-q" name="q" type="search" class="ex-input" placeholder="例如 HLA-B*1502、AREDS2、Protocol T" autocomplete="off">'
        '<button type="submit" class="ex-cta-btn">搜尋</button></form>'
        '<p class="ex-meta">同時搜尋題幹、選項、詳解與各章重點整理；英文不分大小寫，多個關鍵字以空白分隔（需全部符合）。</p>'
        '<div id="ex-search-results" class="ex-list" aria-live="polite"></div>'
    )
    return page(path="/exam/search", title="搜尋眼科專科考試重點與歷屆考題",
                description="在眼科專科醫師考試讀書筆記中搜尋關鍵字，例如藥名、試驗名稱或基因，同時找出相關的 BCSC 課本重點整理與歷屆考題詳解。",
                crumbs=[("搜尋", "/exam/search")], schema_type="WebPage", body=body, kind="search",
                robots="noindex,follow", version=version)


def note_text(fragment: str) -> list[dict]:
    """Split a notes fragment into searchable paragraphs keyed by their section heading."""
    out, heading = [], ""
    for m in re.finditer(r"<(h2|h3|li|p|td)\b[^>]*?(?:\sid=\"([^\"]+)\")?[^>]*>(.*?)</\1>", fragment, re.S):
        text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"\{\{q:[^}]*\}\}", "", m.group(3)))).strip()
        text = re.sub(r"\s+", " ", text)
        if m.group(1) == "h2":
            heading = m.group(2) or ""
        if text and m.group(1) in ("li", "p", "td"):
            out.append({"h": heading, "t": text})
    return out


def client_data(data: dict) -> dict:
    questions = []
    for q in data["questions"]:
        row = {"n": q["n"], "stem": q["stem"], "options": q["options"], "ch": data["tags"][str(q["n"])]["ch"]}
        if q.get("image"):
            row["image"] = q["image"]
        expl = data["explanations"].get(str(q["n"]))
        if expl:
            row["answer"] = expl["answer"]
            row["expl"] = {"summary": expl["summary"], "flags": expl.get("flags", []), "items": [
                {"key": it["key"], "label": it["label"], "text": it["text"], "ok": it["answer"],
                 "refs": [ref_label(r) for r in it["refs"]]} for it in expl["items"]]}
        questions.append(row)
    chapters = {k: {"label": f"BCSC {c['book']} Ch.{c['ch']}", "title": c["title"]} for k, c in data["chapters"].items()}
    notes = {k: note_text(v) for k, v in data["notes"].items()}
    return {"questions": questions, "chapters": chapters, "notes": notes, "taxa": TAXON_RE.pattern}


def build() -> dict[str, str]:
    data = load()
    version = site_version()
    files: dict[str, str] = {"index.html": hub_page(data, version)}
    for key in data["chapters"]:
        if data["by_chapter"].get(key) or key in data["notes"]:
            files[f"{slug(key)}.html"] = chapter_page(data, key, version)
    files["practice.html"] = practice_page(data, version)
    files["review.html"] = review_page(version)
    files["search.html"] = search_page(version)
    files["exam-data.json"] = json.dumps(client_data(data), ensure_ascii=False, separators=(",", ":")) + "\n"
    files["../api/_exam_routes.js"] = routes_module(data)
    return files


def indexed_routes(data: dict | None = None) -> list[str]:
    """Indexable exam routes, for the sitemap generators (_gen_feeds.py, api/sitemap.js)."""
    data = data or load()
    return ["/exam"] + [f"/exam/{slug(k)}" for k in data["chapters"] if indexable(k, data)]


def routes_module(data: dict) -> str:
    rows = []
    for route in indexed_routes(data):
        priority = "0.8" if route == "/exam" else "0.6"
        rows.append(f"  {{ url: '{route}', priority: '{priority}', changefreq: 'monthly', has_en: false }},")
    lines = ["// Generated by _gen_exam.py — do not edit. Indexable /exam routes for api/sitemap.js.",
             "export const EXAM_ROUTES = [", *rows, "];"]
    return "\n".join(lines) + "\n"


EXAM_STYLE = """<style data-exam-style>
:root{--bg:#faf7f2;--surface:#fff;--ink:#2a2620;--ink-2:#5e574e;--muted:#8b8378;--teal-deep:#3a5a7c;--blue-deep:#3a5a7c;--blue-soft:#d6e4f0;--border:#dcd5c8;--line:#ebe4d8;--ex-accent:#3a5a7c;--ex-card:#fff;--ex-soft:#eef3f8}
html,body{background:var(--bg);color:var(--ink);font-family:Inter,'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif}
.blue-text{background:linear-gradient(180deg,#6b8caf 0%,#243b56 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.lang-select{appearance:none;-webkit-appearance:none;padding:6px 26px 6px 12px;font-size:12px;font-weight:600;color:var(--ink);border:1px solid var(--border);border-radius:9999px;background:#fff;cursor:pointer}
header a[aria-current="page"]{background:var(--blue-soft)}
.ex-crumbs{font-size:12.5px;color:var(--muted);margin-bottom:18px}
.ex-crumbs a{color:var(--ex-accent);font-weight:600;text-decoration:none}
.ex-sep{margin:0 6px;opacity:.5}
.ex-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ex-kicker{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-accent);font-weight:700;margin:0 0 8px}
.ex-h1{font-family:'Noto Serif TC',Georgia,serif;font-weight:700;font-size:clamp(24px,3.4vw,30px);line-height:1.35;margin:0 0 12px}
.ex-h2{font-family:'Noto Serif TC',Georgia,serif;font-weight:700;font-size:21px;margin:36px 0 14px}
.ex-lead{font-size:15.5px;line-height:1.9;color:var(--ink-2)}
.ex-meta{font-size:13px;color:var(--ink-2);line-height:1.8;margin:4px 0}
.ex-note h2{font-family:'Noto Serif TC',Georgia,serif;font-size:19px;font-weight:700;margin:28px 0 10px;padding-top:6px;border-top:1px solid var(--line)}
.ex-note h3{font-size:16px;font-weight:700;margin:18px 0 8px}
.ex-note h4{font-size:14.5px;font-weight:700;margin:14px 0 6px}
.ex-note p,.ex-note li{font-size:14.5px;line-height:1.85}
.ex-note ul{list-style:none;padding-left:4px;margin:6px 0}
.ex-note ul>li{position:relative;padding-left:20px;margin:4px 0}
.ex-note ul>li::before{content:"";position:absolute;left:5px;top:.72em;width:7px;height:7px;border-radius:50%;background:var(--ex-accent)}
.ex-note ul ul>li::before{background:transparent;border:1.5px solid var(--ex-accent);width:6px;height:6px}
.ex-note ol{list-style:decimal;padding-left:24px;margin:6px 0}
.ex-note mark{background:linear-gradient(transparent 45%,#fde68a 45%);color:inherit;padding:0 1px;font-weight:600}
.ex-note .num,.ex-num-hl{font-family:Inter,ui-monospace,monospace;font-weight:700;color:#9a3412;background:#fff1e6;border-radius:5px;padding:0 4px;white-space:nowrap}
.ex-note .ex-trap{background:#fef2f2;border:1px solid #fecaca;border-left:5px solid #dc2626;border-radius:12px;padding:10px 16px;margin:14px 0}
.ex-note .ex-trap h3{margin:2px 0 6px;color:#b91c1c;font-size:15px}
.ex-note .ex-trap h3::before{content:"⚠ ";}
.ex-note .ex-trap ul>li::before{background:#dc2626}
.ex-note .ex-ddx tbody td:first-child{font-weight:700;background:var(--ex-soft);width:26%;min-width:8.5em}
.ex-note .ex-ddx thead th{background:var(--ex-accent);color:#fff}
.ex-note .ex-ddx{table-layout:auto;min-width:560px}
.ex-note .ex-ddx td,.ex-note .ex-ddx th{word-break:normal;overflow-wrap:break-word}
.ex-toc{background:var(--ex-card);border:1px solid var(--border);border-radius:12px;padding:10px 16px;margin:12px 0 18px;font-size:14px}
.ex-toc-h{font-weight:700;margin:0 0 4px;font-size:13px;letter-spacing:.08em;color:var(--ex-accent)}
.ex-toc ol{margin:0;padding-left:22px;columns:2 220px;column-gap:24px;line-height:1.9}
.ex-toc a{color:var(--ink-2);text-decoration:none}
.ex-toc a:hover{color:var(--ex-accent);text-decoration:underline}
.ex-note h2,.ex-note h3{scroll-margin-top:80px}
.ex-note .keypoint,.ex-note .hs-tip-box,.ex-note .hs-warn-box{border-radius:12px;padding:12px 16px;margin:14px 0}
.ex-note .keypoint{background:var(--ex-soft);border-left:4px solid var(--ex-accent)}
.ex-note .hs-tip-box{background:#f0fdf4;border-left:4px solid #16a34a}
.ex-note .hs-warn-box{background:#fffbeb;border-left:4px solid #d97706}
.ex-note .ted-table,.ex-rank{width:100%;border-collapse:collapse;font-size:13.5px;margin:10px 0;background:var(--ex-card)}
.ex-note .ted-table th,.ex-note .ted-table td,.ex-rank th,.ex-rank td{border:1px solid var(--border);padding:6px 9px;text-align:left;vertical-align:top}
.ex-note .ted-table th,.ex-rank th{background:var(--ex-soft)}
.ex-note{overflow-x:auto}
.ref,.ex-ref{font-size:11.5px;color:#46556a;background:var(--ex-soft);border-radius:6px;padding:1px 6px;margin-left:4px;white-space:nowrap}
.ex-hit{display:inline-block;font-size:11.5px;font-weight:600;color:#854d0e;background:#fef3c7;border-radius:9999px;padding:1px 9px;margin-left:6px}
.ex-hit a{color:#854d0e}
.ex-num{text-align:right;width:3.5em}
.ex-bar-cell{width:30%}
.ex-bar{display:block;height:9px;border-radius:9px;background:#6b8caf}
.ex-badge{font-size:10.5px;font-weight:700;color:#14532d;background:#dcfce7;border-radius:9999px;padding:1px 7px}
.ex-count{font-size:12px;color:var(--muted)}
.ex-part{border:1px solid var(--border);border-radius:12px;background:var(--ex-card);margin:8px 0;padding:8px 14px}
.ex-part summary{cursor:pointer;font-weight:700;font-size:14px}
.ex-chapter-list{list-style:none;padding:0;margin:8px 0;font-size:14px;line-height:1.9}
.ex-chapter-list a{color:var(--ex-accent)}
.ex-none{color:var(--muted)}
.ex-tools{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:16px 0}
.ex-cta,.ex-cta-btn{display:inline-block;border-radius:9999px;padding:7px 16px;background:var(--ex-accent);color:#fff;font-weight:700;font-size:14px;text-decoration:none;border:1px solid var(--ex-accent);cursor:pointer}
.ex-cta-alt{background:transparent;color:var(--ex-accent)}
.ex-toolbar,.ex-exam-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0}
.ex-toolbar button,.ex-exam-bar button,.ex-actions button{border:1px solid var(--ex-accent);border-radius:9999px;padding:6px 14px;font-size:13px;font-weight:600;background:var(--ex-card);color:var(--ex-accent);cursor:pointer}
.ex-mode[aria-pressed="true"]{background:var(--ex-accent);color:#fff}
.ex-toolbar-hint{font-size:12px;color:var(--muted)}
.ex-exam-bar{position:sticky;top:64px;z-index:5;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line)}
.ex-timer{font-family:Inter,ui-monospace,monospace;font-size:15px;font-weight:700;min-width:4.5em}
.ex-score{font-weight:700;color:var(--ex-accent)}
.ex-q{background:var(--ex-card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin:14px 0;scroll-margin-top:80px}
.ex-q-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;font-size:12px;color:var(--muted);margin-bottom:8px}
.ex-q-no{font-weight:700;color:var(--ink-2)}
.ex-chips{display:flex;flex-wrap:wrap;gap:4px}
.ex-chip{font-size:11px;font-weight:600;border-radius:9999px;padding:1px 8px;background:var(--ex-soft);color:var(--ex-accent);text-decoration:none}
.ex-chip-on{background:var(--ex-accent);color:#fff}
.ex-stem{font-size:15px;line-height:1.85;font-weight:600;margin:0 0 8px}
.ex-fig{display:block;max-width:100%;height:auto;border-radius:8px;margin:6px 0 10px}
.ex-opts{border:0;padding:0;margin:0}
.ex-opt{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:7px 10px;margin:5px 0;font-size:14px;line-height:1.7;cursor:pointer}
.ex-opt input{margin-top:6px}
.ex-opt-key{font-weight:700;min-width:1.2em}
.ex-actions{display:none;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
.ex-result{font-weight:700;font-size:13.5px}
.ex-reveal{margin-top:12px;border-top:1px dashed var(--border);padding-top:10px}
.ex-answer{font-size:14px;margin:0 0 6px}
.ex-answer-src{margin-left:8px;font-size:11.5px;color:var(--muted)}
.ex-summary{font-size:14px;font-weight:600;margin:6px 0;line-height:1.75}
.ex-items{list-style:none;padding:0;margin:0}
.ex-items li{display:grid;grid-template-columns:1.6em auto 1fr;gap:4px 8px;font-size:13.5px;line-height:1.75;padding:6px 0;border-bottom:1px solid var(--line)}
.ex-item-key{font-weight:700}
.ex-item-label{font-size:11.5px;font-weight:700;border-radius:6px;padding:1px 6px;height:fit-content;white-space:nowrap}
.ex-ok .ex-item-label{background:#dcfce7;color:#14532d}
.ex-no .ex-item-label{background:#f1f0ee;color:#57534e}
.ex-item-text{grid-column:3}
.ex-item-refs{grid-column:3}
.ex-warn{font-size:12.5px;color:#854d0e;background:#fffbeb;border-radius:8px;padding:6px 10px;margin:8px 0 0}
.ex-pending{font-size:13px;color:var(--muted)}
.ex-unanswered .ex-opt{cursor:default}
body.ex-quiz .ex-actions{display:flex}
body.ex-quiz .ex-q:not(.ex-done):not(.ex-unanswered) .ex-reveal{display:none}
body.ex-quiz .ex-q:not(.ex-done) .ex-opt[data-correct]{border-color:var(--line);background:transparent}
.ex-q.ex-done .ex-opt[data-correct],body:not(.ex-quiz) .ex-opt[data-correct]{border-color:#16a34a;background:#f0fdf4}
.ex-q.ex-done .ex-opt.ex-picked:not([data-correct]){border-color:#dc2626;background:#fef2f2}
body:not(.ex-quiz) .ex-opt input{display:none}
.ex-fieldset{border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin:10px 0}
.ex-fieldset legend{font-weight:700;font-size:14px;padding:0 4px}
.ex-checks{display:flex;flex-wrap:wrap;gap:6px 14px}
.ex-check{font-size:14px;display:inline-flex;align-items:center;gap:4px;margin-right:12px}
.ex-select,.ex-input{border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:15px;background:var(--ex-card);color:inherit}
.ex-search{display:flex;gap:8px;margin:12px 0}
.ex-input{flex:1;min-width:0}
.ex-hitbox{background:var(--ex-card);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin:8px 0;font-size:14px;line-height:1.8}
.ex-hitbox a{color:var(--ex-accent);font-weight:700}
.ex-hitbox mark{background:#fef08a;color:inherit;border-radius:3px}
:root[data-theme="dark"]{--ex-accent:#a4c4dd;--ex-card:#1f242b;--ex-soft:#28313b}
:root[data-theme="dark"] .ex-q,:root[data-theme="dark"] .ex-part,:root[data-theme="dark"] .ex-hitbox{border-color:#36404b}
:root[data-theme="dark"] .ex-opt,:root[data-theme="dark"] .ex-items li{border-color:#36404b}
:root[data-theme="dark"] .ex-hit,:root[data-theme="dark"] .ex-warn{background:#332a14;color:#fde68a}
:root[data-theme="dark"] .ex-hit a{color:#fde68a}
:root[data-theme="dark"] .ex-badge,:root[data-theme="dark"] .ex-ok .ex-item-label{background:#14532d;color:#dcfce7}
:root[data-theme="dark"] .ex-no .ex-item-label{background:#36404b;color:#e7e5e4}
:root[data-theme="dark"] .ref,:root[data-theme="dark"] .ex-ref{color:#cfe0ee}
:root[data-theme="dark"] .ex-mode[aria-pressed="true"],:root[data-theme="dark"] .ex-chip-on,:root[data-theme="dark"] .ex-cta{color:#14181d}
:root[data-theme="dark"] .ex-note .hs-tip-box{background:#12301d}
:root[data-theme="dark"] .ex-note .hs-warn-box{background:#332a14}
:root[data-theme="dark"] .ex-q.ex-done .ex-opt[data-correct],:root[data-theme="dark"] body:not(.ex-quiz) .ex-opt[data-correct]{background:#12301d;border-color:#16a34a}
:root[data-theme="dark"] .ex-q.ex-done .ex-opt.ex-picked:not([data-correct]){background:#3a1a1a;border-color:#dc2626}
:root[data-theme="dark"] .ex-hitbox mark{background:#854d0e;color:#fff}
:root[data-theme="dark"] .ex-note mark{background:linear-gradient(transparent 45%,#854d0e 45%)}
:root[data-theme="dark"] .ex-note .num{background:#3b2414;color:#fdba74}
:root[data-theme="dark"] .ex-note .ex-trap{background:#2d1616;border-color:#7f1d1d}
:root[data-theme="dark"] .ex-note .ex-trap h3{color:#fca5a5}
:root[data-theme="dark"] .ex-toc{border-color:#36404b}
:root[data-theme="dark"] .ex-toc a{color:#d6d3d1}
:root[data-theme="dark"] .ex-note .ex-ddx thead th{color:#14181d}
</style>
"""


def main() -> int:
    check = "--check" in sys.argv
    files = build()
    stale = []
    for name, content in files.items():
        path = OUT / name
        if check:
            if not path.exists():
                stale.append(name)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
    if check:
        if stale:
            print(f"exam pages missing: {stale[:5]} (run python _gen_exam.py)")
            return 1
        return 0
    expected = {name for name in files if "/" not in name} | {"exam.js"}
    for path in OUT.iterdir():
        if path.is_file() and path.name not in expected:
            path.unlink()
    print(f"wrote {len(files)} exam files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
