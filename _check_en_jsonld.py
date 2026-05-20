"""
HsiaoEye: verify English article JSON-LD uses English-facing labels.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = "https://hsiao.chendermatologist.com"


def parse_catalog() -> dict[str, dict[str, str]]:
    js = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    articles = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not articles:
        raise SystemExit("[FAIL] DN.ARTICLES not found")
    stubs_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stubs_match.group(1))) if stubs_match else set()

    def field(body: str, key: str) -> str:
        match = re.search(rf"{key}\s*:\s*'([^']*)'", body)
        return match.group(1).strip() if match else ""

    out: dict[str, dict[str, str]] = {}
    for obj in re.finditer(r"\{([\s\S]*?)\}", articles.group(1)):
        body = obj.group(1)
        slug = field(body, "slug")
        if not slug or slug in stubs:
            continue
        out[slug] = {
            "title_en": field(body, "title_en"),
            "title": field(body, "title"),
        }
    return out


def cjk_ratio(value: str) -> float:
    if not value:
        return 0.0
    cjk = len(re.findall(r"[\u4e00-\u9fff]", value))
    return cjk / max(len(value), 1)


def jsonld_blocks(src: str) -> list[dict]:
    blocks = []
    for raw in re.findall(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>', src, re.S):
        blocks.append(json.loads(raw.strip()))
    return blocks


def type_names(obj: dict) -> set[str]:
    value = obj.get("@type")
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def iter_dicts(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_dicts(child)


def json_text(value) -> str:
    if isinstance(value, dict):
        return " ".join(json_text(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(json_text(v) for v in value)
    return str(value) if isinstance(value, str) else ""


def audit_static_en_faq_pages(errors: list[str]) -> None:
    for path in sorted((ROOT / "en").glob("*.html")):
        src = path.read_text(encoding="utf-8")
        try:
            blocks = jsonld_blocks(src)
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT).as_posix()}: JSON-LD parse error: {exc}")
            continue
        for block in blocks:
            if not isinstance(block, dict) or "FAQPage" not in type_names(block):
                continue
            faq_text = json_text(block.get("mainEntity"))
            if cjk_ratio(faq_text) > 0.25:
                errors.append(f"{path.relative_to(ROOT).as_posix()}: EN FAQPage JSON-LD is Chinese-heavy")


def main() -> int:
    catalog = parse_catalog()
    errors: list[str] = []
    for slug, meta in sorted(catalog.items()):
        path = ROOT / "en" / "blog" / f"{slug}.html"
        if not path.exists():
            errors.append(f"missing EN article page: {slug}")
            continue
        src = path.read_text(encoding="utf-8")
        expected_title = meta["title_en"] or meta["title"] or slug
        expected_url = f"{DOMAIN}/en/blog/{slug}"
        try:
            blocks = jsonld_blocks(src)
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT).as_posix()}: JSON-LD parse error: {exc}")
            continue

        saw_article = False
        saw_breadcrumb = False
        for block in blocks:
            if not isinstance(block, dict):
                continue
            types = type_names(block)
            if types & {"Article", "BlogPosting", "MedicalWebPage", "MedicalScholarlyArticle"}:
                saw_article = True
                label = str(block.get("headline") or block.get("name") or "")
                if expected_title and expected_title not in label:
                    errors.append(f"{slug}: EN article JSON-LD label is not catalog title_en ({label!r})")
                if cjk_ratio(label) > 0.25:
                    errors.append(f"{slug}: EN article JSON-LD label is Chinese-heavy ({label!r})")
                page_url = block.get("mainEntityOfPage") or block.get("url")
                if isinstance(page_url, str) and page_url != expected_url:
                    errors.append(f"{slug}: EN article JSON-LD URL mismatch ({page_url})")
            if "BreadcrumbList" in types:
                saw_breadcrumb = True
                items = block.get("itemListElement")
                last = items[-1] if isinstance(items, list) and items else {}
                label = str(last.get("name") or "") if isinstance(last, dict) else ""
                item = str(last.get("item") or "") if isinstance(last, dict) else ""
                if expected_title and expected_title not in label:
                    errors.append(f"{slug}: EN breadcrumb leaf is not catalog title_en ({label!r})")
                if cjk_ratio(label) > 0.25:
                    errors.append(f"{slug}: EN breadcrumb leaf is Chinese-heavy ({label!r})")
                if item != expected_url:
                    errors.append(f"{slug}: EN breadcrumb leaf URL mismatch ({item})")
            if "MedicalScholarlyArticle" in types:
                for child in iter_dicts(block.get("citation")):
                    if "ScholarlyArticle" not in type_names(child):
                        continue
                    citation_name = str(child.get("name") or "")
                    if citation_name and citation_name == expected_title:
                        errors.append(f"{slug}: citation name was overwritten with page title")
            if "FAQPage" in types:
                faq_text = json_text(block.get("mainEntity"))
                if cjk_ratio(faq_text) > 0.25:
                    errors.append(f"{slug}: EN FAQPage JSON-LD is Chinese-heavy")
        if not saw_article:
            errors.append(f"{slug}: missing article/medical JSON-LD block")
        if not saw_breadcrumb:
            errors.append(f"{slug}: missing BreadcrumbList JSON-LD block")

    audit_static_en_faq_pages(errors)

    if errors:
        print("[FAIL] English JSON-LD audit failed:")
        for err in errors[:120]:
            print("  - " + err)
        if len(errors) > 120:
            print(f"  ... {len(errors) - 120} more")
        return 1
    print(f"[OK] English JSON-LD audit passed: {len(catalog)} article mirrors use English labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
