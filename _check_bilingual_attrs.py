#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit bilingual data-zh / data-en attribute consistency.

HsiaoEye renders bilingual content by toggling `data-zh` and `data-en`
attribute values into innerHTML at runtime. If only one side is populated,
the toggle reveals empty content in the missing language.

Rules:
  1. An element with `data-zh` should also have `data-en` (and vice versa).
  2. Both values should be non-empty after stripping whitespace.
  3. Skip elements with `data-bilingual="optional"` (explicit opt-out).

Exit code:
  0 → all good
  1 → ≥ 1 ERROR found (fail CI)
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".git", "node_modules", "__pycache__", "pagefind", "tests", "_bin"}
SKIP_FILES = {"offline.html", "404.html"}


def audit_file(path: Path) -> list[str]:
    # Use HTMLParser (attribute-aware) instead of regex — regex breaks
    # when data-zh values contain embedded <a href=\"...\"> markup with
    # backslash-escaped quotes, mis-counting attribute boundaries.
    from html.parser import HTMLParser

    rel = path.relative_to(ROOT).as_posix()
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return [f"{rel}: read error: {exc}"]

    issues: list[str] = []

    class _Auditor(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)

        def handle_starttag(self, tag, attrs):
            ad = dict(attrs)
            if ad.get("data-bilingual") == "optional":
                return
            zh = ad.get("data-zh")
            en = ad.get("data-en")
            if zh is None and en is None:
                return
            if zh is not None and en is None:
                preview = (zh or "").strip()[:40]
                issues.append(f"{rel}: <{tag}> has data-zh but no data-en: {preview!r}")
            elif en is not None and zh is None:
                preview = (en or "").strip()[:40]
                issues.append(f"{rel}: <{tag}> has data-en but no data-zh: {preview!r}")
            else:
                if zh is not None and not zh.strip():
                    issues.append(f"{rel}: <{tag}> data-zh is empty")
                if en is not None and not en.strip():
                    issues.append(f"{rel}: <{tag}> data-en is empty")

    parser = _Auditor()
    try:
        parser.feed(text)
    except Exception as exc:
        issues.append(f"{rel}: HTMLParser error: {exc}")
    return issues


def main() -> int:
    errors: list[str] = []
    for path in sorted(ROOT.rglob("*.html")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.name in SKIP_FILES:
            continue
        errors.extend(audit_file(path))

    if errors:
        print(f"[FAIL] Bilingual attribute audit found {len(errors)} issue(s):")
        for err in errors[:80]:
            print(" - " + err)
        if len(errors) > 80:
            print(f"   ...{len(errors) - 80} more")
        return 1
    print("[OK] Bilingual attribute audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
