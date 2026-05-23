#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Audit GitHub Actions workflows for deprecated Node 20-era pins."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKFLOWS = ROOT / ".github" / "workflows"

FORBIDDEN = [
    (re.compile(r"actions/checkout@v4\b"), "use actions/checkout@v5"),
    (re.compile(r"actions/setup-python@v5\b"), "use actions/setup-python@v6"),
    (re.compile(r"actions/setup-node@v4\b"), "use actions/setup-node@v6"),
    (re.compile(r"node-version:\s*['\"]?20['\"]?"), "use Node 24 for browser/JS jobs"),
    (
        re.compile(r"FORCE_JAVASCRIPT_ACTIONS_TO_NODE24"),
        "upgrade actions instead of forcing their runtime",
    ),
]


def main() -> int:
    errors: list[str] = []
    for path in sorted(WORKFLOWS.glob("*.yml")):
        src = path.read_text(encoding="utf-8")
        for pattern, message in FORBIDDEN:
            for match in pattern.finditer(src):
                line = src.count("\n", 0, match.start()) + 1
                rel = path.relative_to(ROOT).as_posix()
                errors.append(f"{rel}:{line}: {message}")

    if errors:
        print("[FAIL] workflow audit found deprecated CI pins:")
        for error in errors:
            print("  - " + error)
        return 1

    print("[OK] workflow audit passed: CI uses Node 24-era action pins")
    return 0


if __name__ == "__main__":
    sys.exit(main())
