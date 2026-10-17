"""Generate the ophthalmology board-exam review section (/exam/**) from data/exam/.

Sources (hand-maintained):
  data/exam/questions.json      1774 past board-exam MCQs, built by _exam_import.py
  data/exam/tags.json           question number -> BCSC chapters ("12-4") it tests
  data/exam/explanations.json   answers + per-option explanations with BCSC page refs
  data/exam/chapters.json       BCSC 2025-2026 sections, chapter titles, printed pages
  data/exam/concepts.json       groups of questions that test the same concept ("考點")
  data/exam/doubts.json         flagged questions: exam-answer rationale + current concept with refs
  data/exam/notes/bcsc<b>-<c>.htm   chapter study notes (trusted HTML fragments; .htm keeps
                                    the site-wide *.html page audits off them)

Outputs (generated, never hand-edit):
  exam/index.html, exam/bcsc<b>-<c>.html, exam/practice.html, exam/review.html,
  exam/progress.html, exam/search.html, exam/login.html, exam/notes-data.json (public),
  api/_exam_bank.js (question bank; served only to signed-in readers by api/_exam_data.js (via api/exam/[op].js))

Access: chapter notes are public. Question text, answers and explanations never appear
in public files (build() fails closed if they do); readers sign in with the shared
EXAM_PASSWORD (api/_exam_login.js) and exam.js fetches the bank from /api/exam/data.

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

import base64
import html
import json
import re
import sys
from collections import defaultdict
from urllib.parse import quote
from pathlib import Path

from halfwidth_to_fullwidth import convert as fullwidth
from _gen_site_chrome import home_footer, home_header

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "exam"
OUT = ROOT / "exam"
DOMAIN = "https://hsiao.chendermatologist.com"
HUB_TITLE = "眼科專科醫師考試重點及考題"
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
    for key in notes:
        notes[key] = anchor_notes(key, notes[key])
    doubts = json.loads((DATA / "doubts.json").read_text(encoding="utf-8"))
    for n, d in doubts.items():
        if n not in explanations or d.get("cat") not in DOUBT_CATS or not d.get("exam"):
            raise SystemExit(f"doubts.json: bad entry for Q{n}")
        if bool(d.get("now")) != bool(d.get("refs")) or len(d.get("refs", [])) > 3:
            raise SystemExit(f"doubts.json: Q{n} needs a current-concept text with 1-3 references, or neither")
        for r in d.get("refs", []):
            if not re.fullmatch(r"https?://[^\s\"'<>]+", r.get("u", "")) or not r.get("t"):
                raise SystemExit(f"doubts.json: Q{n} reference needs a title and an http(s) URL")
        if "dispute" in d:
            refs = d.get("drefs", [])
            if not d["dispute"] or not 1 <= len(refs) <= 3 or any(not r.get("t") for r in refs):
                raise SystemExit(f"doubts.json: Q{n} dispute needs text and 1-3 titled sources")
            for r in refs:
                if r.get("u") and not re.fullmatch(r"https?://[^\s\"'<>]+", r["u"]):
                    raise SystemExit(f"doubts.json: Q{n} dispute source URL must be http(s)")
        check_traditional(f"doubt Q{n}", d["exam"] + d.get("now", "") + d.get("dispute", ""))
    concepts = json.loads((DATA / "concepts.json").read_text(encoding="utf-8"))
    concept_of: dict[int, dict] = {}
    for c in concepts:
        if not re.fullmatch(r"c\d+-\d{3}", c["id"]) or not 0 < len(c["title"]) <= 24 or len(c["qs"]) < 2:
            raise SystemExit(f"concepts.json: bad group {c.get('id')}")
        check_traditional(f"concept {c['id']}", c["title"])
        for n in c["qs"]:
            if str(n) not in numbers or n in concept_of:
                raise SystemExit(f"concepts.json: question {n} unknown or in two groups")
            concept_of[n] = c
    by_chapter: dict[str, list] = defaultdict(list)
    for q in questions:
        for key in tags[str(q["n"])]["ch"]:
            by_chapter[key].append(q)
    return {"questions": questions, "tags": tags, "explanations": explanations, "books": books,
            "chapters": chapters, "notes": notes, "by_chapter": by_chapter,
            "concepts": concepts, "doubts": doubts}


# Searchable note paragraphs: the elements note_text() indexes (li/p/td; h2/h3 only
# advance the section). anchor_notes() and note_text() walk the same matches, so the
# n-th searchable paragraph of a chapter is the element with id "np-<n>".
PARA_RE = re.compile(r"<(h2|h3|li|p|td)\b([^>]*)>(.*?)</\1>", re.S)


def para_text(inner: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"\{\{q:[^}]*\}\}", "", inner))).strip()
    return re.sub(r"\s+", " ", text)


def anchor_notes(key: str, fragment: str) -> str:
    """Give every note <h3> an id ("<h2 id>-<n>") so each subsection can be linked, and
    every searchable paragraph an id ("np-<n>") so search results can land on it."""
    h2 = {"id": "", "n": 0}

    def add_id(m: re.Match) -> str:
        if m.group(1) == "h2":
            found = re.search(r'\sid="([^"]+)"', m.group(2))
            if not found:
                raise SystemExit(f"notes {key}: every <h2> needs an id")
            h2["id"], h2["n"] = found.group(1), 0
            return m.group(0)
        if re.search(r'\sid="', m.group(2)):
            return m.group(0)
        h2["n"] += 1
        return f'<h3 id="{h2["id"] or "notes"}-{h2["n"]}"{m.group(2)}>'

    fragment = re.sub(r"<(h2|h3)\b([^>]*)>", add_id, fragment)
    ids = re.findall(r'<h[23]\b[^>]*\sid="([^"]+)"', fragment)
    if len(ids) != len(set(ids)):
        raise SystemExit(f"notes {key}: duplicate heading ids")
    para = {"n": 0}

    def number(m: re.Match) -> str:
        tag, attrs, inner = m.groups()
        if tag in ("h2", "h3") or not para_text(inner):
            return m.group(0)
        if re.search(r'\sid="', attrs):
            raise SystemExit(f"notes {key}: <{tag}> ids are generated (np-<n>); remove the id from the notes file")
        para["n"] += 1
        return f'<{tag} id="np-{para["n"]}"{attrs}>{inner}</{tag}>'

    return PARA_RE.sub(number, fragment)


def slug(key: str) -> str:
    return "bcsc" + key


def chapter_label(ch: dict) -> str:
    return f"BCSC {ch['book']} Ch.{ch['ch']}"


def indexable(key: str, data: dict) -> bool:
    """Only chapters with written notes are substantive enough to index (D-02)."""
    return key in data["notes"]


# ---------------------------------------------------------------- page shell



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
    # Owner decision 2026-10-17: exam pages use the homepage header verbatim
    # (single source of truth: index.html via _gen_site_chrome.py).
    return home_header(ROOT) + "\n"


def footer() -> str:
    return home_footer(ROOT) + "\n"


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
        + f'<main id="main-content" class="ex-main max-w-3xl mx-auto px-5 sm:px-8 pt-10 pb-16">{crumbs_html(items)}{"" if kind == "login" else AUTH_BAR}{body}</main>\n'
        + footer()
        + f'<script src="/blog/blog-shared.min.js?v={version}" defer></script>\n'
        + f'<script src="/exam/exam.js?v={version}" defer></script>\n'
        + "</body>\n</html>\n"
    )
    return fullwidth(out)[0]


# Filled by exam.js: "已登入題庫 · 登出" when signed in, a login link otherwise.
AUTH_BAR = '<div class="ex-auth" aria-live="polite" hidden></div>'

# Hub disease search (owner request 2026-10-17). exam.js searches the public notes
# (notes-data.json) as the reader types and lists the chapters and paragraphs that
# mention the term; without JavaScript the form falls back to /exam/search?q=.
HUB_SEARCH = (
    '<form class="ex-find" role="search" action="/exam/search" method="get" data-hub-search>'
    '<label class="ex-label" for="ex-find-q">搜尋疾病（全名或縮寫）</label>'
    '<div class="ex-find-row"><input id="ex-find-q" name="q" type="search" class="ex-input" '
    'placeholder="例如 PVRL、Vogt-Koyanagi-Harada、圓錐角膜" autocomplete="off" aria-describedby="ex-find-hint">'
    '<button type="submit" class="ex-cta-btn">找章節</button></div>'
    '<p id="ex-find-hint" class="ex-meta">列出提到這個病的章節與段落，點段落會直接跳到課本重點的那一段。只搜尋公開的課本重點，不含考題。</p>'
    '</form>'
    '<p class="ex-find-status" aria-live="polite"></p>'
    '<div id="ex-find-results" class="ex-find-results"></div>'
)

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


DOUBT_CATS = {"outdated", "bcsc_silent", "bcsc_conflict", "ambiguous", "typo"}


def cite_meta(ref: dict) -> str:
    parts = [str(ref.get("s") or "").strip(), str(ref.get("y") or "").strip()]
    meta = " ".join(p for p in parts if p)
    return meta + (f" · PMID {ref['pmid']}" if ref.get("pmid") else "")


def login_href(target: str) -> str:
    return "/exam/login?next=" + quote(target, safe="/")


def expand_hits(fragment: str, key: str, on_page: set[int]) -> str:
    def repl(m: re.Match) -> str:
        nums = [int(i) for i in re.split(r"\s*,\s*", m.group(1).strip()) if i]
        bad = [i for i in nums if i not in on_page]
        if bad:
            raise SystemExit(f"notes {key}: {{{{q:...}}}} cites questions not on this chapter page: {bad}")
        links = "、".join(f'<a href="{login_href(f"/exam/{slug(key)}#q-{i}")}" data-q="{i}">第 {i} 題</a>' for i in nums)
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
                    '<li><a href="#qs-h">考題</a></li></ol></nav>') if toc else ""
        notes_html = (f'<section class="ex-notes" aria-labelledby="notes-h"><h2 id="notes-h" class="ex-h2">課本重點整理</h2>{toc_html}'
                      f'<p class="ex-meta">依 BCSC {ch["book"]} 第 {ch["ch"]} 章自行摘要整理，非原文；'
                      f'<span class="ex-ref">p.</span> 標示為原書印刷頁碼。</p>'
                      f'<div class="ex-note">{taxa_html(expand_hits(note, key, {q["n"] for q in qs}))}</div></section>')
    else:
        notes_html = ('<section class="ex-notes" aria-labelledby="notes-h"><h2 id="notes-h" class="ex-h2">課本重點整理</h2>'
                      '<p class="ex-pending">這一章的重點尚未整理。</p></section>')
    if qs:
        # Questions, answers and explanations are served only to signed-in readers by
        # /api/exam/data; exam.js renders them here (grouped by concept) after login.
        q_html = (f'<div class="ex-qs-tools" hidden>{MODE_BAR}</div>'
                  f'<div id="ex-chapter-qs" class="ex-list" data-chapter="{key}">'
                  f'<p class="ex-locked">本章考題 {len(qs)} 題。<a href="{login_href(f"/exam/{slug(key)}")}">登入</a>'
                  '後可以作答、看答案與詳解。</p></div>')
    else:
        q_html = '<p class="ex-pending">題庫中沒有標到這一章的題目。</p>'
    body = (
        f'<p class="ex-kicker">BCSC {ch["book"]} · {esc(ch["bookTitle"])}</p>'
        f'<h1 class="ex-h1">Ch.{ch["ch"]} {esc(ch["title"])}</h1>'
        f'<p class="ex-meta">原書 p.{esc(ch["pages"])} · 考題 {len(qs)} 題</p>'
        f'<div class="ex-strip" data-progress-chapter="{key}" hidden>'
        f'<label class="ex-check"><input type="checkbox" class="ex-read-box" value="{key}"> 課本已讀完</label>'
        '<span class="ex-strip-text" aria-live="polite"></span>'
        '<a class="ex-strip-link" href="/exam/progress">讀書進度</a></div>'
        f"{notes_html}"
        f'<section aria-labelledby="qs-h"><h2 id="qs-h" class="ex-h2">考題</h2>{q_html}</section>'
    )
    head_label = f"BCSC {ch['book']} Ch.{ch['ch']} "
    title = head_label + fit(ch["title"], TITLE_MAX - len(SITE_SUFFIX) - len(head_label) - len("：重點與考題")) + "：重點與考題"
    tail = ("的課本重點整理，" if note else "，") + f"以及標到本章的考題 {len(qs)} 題。"
    lead = f"眼科專科醫師考試讀書筆記：BCSC 2025–2026 第 {ch['book']} 冊第 {ch['ch']} 章 "
    desc = lead + fit(ch["title"], DESC_MAX - len(lead) - len(tail)) + tail
    return page(path=f"/exam/{slug(key)}", title=title, description=desc,
                crumbs=[(f"BCSC {ch['book']} Ch.{ch['ch']}", f"/exam/{slug(key)}")], schema_type="WebPage",
                body=body, kind="chapter", version=version,
                robots="index,follow,max-image-preview:large" if indexable(key, data) else "noindex,follow")


def hub_page(data: dict, version: str) -> str:
    chapters, by_chapter = data["chapters"], data["by_chapter"]
    # Every chapter with questions is ranked; exam.js shows TOP_N rows at a time
    # ("載入更多"), and without JavaScript the whole table stays visible.
    ranked = sorted(by_chapter.items(), key=lambda kv: (-len(kv[1]), kv[0]))
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
    # Owner order 2026-10-17: search → tools → access note → 考古卷 → chapters → frequency.
    body = (
        f'<h1 class="ex-h1">{HUB_TITLE}</h1>'
        f'<p class="ex-lead">依 {esc(REFERENCE)} 章節整理課本重點，並把考題標到每一題考到的所有章節；'
        "讀完一章就能在同一頁快速複習重點與考題。陸續更新中。</p>"
        f"{HUB_SEARCH}"
        '<ul class="ex-tools">'
        '<li><a class="ex-cta ex-cta-alt" href="/exam/progress">讀書進度</a></li>'
        '<li><a class="ex-cta ex-cta-alt" href="/exam/review">錯題本與 Anki 匯出</a></li>'
        '<li><a class="ex-cta ex-cta-alt" href="/exam/search">搜尋重點與考題</a></li>'
        '<li><a class="ex-cta ex-cta-alt" href="/exam/login">登入／登出題庫</a></li></ul>'
        '<p class="ex-meta">課本重點整理公開；考題、答案與詳解需要登入才能看。</p>'
        '<p class="ex-practice"><a class="ex-cta" href="/exam/practice">考古卷：自選範圍／隨機出題</a></p>'
        '<h2 class="ex-h2">依 BCSC 章節瀏覽</h2>' + "".join(books_html)
        + '<h2 class="ex-h2" id="rank-h">出題頻率：最常考</h2>'
        f'<p class="ex-meta">依題數排序，共 {len(ranked)} 章有考題，先顯示前 {TOP_N} 章；'
        "按表格右下角的「載入更多」再顯示下一批。"
        "一題可能同時考到多章，會計入每一章，所以加總會超過題數。這裡統計的是累計題數。</p>"
        f'<table class="ex-rank" aria-labelledby="rank-h" data-rank-step="{TOP_N}">'
        '<thead><tr><th scope="col">章節</th><th scope="col">題數</th>'
        '<th scope="col"><span class="ex-sr">相對比例</span></th></tr></thead>'
        f"<tbody>{rows}</tbody></table>"
        '<div class="ex-more" hidden><span class="ex-more-status" aria-live="polite"></span>'
        '<button type="button" class="ex-more-btn">載入更多</button></div>'
    )
    desc = ("眼科專科醫師考試讀書筆記：依 BCSC 2025–2026 章節整理課本重點，收錄考題並標註所屬章節，"
            "附疾病搜尋、出題頻率、作答與瀏覽模式、考古卷、錯題本、讀書進度與 Anki 匯出。")
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
        '<p class="ex-kicker">考古卷</p><h1 class="ex-h1">自選範圍／隨機出題</h1>'
        '<p class="ex-meta">一題考到多冊時，勾選其中任一冊就會被抽到。</p>'
        '<form class="ex-practice-form" data-practice-form>'
        '<fieldset class="ex-fieldset"><legend>出題範圍（BCSC 冊別）</legend>'
        f'<div class="ex-checks">{boxes}</div>'
        '<div class="ex-toolbar"><button type="button" class="ex-books-all">全選</button>'
        '<button type="button" class="ex-books-none">全不選</button></div></fieldset>'
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
    return page(path="/exam/practice", title="眼科專科考試考古卷：自選範圍與隨機出題",
                description="眼科專科醫師考試考古卷：從考題中自選 BCSC 冊別與題數，隨機或依題號出題，計時作答、交卷計分，並對照答案與 BCSC 詳解。",
                crumbs=[("考古卷", "/exam/practice")], schema_type="WebPage", body=body, kind="practice",
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
                description="眼科專科醫師考試讀書筆記的錯題本：集中重練作答模式答錯的考題，並可把題目與詳解匯出成 Anki 卡片。",
                crumbs=[("錯題本", "/exam/review")], schema_type="WebPage", body=body, kind="review",
                robots="noindex,follow", version=version)


def progress_page(version: str) -> str:
    body = (
        '<p class="ex-kicker">複習工具</p><h1 class="ex-h1">讀書進度</h1>'
        '<p class="ex-meta">依 BCSC 章節統計已作答題數、正確率與最後讀的日期，並可勾選「課本已讀完」。'
        '正確率以每題最近一次作答計算；作答紀錄只存在這台裝置的瀏覽器裡（不同電腦或手機不會同步）。</p>'
        '<div id="ex-progress" class="ex-list"><p class="ex-pending">進度載入中；這個功能需要啟用 JavaScript。</p></div>'
        '<div class="ex-toolbar"><button type="button" class="ex-clear-progress">清除作答紀錄</button></div>'
    )
    return page(path="/exam/progress", title="眼科專科考試讀書進度：各章作答與正確率",
                description="眼科專科醫師考試讀書筆記的讀書進度：依 BCSC 章節顯示已作答題數、正確率與最後讀的日期，標記課本已讀完的章節，找出需要優先複習的章節。",
                crumbs=[("讀書進度", "/exam/progress")], schema_type="WebPage", body=body, kind="progress",
                robots="noindex,follow", version=version)


def login_page(version: str) -> str:
    body = (
        '<p class="ex-kicker">題庫登入</p><h1 class="ex-h1">登入題庫</h1>'
        '<p class="ex-meta">考題、答案與詳解需要登入才能看；課本重點整理不用登入。登入後 30 天內不需要再輸入密碼。</p>'
        '<p class="ex-login-msg" role="alert" hidden></p>'
        '<form class="ex-login" method="post" action="/api/exam/login">'
        '<input type="hidden" name="next" value="/exam">'
        '<label class="ex-label" for="ex-password">密碼</label>'
        '<input id="ex-password" name="password" type="password" class="ex-input" autocomplete="current-password" required>'
        '<button type="submit" class="ex-cta-btn">登入</button></form>'
        '<form class="ex-logout" method="post" action="/api/exam/logout">'
        '<button type="submit" class="ex-link-btn">登出這台裝置</button></form>'
    )
    return page(path="/exam/login", title="眼科專科考試題庫登入",
                description="眼科專科醫師考試讀書筆記的題庫登入頁：登入後可以看考題、答案與詳解；各章課本重點整理不需要登入即可閱讀。",
                crumbs=[("登入", "/exam/login")], schema_type="WebPage", body=body, kind="login",
                robots="noindex,nofollow", version=version)


def search_page(version: str) -> str:
    body = (
        '<p class="ex-kicker">搜尋</p><h1 class="ex-h1">搜尋課本重點與考題</h1>'
        '<form class="ex-search" role="search" data-search-form>'
        '<label class="ex-sr" for="ex-q">關鍵字</label>'
        '<input id="ex-q" name="q" type="search" class="ex-input" placeholder="例如 HLA-B*1502、AREDS2、Protocol T" autocomplete="off">'
        '<button type="submit" class="ex-cta-btn">搜尋</button></form>'
        '<p class="ex-meta">搜尋各章重點整理；登入後也會搜尋題幹、選項與詳解。英文不分大小寫，多個關鍵字以空白分隔（需全部符合）。</p>'
        '<div id="ex-search-results" class="ex-list" aria-live="polite"></div>'
    )
    return page(path="/exam/search", title="搜尋眼科專科考試重點與考題",
                description="在眼科專科醫師考試讀書筆記中搜尋關鍵字，例如藥名、試驗名稱或基因，同時找出相關的 BCSC 課本重點整理與考題詳解。",
                crumbs=[("搜尋", "/exam/search")], schema_type="WebPage", body=body, kind="search",
                robots="noindex,follow", version=version)


def note_text(fragment: str) -> list[dict]:
    """Split a notes fragment into searchable paragraphs keyed by their section heading."""
    """Paragraph i (0-based) is the note element with id "np-<i+1>" (see anchor_notes)."""
    out, heading = [], ""
    for m in PARA_RE.finditer(fragment):
        tag, attrs, inner = m.groups()
        found = re.search(r'\sid="([^"]+)"', attrs)
        text = para_text(inner)
        if tag == "h2":
            heading = found.group(1) if found else ""
        if text and tag in ("li", "p", "td"):
            if not found or found.group(1) != f"np-{len(out) + 1}":
                raise SystemExit("notes: paragraph ids are out of step with the search index")
            out.append({"h": heading, "t": text})
    return out


def note_sections(fragment: str) -> dict[str, str]:
    """h2 id -> plain heading text, for labelling search hits with their section."""
    return {hid: html.unescape(re.sub(r"<[^>]+>", "", text)).strip()
            for hid, text in re.findall(r'<h2[^>]*\sid="([^"]+)"[^>]*>(.*?)</h2>', fragment, re.S)}


def notes_data(data: dict) -> dict:
    """Public: chapter labels, note text for search, and question→chapter numbers for progress.
    Each chapter carries its question count ("q", so the hub search can tell which chapters
    have a page) and, when it has notes, its section titles ("secs")."""
    chapters = {}
    for k, c in data["chapters"].items():
        chapters[k] = {"label": f"BCSC {c['book']} Ch.{c['ch']}", "title": c["title"],
                       "q": len(data["by_chapter"].get(k, []))}
        if k in data["notes"]:
            chapters[k]["secs"] = note_sections(data["notes"][k])
    notes = {k: note_text(v) for k, v in data["notes"].items()}
    books = {str(b["book"]): b["title"] for b in data["books"]}
    qs = [[q["n"], data["tags"][str(q["n"])]["ch"]] for q in data["questions"] if str(q["n"]) in data["explanations"]]
    return {"chapters": chapters, "notes": notes, "books": books, "qs": qs, "taxa": TAXON_RE.pattern}


def bank_data(data: dict) -> dict:
    """Signed-in only (served by /api/exam/data): question text, answers, explanations, concept groups."""
    questions = []
    for q in data["questions"]:
        row = {"n": q["n"], "stem": q["stem"], "options": q["options"], "ch": data["tags"][str(q["n"])]["ch"]}
        if q.get("image"):
            # Exam figures are question content: embed them in the signed-in bank
            # (data/exam/figures is never deployed) instead of serving a public file.
            img = q["image"]
            fig = (DATA / img["src"]).resolve()
            if fig.parent != (DATA / "figures").resolve() or fig.suffix != ".webp":
                raise SystemExit(f"Q{q['n']}: figure must be data/exam/figures/*.webp")
            row["image"] = {"src": "data:image/webp;base64," + base64.b64encode(fig.read_bytes()).decode("ascii"),
                            "width": img["width"], "height": img["height"]}
        expl = data["explanations"].get(str(q["n"]))
        if expl:
            row["answer"] = expl["answer"]
            doubt = data["doubts"].get(str(q["n"]))
            row["expl"] = {"summary": expl["summary"], "flags": [] if doubt else expl.get("flags", []), "items": [
                {"key": it["key"], "label": it["label"], "text": it["text"], "ok": it["answer"],
                 "refs": [ref_label(r) for r in it["refs"]]} for it in expl["items"]]}
            if doubt:
                if doubt.get("dispute"):
                    row["dispute"] = {"text": doubt["dispute"], "refs": [
                        {"t": r["t"], "u": r.get("u", ""), "s": cite_meta(r)} for r in doubt["drefs"]]}
                row["doubt"] = {"exam": doubt["exam"], "now": doubt.get("now", ""), "refs": [
                    {"t": r["t"], "u": r["u"], "s": cite_meta(r)} for r in doubt.get("refs", [])]}
        questions.append(row)
    concepts = [{"id": c["id"], "t": c["title"], "qs": c["qs"]} for c in data["concepts"]]
    return {"questions": questions, "concepts": concepts}


def bank_module(data: dict) -> str:
    payload = json.dumps(bank_data(data), ensure_ascii=False, separators=(",", ":"))
    return ("// Generated by _gen_exam.py — do not edit. Signed-in exam bank, read only by api/_exam_data.js (via api/exam/[op].js).\n"
            "// Underscore-prefixed api/ modules are not routes, so this is never served directly.\n"
            f"export const EXAM_BANK_JSON = {json.dumps(payload, ensure_ascii=False)};\n")


def build() -> dict[str, str]:
    data = load()
    version = site_version()
    files: dict[str, str] = {"index.html": hub_page(data, version)}
    for key in data["chapters"]:
        if data["by_chapter"].get(key) or key in data["notes"]:
            files[f"{slug(key)}.html"] = chapter_page(data, key, version)
    files["practice.html"] = practice_page(data, version)
    files["review.html"] = review_page(version)
    files["progress.html"] = progress_page(version)
    files["search.html"] = search_page(version)
    files["login.html"] = login_page(version)
    files["notes-data.json"] = json.dumps(notes_data(data), ensure_ascii=False, separators=(",", ":")) + "\n"
    files["../api/_exam_routes.js"] = routes_module(data)
    files["../api/_exam_bank.js"] = bank_module(data)
    # Fail closed: no public file may carry question cards or question text.
    stems = [q["stem"].strip()[:60] for q in data["questions"] if len(q["stem"].strip()) >= 30]
    for name, content in files.items():
        if name == "../api/_exam_bank.js":
            continue
        if '<article class="ex-q' in content or any(stem in content for stem in stems):
            raise SystemExit(f"{name}: public exam output must not contain question text")
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
.ex-locked{background:var(--ex-soft);border:1px dashed var(--border);border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.8}
.ex-locked a,.ex-hit a{font-weight:700}
.ex-login{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0}
.ex-label{font-weight:700;font-size:14px}
.ex-login .ex-input{flex:1;min-width:12em}
.ex-login-msg{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:8px 12px;font-size:14px;color:#991b1b}
.ex-link-btn{background:none;border:0;padding:0;color:var(--ex-accent);text-decoration:underline;cursor:pointer;font-size:13px}
.ex-qs-tools[hidden]{display:none}
.ex-auth{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 10px;font-size:13px;color:var(--ink-2);margin:-8px 0 12px}
.ex-auth[hidden]{display:none}
.ex-auth form{display:inline;margin:0}
.ex-auth a{color:var(--ex-accent);font-weight:600}
.ex-doubt{margin:10px 0 0;border:1px solid #f3d38a;background:#fffbeb;border-radius:10px;padding:8px 12px;font-size:13.5px;line-height:1.8}
.ex-doubt p{margin:4px 0}
.ex-doubt-tag{display:inline-block;font-size:11.5px;font-weight:700;border-radius:6px;padding:0 7px;margin-right:6px;background:#fde68a;color:#713f12}
.ex-doubt-tag-dispute{background:#fecaca;color:#7f1d1d}
.ex-doubt-tag-now{background:#dbeafe;color:#1e3a8a}
.ex-cites{margin:2px 0 4px;padding-left:22px;font-size:12.5px;line-height:1.7}
.ex-cites a{color:var(--ex-accent);word-break:break-word}
.ex-cite-meta{margin-left:6px;color:var(--muted)}
.ex-concept{font-size:15px;font-weight:700;margin:26px 0 4px;padding-top:10px;border-top:1px solid var(--line);color:var(--ex-accent);scroll-margin-top:80px}
.ex-concept .ex-count{margin-left:8px;font-weight:500}
.ex-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;background:var(--ex-card);border:1px solid var(--border);border-radius:12px;padding:8px 14px;margin:10px 0;font-size:13.5px}
.ex-strip[hidden]{display:none}
.ex-strip-text{color:var(--ink-2)}
.ex-strip-link{color:var(--ex-accent);font-weight:600;margin-left:auto}
.ex-summary-box{background:var(--ex-card);border:1px solid var(--border);border-radius:12px;padding:10px 16px;margin:12px 0;font-size:14px;line-height:1.9}
.ex-weak a{color:#b91c1c;font-weight:600}
.ex-prog{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0}
.ex-prog th,.ex-prog td{border-bottom:1px solid var(--line);padding:6px 6px;text-align:left;vertical-align:top}
.ex-prog th{font-size:12px;color:var(--muted);font-weight:600}
.ex-prog td.ex-num,.ex-prog th.ex-num{text-align:right;white-space:nowrap}
.ex-prog a{color:var(--ex-accent)}
.ex-prog .ex-low{color:#b91c1c;font-weight:700}
.ex-find{background:var(--ex-card);border:1px solid var(--border);border-radius:14px;padding:12px 16px;margin:18px 0 8px}
.ex-find-row{display:flex;gap:8px;margin:6px 0 4px}
.ex-find-status{font-size:13.5px;color:var(--ink-2);margin:6px 0}
.ex-find-title{font-size:15px;font-weight:700;margin:10px 0 4px}
.ex-find-group{background:var(--ex-card);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin:8px 0}
.ex-find-h{font-size:15px;font-weight:700;line-height:1.6;margin:0}
.ex-find-h a{color:var(--ex-accent)}
.ex-find-h .ex-count{margin-left:8px;font-weight:500;color:var(--ink-2)}
.ex-find-list{list-style:none;padding:0;margin:6px 0 0;font-size:13.5px;line-height:1.75}
.ex-find-list li{border-top:1px solid var(--line);padding:6px 0}
.ex-find-list a{display:block;color:var(--ink);text-decoration:none}
.ex-find-list a:hover .ex-find-snip,.ex-find-list a:focus-visible .ex-find-snip{text-decoration:underline}
.ex-find-sec{display:block;font-size:12px;font-weight:600;color:var(--ex-accent)}
.ex-find-results mark,.ex-note mark.ex-find-hl{background:#bfdbfe;color:#0f172a;font-weight:inherit;border-radius:3px;padding:0 1px}
.ex-find-more,.ex-more-btn{border:1px solid var(--ex-accent);border-radius:9999px;padding:5px 14px;font-size:13px;font-weight:600;background:var(--ex-card);color:var(--ex-accent);cursor:pointer;margin-top:4px}
.ex-practice{margin:12px 0 4px}
.ex-more{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px 12px;margin:2px 0 12px;font-size:13px;color:var(--ink-2)}
.ex-more[hidden],.ex-rank tr[hidden]{display:none}
.ex-note [id^="np-"]{scroll-margin-top:96px}
.ex-note [id^="np-"]:target{background:var(--ex-soft);outline:2px solid var(--ex-accent);outline-offset:-2px;border-radius:6px}
.ex-resume{position:sticky;top:72px;z-index:6;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;background:var(--ex-card);border:1px solid var(--border);border-left:4px solid var(--ex-accent);border-radius:10px;padding:6px 8px 6px 12px;margin:8px 0 12px;font-size:13px;line-height:1.6;box-shadow:0 -8px 0 var(--bg),0 6px 16px -10px rgba(15,23,42,.35)}
.ex-resume-text{flex:1;min-width:12em}
.ex-resume-top{border:1px solid var(--ex-accent);border-radius:9999px;padding:3px 12px;font-size:12.5px;font-weight:600;background:var(--ex-card);color:var(--ex-accent);cursor:pointer}
.ex-resume-close{border:0;background:none;color:var(--ink-2);font-size:18px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.ex-resume-close:hover{background:var(--ex-soft)}
.ex-ans-bar{position:sticky;top:64px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;background:var(--bg);padding:8px 0;margin:0 0 4px;border-bottom:1px solid var(--line);font-size:13px}
.ex-ans-text{color:var(--ink-2);font-weight:600}
.ex-ans-next,.ex-ans-clear{border:1px solid var(--ex-accent);border-radius:9999px;padding:5px 13px;font-size:13px;font-weight:600;background:var(--ex-card);color:var(--ex-accent);cursor:pointer}
.ex-ans-next:disabled{opacity:.5;cursor:default}
.ex-ans-clear{margin:0 0 6px}
.ex-ans-bar[hidden],.ex-ans-clear[hidden],body:not(.ex-quiz) .ex-ans-bar,body:not(.ex-quiz) .ex-ans-clear{display:none}
body.ex-quiz .ex-q:not(.ex-done):not(.ex-unanswered){box-shadow:inset 4px 0 0 #b8cfe3}
body.ex-quiz .ex-q:not(.ex-done):not(.ex-unanswered) .ex-q-no::after{content:"・未作答";font-weight:500;color:var(--muted)}
.ex-q:focus{outline:2px solid var(--ex-accent);outline-offset:2px}
:root[data-theme="dark"]{--ex-accent:#a4c4dd;--ex-card:#1f242b;--ex-soft:#28313b}
:root[data-theme="dark"] .ex-q,:root[data-theme="dark"] .ex-part,:root[data-theme="dark"] .ex-hitbox{border-color:#36404b}
:root[data-theme="dark"] .ex-opt,:root[data-theme="dark"] .ex-items li{border-color:#36404b}
:root[data-theme="dark"] .ex-hit,:root[data-theme="dark"] .ex-warn{background:#332a14;color:#fde68a}
:root[data-theme="dark"] .ex-hit a{color:#fde68a}
:root[data-theme="dark"] .ex-badge,:root[data-theme="dark"] .ex-ok .ex-item-label{background:#14532d;color:#dcfce7}
:root[data-theme="dark"] .ex-no .ex-item-label{background:#36404b;color:#e7e5e4}
:root[data-theme="dark"] .ref,:root[data-theme="dark"] .ex-ref{color:#cfe0ee}
:root[data-theme="dark"] .ex-mode[aria-pressed="true"],:root[data-theme="dark"] .ex-chip-on,:root[data-theme="dark"] .ex-cta,:root[data-theme="dark"] .ex-cta-btn{color:#14181d}
:root[data-theme="dark"] .ex-cta.ex-cta-alt{color:var(--ex-accent)}
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
:root[data-theme="dark"] .ex-locked{border-color:#36404b}
:root[data-theme="dark"] .ex-login-msg{background:#3a1a1a;border-color:#7f1d1d;color:#fecaca}
:root[data-theme="dark"] .ex-doubt{background:#2a2414;border-color:#5c4a1a}
:root[data-theme="dark"] .ex-doubt-tag{background:#5c4a1a;color:#fde68a}
:root[data-theme="dark"] .ex-doubt-tag-dispute{background:#7f1d1d;color:#fee2e2}
:root[data-theme="dark"] .ex-doubt-tag-now{background:#1e3a5f;color:#dbeafe}
:root[data-theme="dark"] .ex-strip,:root[data-theme="dark"] .ex-summary-box{border-color:#36404b}
:root[data-theme="dark"] .ex-weak a,:root[data-theme="dark"] .ex-prog .ex-low{color:#fca5a5}
:root[data-theme="dark"] .ex-toc a{color:#d6d3d1}
:root[data-theme="dark"] .ex-note .ex-ddx thead th{color:#14181d}
:root[data-theme="dark"] .ex-find,:root[data-theme="dark"] .ex-find-group{border-color:#36404b}
:root[data-theme="dark"] .ex-find-list li{border-color:#36404b}
:root[data-theme="dark"] .ex-find-results mark,:root[data-theme="dark"] .ex-note mark.ex-find-hl{background:#1e3a8a;color:#fff}
:root[data-theme="dark"] .ex-resume{border-color:#36404b;border-left-color:var(--ex-accent);box-shadow:0 -8px 0 var(--bg),0 6px 16px -10px rgba(0,0,0,.7)}
:root[data-theme="dark"] .ex-ans-bar{border-color:#36404b}
:root[data-theme="dark"] body.ex-quiz .ex-q:not(.ex-done):not(.ex-unanswered){box-shadow:inset 4px 0 0 #4a6178}
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
