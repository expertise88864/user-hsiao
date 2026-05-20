"""
HsiaoEye: verify article MedicalWebPage JSON-LD is connected to article schema.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = "https://hsiao.chendermatologist.com"
PERSON_ID = f"{DOMAIN}/about#person"


def parse_catalog() -> list[str]:
    js = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    articles = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not articles:
        raise SystemExit("[FAIL] DN.ARTICLES not found")
    stubs_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stubs_match.group(1))) if stubs_match else set()
    slugs = re.findall(r"slug:\s*'([^']+)'", articles.group(1))
    return [slug for slug in slugs if slug not in stubs]


def type_names(obj: dict) -> set[str]:
    value = obj.get("@type")
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def jsonld_blocks(path: Path) -> list[dict]:
    src = path.read_text(encoding="utf-8")
    blocks = []
    for raw in re.findall(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>', src, re.S):
        blocks.append(json.loads(raw.strip()))
    return [block for block in blocks if isinstance(block, dict)]


def ref_id(value) -> str:
    return str(value.get("@id") or "") if isinstance(value, dict) else str(value or "")


def image_url(value) -> str:
    if isinstance(value, dict):
        return str(value.get("url") or value.get("contentUrl") or "")
    return str(value or "")


def audit_page(path: Path, canonical_path: str, slug: str) -> list[str]:
    errors: list[str] = []
    url = f"{DOMAIN}{canonical_path}"
    article_id = f"{url}#article"
    webpage_id = f"{url}#webpage"
    image = f"{DOMAIN}/assets/og/{slug}.png"

    try:
        blocks = jsonld_blocks(path)
    except Exception as exc:
        return [f"{path.relative_to(ROOT).as_posix()}: JSON-LD parse error: {exc}"]

    article = next(
        (b for b in blocks if type_names(b) & {"Article", "BlogPosting", "MedicalScholarlyArticle"}),
        None,
    )
    webpage = next((b for b in blocks if "MedicalWebPage" in type_names(b)), None)
    if not article:
        return [f"{path.relative_to(ROOT).as_posix()}: missing article JSON-LD"]
    if not webpage:
        return [f"{path.relative_to(ROOT).as_posix()}: missing MedicalWebPage JSON-LD"]

    if article.get("@id") != article_id:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: Article @id mismatch")
    if article.get("mainEntityOfPage") != url:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: Article mainEntityOfPage mismatch")
    if image_url(article.get("image")) != image:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: Article image mismatch")
    if article.get("thumbnailUrl") != image:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: Article thumbnailUrl mismatch")

    if webpage.get("@id") != webpage_id:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage @id mismatch")
    if webpage.get("url") != url:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage url mismatch")
    if image_url(webpage.get("image")) != image:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage image mismatch")
    if webpage.get("thumbnailUrl") != image:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage thumbnailUrl mismatch")
    if ref_id(webpage.get("primaryImageOfPage")) != f"{url}#primaryimage":
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage primaryImageOfPage mismatch")
    if ref_id(webpage.get("mainEntity")) != article_id:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage mainEntity must point to Article @id")
    if len(str(webpage.get("description") or "")) < 50:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage description missing/too short")
    if webpage.get("datePublished") != article.get("datePublished"):
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage datePublished mismatch")
    if webpage.get("dateModified") != article.get("dateModified"):
        errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage dateModified mismatch")
    for key in ("author", "publisher", "reviewedBy"):
        if ref_id(webpage.get(key)) != PERSON_ID:
            errors.append(f"{path.relative_to(ROOT).as_posix()}: MedicalWebPage {key} should reference {PERSON_ID}")
    return errors


def main() -> int:
    errors: list[str] = []
    for slug in parse_catalog():
        errors.extend(audit_page(ROOT / "blog" / f"{slug}.html", f"/blog/{slug}", slug))
        errors.extend(audit_page(ROOT / "en" / "blog" / f"{slug}.html", f"/en/blog/{slug}", slug))

    if errors:
        print("[FAIL] MedicalWebPage schema audit failed:")
        for err in errors[:120]:
            print("  - " + err)
        if len(errors) > 120:
            print(f"  ... {len(errors) - 120} more")
        return 1

    print(f"[OK] MedicalWebPage schema audit passed: {len(parse_catalog())} article pairs are connected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
