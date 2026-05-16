#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Conservative repository secret leak audit."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "_bin", "tests", "pagefind"}
# Don't scan ourselves — the check script intentionally contains the literal
# regex pattern '-----BEGIN PRIVATE KEY-----' for detection logic.
SKIP_SELF = {"_check_secrets.py"}
TEXT_SUFFIXES = {
    ".cjs",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".py",
    ".toml",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}
SENSITIVE_TRACKED_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
}
SENSITIVE_TRACKED_SUFFIXES = (".pem", ".key", ".p12", ".pfx")

SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("GitHub classic PAT", re.compile(r"\bghp_[A-Za-z0-9_]{30,}\b")),
    ("GitHub fine-grained PAT", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{50,}\b")),
    ("OpenAI API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b")),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{24,}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----")),
    (
        "literal secret assignment",
        re.compile(
            r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|client[_-]?secret|password)\b"
            r"\s*[:=]\s*(['\"])(?!<|your-|example|placeholder|process\.env)[^'\"\n]{16,}\1",
            re.I,
        ),
    ),
]


def tracked_files() -> list[Path]:
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        return [ROOT / line for line in result.stdout.splitlines() if line.strip()]
    except Exception:
        files: list[Path] = []
        for path in ROOT.rglob("*"):
            if path.is_file() and not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
                files.append(path)
        return files


def is_placeholder(text: str) -> bool:
    lowered = text.lower()
    if "..." in text or "example" in lowered or "placeholder" in lowered or "your_" in lowered:
        return True
    # Treat strings of repeated X's as placeholders (ghp_xxxxxxxx, sk_xxxxx, etc.)
    # Real tokens use base62 alphabet; 8+ contiguous x/X is a tell-tale stub.
    if re.search(r"[xX]{8,}", text):
        return True
    return False


def is_in_safe_context(src: str, start: int, end: int) -> bool:
    """True if the match is inside HTML placeholder= attribute or is a regex
    pattern in JS (the literal `'-----BEGIN PRIVATE KEY-----'` used to strip
    headers from user-uploaded PEM keys), not an actual leaked secret."""
    # Look back ~40 chars for placeholder= attribute
    pre = src[max(0, start - 40):start]
    if re.search(r'\bplaceholder\s*=\s*["\']\s*$', pre):
        return True
    # JS string used for replacement / parsing (.replace, regex literal)
    if "replace(/-----BEGIN" in src[max(0, start - 40):end + 40]:
        return True
    if "replace(/-----END" in src[max(0, start - 40):end + 40]:
        return True
    return False


def main() -> int:
    errors: list[str] = []
    for path in tracked_files():
        rel_path = path.relative_to(ROOT)
        rel = rel_path.as_posix()
        if rel_path.name in SKIP_SELF:
            continue
        if any(part in SKIP_DIRS for part in rel_path.parts):
            continue
        name = path.name
        if name in SENSITIVE_TRACKED_NAMES or name.endswith(SENSITIVE_TRACKED_SUFFIXES):
            errors.append(f"{rel}: sensitive file should not be tracked")
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            src = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in SECRET_PATTERNS:
            for match in pattern.finditer(src):
                value = match.group(0)
                if is_placeholder(value):
                    continue
                if is_in_safe_context(src, match.start(), match.end()):
                    continue
                line = src.count("\n", 0, match.start()) + 1
                errors.append(f"{rel}:{line}: possible {label}")

    if errors:
        print("[FAIL] Secret leak audit found issues:")
        for error in errors[:160]:
            print(" - " + error)
        if len(errors) > 160:
            print(f" ... {len(errors) - 160} more")
        return 1
    print("[OK] Secret leak audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
