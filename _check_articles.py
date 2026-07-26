#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Validate DN.ARTICLES array structure."""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('blog/blog-shared.js', 'r', encoding='utf-8') as f:
    src = f.read()

m = re.search(r'DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);', src)
if not m:
    print('DN.ARTICLES not found')
    sys.exit(1)

arr_str = m.group(1)

# Strip strings AND comments before counting delimiters.
# Comments must go too (round-2 review): otherwise a `,,` / `}{` / a lone
# bracket inside a `// ...` note false-positives, and — worse — a hole
# written as `, /* removed */ ,` hides from the array-hole test below.
out = []
i = 0
n = len(arr_str)
last_signif = ''
# A `/` in VALUE position starts a regex literal, not a comment. Without this,
# `pattern:/\/\//` hits the `//` inside the regex and the rest of the line is
# swallowed as a comment — which would hide a real `,,` hole further along.
REGEX_OK_AFTER = {'', '=', '(', ',', ';', ':', '!', '&', '|', '?',
                  '{', '}', '[', '+', '-', '*', '%', '<', '>', '~', '^'}
while i < n:
    c = arr_str[i]
    nxt = arr_str[i + 1] if i + 1 < n else ''
    if c == '/' and nxt == '/':
        j = arr_str.find('\n', i + 2)
        i = n if j == -1 else j
        continue
    if c == '/' and nxt == '*':
        j = arr_str.find('*/', i + 2)
        i = n if j == -1 else j + 2
        continue
    if c == '/' and last_signif in REGEX_OK_AFTER:
        j = i + 1
        in_class = False
        closed = False
        while j < n:
            ch = arr_str[j]
            if ch == '\\':
                j += 2
                continue
            if ch == '[':
                in_class = True
            elif ch == ']':
                in_class = False
            elif ch == '/' and not in_class:
                closed = True
                j += 1
                while j < n and arr_str[j].isalpha():   # flags
                    j += 1
                break
            elif ch == '\n':
                break
            j += 1
        if closed:
            last_signif = '/'
            i = j
            continue
    if c in ("'", '"', '`'):
        q = c
        j = i + 1
        while j < n:
            if arr_str[j] == "\\":
                j += 2
                continue
            if arr_str[j] == q:
                j += 1
                break
            j += 1
        last_signif = q
        i = j
        continue
    out.append(c)
    if not c.isspace():
        last_signif = c
    i += 1

stripped = ''.join(out)
print(f'DN.ARTICLES inner stripped of strings: {len(stripped)} chars')
print(f'  braces: {{ {stripped.count("{")} / }} {stripped.count("}")}')
print(f'  brackets: [ {stripped.count("[")} / ] {stripped.count("]")}')

# ── Issues ────────────────────────────────────────────────────────────────
# 2026-07 round-2 review: these checks previously only PRINTED and the script
# still exited 0, so `_check_all.py` (which keys off the return code) reported
# OK no matter what. They now fail the gate.
#
# Why this checker still earns its place next to `node --check`
# (_check_js_syntax.py):
#   • `}{` (missing comma between objects) IS a syntax error, so node catches
#     it too — kept here for the better diagnostic.
#   • `,,` is NOT a syntax error: `[{a},,{b}]` is a legal array HOLE. node
#     passes it, but the hole becomes an `undefined` entry — every consumer
#     doing `a.slug` throws at runtime on every page, while the Python
#     generators (regex `\{[\s\S]*?\}`) silently skip it, desyncing the
#     catalog from sitemap/feeds/listings. Nothing else guards this.
errors = []

# Test the STRING-STRIPPED text, not the raw source: a title legitimately
# containing ",," would otherwise false-positive.
# `,\s*,` — not just `,,`: comments are already stripped above, so a hole
# written as `, ,` or `, /* removed */ ,` collapses to whitespace and is
# still caught here.
if re.search(r',\s*,', stripped):
    errors.append('double comma (array hole) in DN.ARTICLES — '
                  'creates an undefined entry; consumers will throw')
adj = re.search(r'\}\s*\{', stripped)
if adj:
    pos = adj.start()
    errors.append('adjacent objects without a comma — SYNTAX ERROR near '
                  f'stripped offset {pos}: ...{stripped[max(0, pos - 50):pos + 50]}...')

if stripped.count('{') != stripped.count('}'):
    errors.append(f'unbalanced braces: {stripped.count("{")} open / {stripped.count("}")} close')
if stripped.count('[') != stripped.count(']'):
    errors.append(f'unbalanced brackets: {stripped.count("[")} open / {stripped.count("]")} close')

if errors:
    print('[FAIL] DN.ARTICLES structure audit')
    for e in errors:
        print(' - ' + e)
    sys.exit(1)

print('[OK] DN.ARTICLES structure audit passed')
