#!/usr/bin/env python
"""Replace one explicit static-asset cache version across deployable text files."""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SUFFIXES = {".html", ".js"}
SKIP_PARTS = {".git", "node_modules", "test-results", "playwright-report"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("old", help="current numeric cache version")
    parser.add_argument("new", help="next numeric cache version")
    args = parser.parse_args()
    if not (args.old.isdigit() and args.new.isdigit() and int(args.new) > int(args.old)):
        raise SystemExit("cache versions must be numeric and new must be greater than old")

    needle = f"v={args.old}"
    replacement = f"v={args.new}"
    changed = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUFFIXES:
            continue
        if SKIP_PARTS.intersection(path.relative_to(ROOT).parts):
            continue
        source = path.read_text(encoding="utf-8")
        if needle not in source:
            continue
        path.write_text(source.replace(needle, replacement), encoding="utf-8", newline="\n")
        changed.append(path.relative_to(ROOT).as_posix())

    if not changed:
        raise SystemExit(f"no files contained {needle}")
    print(f"Replaced {needle} with {replacement} in {len(changed)} files")


if __name__ == "__main__":
    main()
