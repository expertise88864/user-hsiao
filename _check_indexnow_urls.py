#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit IndexNow pings include every public static entry page in both locales."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent
HOST = "hsiao.chendermatologist.com"
WORKFLOW = ROOT / ".github" / "workflows" / "quality.yml"
ADMIN = ROOT / "api" / "admin" / "_indexnow.js"

STATIC_PATHS = [
    "/",
    "/blog",
    "/blog/topics",
    "/about",
    "/tools",
    "/notes",
    "/privacy",
    "/llms.txt",
    "/en",
    "/en/blog",
    "/en/blog/topics",
    "/en/about",
    "/en/tools",
    "/en/notes",
    "/en/privacy",
]


def workflow_pattern(path: str) -> str:
    return f"f'https://{{HOST}}{path}'"


def admin_pattern(path: str) -> str:
    return f"`https://${{HOST}}{path}`"


def main() -> int:
    errors: list[str] = []
    workflow = WORKFLOW.read_text(encoding="utf-8") if WORKFLOW.exists() else ""
    admin = ADMIN.read_text(encoding="utf-8") if ADMIN.exists() else ""

    if not workflow:
        errors.append(".github/workflows/quality.yml missing")
    if not admin:
        errors.append("api/admin/_indexnow.js missing")

    for path in STATIC_PATHS:
        if workflow_pattern(path) not in workflow:
            errors.append(f"quality.yml IndexNow list missing {path}")
        if admin_pattern(path) not in admin:
            errors.append(f"admin IndexNow fallback list missing {path}")

    for source_name, source in [("quality.yml", workflow), ("api/admin/_indexnow.js", admin)]:
        if "/blog/${s}" not in source and "/blog/{s}" not in source:
            errors.append(f"{source_name}: missing Chinese article URL expansion")
        if "/en/blog/${s}" not in source and "/en/blog/{s}" not in source:
            errors.append(f"{source_name}: missing English article URL expansion")

    if errors:
        print("[FAIL] IndexNow URL audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    print(f"[OK] IndexNow URL audit passed: {len(STATIC_PATHS)} static URLs plus article pairs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
