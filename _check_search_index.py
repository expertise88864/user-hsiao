"""
HsiaoEye: verify assets/search-index.json tracks the published bilingual catalog.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
INDEX = ROOT / "assets" / "search-index.json"
SHARED = ROOT / "blog" / "blog-shared.js"


def parse_catalog() -> tuple[list[str], list[str], list[str]]:
    js = (ROOT / "blog" / "blog-shared.js").read_text(encoding="utf-8")
    articles = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not articles:
        raise SystemExit("[FAIL] DN.ARTICLES not found")
    slugs = set(re.findall(r"slug:\s*'([^']+)'", articles.group(1)))
    stubs_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stubs_match.group(1))) if stubs_match else set()
    en_stubs_match = re.search(r"DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    en_stubs = set(re.findall(r"'([^']+)'", en_stubs_match.group(1))) if en_stubs_match else set()
    return sorted(slugs - stubs), sorted(stubs), sorted(en_stubs)


def path_exists(url_path: str) -> bool:
    clean = url_path.strip("/")
    candidates = [
        ROOT / f"{clean}.html",
        ROOT / clean / "index.html",
        ROOT / clean,
    ]
    return any(path.exists() for path in candidates)


def main() -> int:
    published, stubs, en_stubs = parse_catalog()
    errors: list[str] = []

    if not INDEX.exists():
        print("[FAIL] assets/search-index.json missing")
        return 1

    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[FAIL] assets/search-index.json invalid JSON: {exc}")
        return 1

    if not isinstance(data, list):
        print("[FAIL] assets/search-index.json must be a JSON array")
        return 1

    expected_urls = set()
    for slug in published:
        expected_urls.add(f"/blog/{slug}")
        if slug not in en_stubs:
            expected_urls.add(f"/en/blog/{slug}")
    seen_urls = set()
    seen_pairs = set()

    for i, item in enumerate(data):
        if not isinstance(item, dict):
            errors.append(f"entry {i} is not an object")
            continue
        slug = str(item.get("slug", ""))
        lang = str(item.get("lang", ""))
        url = str(item.get("url", ""))
        title = str(item.get("title", ""))
        snippet = str(item.get("snippet", ""))

        if slug in stubs:
            errors.append(f"stub article leaked into search index: {slug}")
        if lang == "en" and slug in en_stubs:
            errors.append(f"untranslated English mirror leaked into search index: {slug}")
        if slug not in published:
            errors.append(f"unknown/unpublished slug indexed: {slug}")
        if lang not in {"zh-Hant-TW", "en"}:
            errors.append(f"{slug}: invalid lang {lang!r}")
        if not url.startswith("/") or url.startswith("//"):
            errors.append(f"{slug}: unsafe URL {url!r}")
        elif not path_exists(url):
            errors.append(f"{slug}: URL has no file {url}")
        if not title or len(title) < 8:
            errors.append(f"{slug}: title missing/too short")
        if not snippet or len(snippet) < 40:
            errors.append(f"{slug}: snippet missing/too short")
        if "\ufffd" in title + snippet or "????" in title + snippet:
            errors.append(f"{slug}: mojibake marker found")

        seen_urls.add(url)
        seen_pairs.add((slug, lang))

    missing_urls = sorted(expected_urls - seen_urls)
    if missing_urls:
        errors.extend(f"missing indexed URL: {url}" for url in missing_urls)

    for slug in published:
        if (slug, "zh-Hant-TW") not in seen_pairs:
            errors.append(f"missing zh-Hant-TW entry: {slug}")
        if slug not in en_stubs and (slug, "en") not in seen_pairs:
            errors.append(f"missing en entry: {slug}")

    expected_count = len(published) * 2 - len(set(published) & set(en_stubs))
    if len(data) != expected_count:
        errors.append(f"expected {expected_count} entries, found {len(data)}")

    shared = SHARED.read_text(encoding="utf-8")
    if "/assets/search-index.json" not in shared:
        errors.append("Cmd+K runtime does not fetch assets/search-index.json")
    if "DN.isStub && DN.isStub(a.slug)" not in shared:
        errors.append("Cmd+K catalog fallback does not filter DN.STUB_SLUGS")
    if "cmdkEscape(" not in shared:
        errors.append("Cmd+K runtime should HTML-escape generated result rows")

    if errors:
        print("[FAIL] search-index audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    print(f"[OK] search-index audit passed: {len(published)} ZH articles + {len(published) - len(set(published) & set(en_stubs))} publishable EN mirrors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
