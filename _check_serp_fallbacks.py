#!/usr/bin/env python3
"""Audit SERP/social fallback text used by metadata generators."""

from __future__ import annotations

import sys
from pathlib import Path

import _gen_serp_meta as serp
import _gen_site_graph as site_graph


ROOT = Path(__file__).resolve().parent


def main() -> int:
    errors: list[str] = []
    catalog = serp.read_catalog()
    expected_slugs = {row["slug"] for row in catalog}
    actual_slugs = set(serp.ARTICLE_SNIPPETS)

    missing = sorted(expected_slugs - actual_slugs)
    extra = sorted(actual_slugs - expected_slugs)
    if missing:
        errors.append("missing article fallback snippets: " + ", ".join(missing))
    if extra:
        errors.append("stale article fallback snippets: " + ", ".join(extra))

    for rel, snippet in serp.STATIC_SNIPPETS.items():
        if serp.bad_snippet(snippet, 50):
            errors.append(f"{rel}: static fallback snippet is too short or likely corrupted")
        if not (ROOT / rel).exists():
            errors.append(f"{rel}: static fallback target does not exist")

    for slug, snippet in serp.ARTICLE_SNIPPETS.items():
        if serp.bad_snippet(snippet, 70):
            errors.append(f"{slug}: article fallback snippet is too short or likely corrupted")
        if not (ROOT / "blog" / f"{slug}.html").exists():
            errors.append(f"{slug}: article fallback target does not exist")

    for schema_type, path, name, description in site_graph.ZH_PARTS + site_graph.EN_PARTS:
        if not schema_type or not path.startswith("/"):
            errors.append(f"{path or '<missing>'}: malformed WebSite hasPart entry")
        if len(name.strip()) < 2 or name.count("?") >= 3:
            errors.append(f"{path}: hasPart name is too short or likely corrupted")
        if serp.bad_snippet(description, 20):
            errors.append(f"{path}: hasPart description is too short or likely corrupted")

    if errors:
        print("[FAIL] SERP fallback audit found issues:")
        for error in errors:
            print(" - " + error)
        return 1

    print("[OK] SERP fallback audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
