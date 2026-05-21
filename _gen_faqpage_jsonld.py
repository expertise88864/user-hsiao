#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate clean FAQPage JSON-LD from visible Chinese FAQ blocks.

The homepage contains a strong patient-intent FAQ section that can help search
result presentation. Older generated FAQ markup was too broad: it scanned raw
HTML, which leaked data-en attributes into Chinese answers and could touch
draft/noindex pages. This generator is intentionally conservative:

* only indexable Chinese source pages are candidates;
* English mirrors and noindex/stub pages never receive auto FAQ schema;
* pages with hand-authored FAQPage JSON-LD are left alone to avoid duplicates;
* text is extracted from visible Chinese/data-zh content via BeautifulSoup.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup, NavigableString, Tag

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
BLOG = ROOT / "blog"
DOMAIN = "https://hsiao.chendermatologist.com"
LANG = "zh-Hant-TW"
MAX_FAQS_PER_PAGE = 15

AUTO_FAQ_RE = re.compile(
    r'<script\b(?=[^>]*\btype=["\']application/ld\+json["\'])(?=[^>]*\bdata-faq-auto\b)[^>]*>[\s\S]*?</script>\s*',
    re.IGNORECASE,
)
JSONLD_RE = re.compile(
    r'(<script\b(?=[^>]*\btype=["\']application/ld\+json["\'])[^>]*>)([\s\S]*?)(</script>\s*)',
    re.IGNORECASE,
)


def clean_text(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip()
    return value


def cjk_ratio(value: str) -> float:
    if not value:
        return 0.0
    return len(re.findall(r"[\u4e00-\u9fff]", value)) / max(len(value), 1)


def parse_catalog() -> tuple[set[str], set[str]]:
    js = (BLOG / "blog-shared.js").read_text(encoding="utf-8")
    articles_match = re.search(r"DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];", js)
    slugs = set(re.findall(r"slug:\s*'([^']+)'", articles_match.group(1))) if articles_match else set()
    stubs_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stubs_match.group(1))) if stubs_match else set()
    return slugs, stubs


def is_noindex(src: str) -> bool:
    return bool(re.search(r'<meta\s+name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', src, re.I))


def jsonld_types(value) -> set[str]:
    if isinstance(value, list):
        out: set[str] = set()
        for item in value:
            out |= jsonld_types(item)
        return out
    if not isinstance(value, dict):
        return set()
    typ = value.get("@type")
    out = set(str(x) for x in typ) if isinstance(typ, list) else ({str(typ)} if typ else set())
    graph = value.get("@graph")
    if isinstance(graph, list):
        out |= jsonld_types(graph)
    return out


def has_manual_faqpage(src: str) -> bool:
    soup = BeautifulSoup(src, "html.parser")
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        if script.has_attr("data-faq-auto"):
            continue
        raw = script.string or script.get_text()
        try:
            data = json.loads(raw.strip())
        except Exception:
            continue
        if "FAQPage" in jsonld_types(data):
            return True
    return False


def zh_text(node) -> str:
    if isinstance(node, NavigableString):
        return str(node)
    if not isinstance(node, Tag):
        return ""
    if node.name in {"script", "style", "svg", "noscript"}:
        return ""
    data_zh = node.get("data-zh")
    if data_zh:
        return BeautifulSoup(data_zh, "html.parser").get_text(" ", strip=True)
    return " ".join(zh_text(child) for child in node.children)


def answer_text(details: Tag) -> str:
    clone = BeautifulSoup(str(details), "html.parser")
    summary = clone.find("summary")
    if summary:
        summary.decompose()
    return clean_text(zh_text(clone))


QUESTION_HINT_RE = re.compile(r"[?？]|^(迷思|Q\d+|Q[:：])|為什麼|怎麼|何時|哪些|誰|要不要|是否|可以嗎|一定要|代表什麼")
NON_FAQ_RE = re.compile(r"本篇大綱|In this article|點擊收合|Click to collapse|目錄|Table of contents")


def looks_like_question(q: str) -> bool:
    if not q or NON_FAQ_RE.search(q):
        return False
    if len(q) > 140:
        return False
    return bool(QUESTION_HINT_RE.search(q))


def extract_faqs(src: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(src, "html.parser")
    scope = soup.find("article") or soup.find("main") or soup
    faqs: list[dict[str, str]] = []
    seen: set[str] = set()
    for details in scope.find_all("details"):
        summary = details.find("summary")
        if not summary:
            continue
        q = clean_text(zh_text(summary))
        a = answer_text(details)
        if not looks_like_question(q) or len(a) < 20:
            continue
        if cjk_ratio(q + a) < 0.18:
            continue
        if q in seen:
            continue
        seen.add(q)
        faqs.append({"q": q, "a": a[:5000]})
        if len(faqs) >= MAX_FAQS_PER_PAGE:
            break
    return faqs


def remove_old(src: str) -> str:
    return AUTO_FAQ_RE.sub("", src)


def url_for(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return f"{DOMAIN}/"
    if rel.startswith("blog/") and rel.endswith(".html"):
        return f"{DOMAIN}/blog/{Path(rel).stem}"
    raise ValueError(f"Unsupported FAQ candidate: {rel}")


def sanitize_schema_text(value: str) -> str:
    """Clean old FAQ text that was scraped from raw bilingual HTML."""
    text = str(value or "")
    attr = re.search(r'["\']?\s+data-(?:en|zh)\s*=\s*["\']', text, re.I)
    if attr:
        text = text[:attr.start()]
    text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
    text = clean_text(text)
    return text.strip(' "\'>')


def normalize_faqpage(data: dict, path: Path) -> tuple[dict, int]:
    page_url = url_for(path)
    out = dict(data)
    out["@context"] = out.get("@context") or "https://schema.org"
    out["@type"] = "FAQPage"
    out["@id"] = f"{page_url}#faq"
    out["url"] = page_url
    out["inLanguage"] = LANG
    out["isAccessibleForFree"] = True

    normalized = []
    seen: set[str] = set()
    for item in out.get("mainEntity") or []:
        if not isinstance(item, dict):
            continue
        q = sanitize_schema_text(item.get("name", ""))
        ans = item.get("acceptedAnswer")
        a = sanitize_schema_text(ans.get("text", "") if isinstance(ans, dict) else "")
        if not looks_like_question(q) or len(a) < 20:
            continue
        if cjk_ratio(q + a) < 0.18:
            continue
        if q in seen:
            continue
        seen.add(q)
        normalized.append(
            {
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": a[:5000],
                },
            }
        )
        if len(normalized) >= MAX_FAQS_PER_PAGE:
            break
    out["mainEntity"] = normalized
    return out, len(normalized)


def normalize_existing_faqpages(src: str, path: Path) -> tuple[str, int, int]:
    blocks = 0
    questions = 0

    def repl(match: re.Match) -> str:
        nonlocal blocks, questions
        raw = match.group(2).strip()
        try:
            data = json.loads(raw)
        except Exception:
            return match.group(0)
        if not isinstance(data, dict) or "FAQPage" not in jsonld_types(data):
            return match.group(0)
        normalized, n_questions = normalize_faqpage(data, path)
        if n_questions < 2:
            return ""
        blocks += 1
        questions += n_questions
        dumped = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
        return f"{match.group(1)}{dumped}{match.group(3)}"

    return JSONLD_RE.sub(repl, src), blocks, questions


def inject(src: str, path: Path, faqs: list[dict[str, str]]) -> str:
    page_url = url_for(path)
    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": f"{page_url}#faq",
        "url": page_url,
        "inLanguage": LANG,
        "isAccessibleForFree": True,
        "mainEntity": [
            {
                "@type": "Question",
                "name": item["q"],
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": item["a"],
                },
            }
            for item in faqs
        ],
    }
    block = (
        '<script type="application/ld+json" data-faq-auto>'
        + json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
        + "</script>"
    )
    clean = remove_old(src)
    return clean.replace("</head>", block + "</head>", 1)


def candidate_paths() -> Iterable[Path]:
    slugs, stubs = parse_catalog()
    yield ROOT / "index.html"
    for slug in sorted(slugs - stubs):
        path = BLOG / f"{slug}.html"
        if path.exists():
            yield path


def cleanup_non_candidates(candidates: set[Path]) -> tuple[int, int]:
    changed = 0
    removed = 0
    paths = [ROOT / "en" / "index.html", *BLOG.glob("*.html"), *(ROOT / "en" / "blog").glob("*.html")]
    for path in paths:
        if path in candidates or not path.exists():
            continue
        src = path.read_text(encoding="utf-8")
        new = remove_old(src)
        if new != src:
            path.write_text(new, encoding="utf-8")
            changed += 1
            removed += 1
    return changed, removed


def main() -> int:
    candidates = set(candidate_paths())
    cleaned_files, stale_blocks = cleanup_non_candidates(candidates)
    changed_files = cleaned_files
    injected_files = 0
    manual_files = 0
    manual_faqs = 0
    skipped = 0
    total_faqs = 0

    for path in sorted(candidates):
        src = path.read_text(encoding="utf-8")
        clean = remove_old(src)
        rel = path.relative_to(ROOT).as_posix()

        if is_noindex(clean):
            if clean != src:
                path.write_text(clean, encoding="utf-8")
                changed_files += 1
            skipped += 1
            print(f"  skip {rel}: noindex")
            continue

        normalized, manual_blocks, manual_questions = normalize_existing_faqpages(clean, path)
        if manual_blocks:
            if normalized != src:
                path.write_text(normalized, encoding="utf-8")
                changed_files += 1
            manual_files += 1
            manual_faqs += manual_questions
            skipped += 1
            print(f"  normalize {rel}: {manual_blocks} FAQPage block(s), {manual_questions} Q&A")
            continue

        faqs = extract_faqs(normalized)
        if len(faqs) < 2:
            if clean != src:
                path.write_text(clean, encoding="utf-8")
                changed_files += 1
            skipped += 1
            print(f"  skip {rel}: only {len(faqs)} FAQ candidate(s)")
            continue

        new = inject(clean, path, faqs)
        if new != src:
            path.write_text(new, encoding="utf-8")
            changed_files += 1
        injected_files += 1
        total_faqs += len(faqs)
        print(f"  {rel}: {len(faqs)} FAQs")

    print(
        f"\nFAQPage schema: {injected_files} auto page(s), {total_faqs} auto Q&A; "
        f"{manual_files} normalized page(s), {manual_faqs} normalized Q&A; "
        f"removed stale blocks from {stale_blocks} page(s); skipped {skipped}; "
        f"changed {changed_files} file(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
