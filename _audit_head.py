#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HsiaoEye — head audit
---------------------
Walks every public .html file and reports which SEO-critical <head> elements
are missing. Used to gap-fill canonical / hreflang / og:* / twitter:* /
JSON-LD across the whole site.

Run:  PYTHONIOENCODING=utf-8 python _audit_head.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_FILES = {'404.html', 'offline.html', 'admin.html', 'dashboard.html'}
SKIP_DIRS = {'.git', 'node_modules', '_tmp_', 'tests'}

# Each check is (label, regex, severity).  severity: "err" = blocker, "warn" = nice-to-have
CHECKS = [
    ('canonical',           re.compile(r'<link[^>]+rel=["\']canonical["\']', re.I),                 'err'),
    ('hreflang',            re.compile(r'<link[^>]+rel=["\']alternate["\'][^>]+hreflang=', re.I),   'err'),
    ('og:title',            re.compile(r'<meta[^>]+property=["\']og:title["\']', re.I),             'err'),
    ('og:description',      re.compile(r'<meta[^>]+property=["\']og:description["\']', re.I),       'warn'),
    ('og:url',              re.compile(r'<meta[^>]+property=["\']og:url["\']', re.I),               'err'),
    ('og:image',            re.compile(r'<meta[^>]+property=["\']og:image["\']', re.I),             'warn'),
    ('og:locale',           re.compile(r'<meta[^>]+property=["\']og:locale["\']', re.I),            'warn'),
    ('twitter:card',        re.compile(r'<meta[^>]+name=["\']twitter:card["\']', re.I),             'warn'),
    ('twitter:title',       re.compile(r'<meta[^>]+name=["\']twitter:title["\']', re.I),            'warn'),
    ('twitter:image',       re.compile(r'<meta[^>]+name=["\']twitter:image["\']', re.I),            'warn'),
    ('meta description',    re.compile(r'<meta[^>]+name=["\']description["\']', re.I),              'err'),
    ('meta keywords',       re.compile(r'<meta[^>]+name=["\']keywords["\']', re.I),                 'warn'),
    ('JSON-LD',             re.compile(r'<script[^>]+type=["\']application/ld\+json["\']', re.I),   'err'),
    ('viewport',            re.compile(r'<meta[^>]+name=["\']viewport["\']', re.I),                 'err'),
    ('charset',             re.compile(r'<meta[^>]+charset=', re.I),                                'err'),
    ('lang attr on <html>', re.compile(r'<html\s+[^>]*lang=', re.I),                                'err'),
    ('title tag',           re.compile(r'<title[^>]*>[^<]+</title>', re.I),                        'err'),
]

def collect():
    files = []
    for d, ds, fs in os.walk(ROOT):
        ds[:] = [x for x in ds if x not in SKIP_DIRS]
        rel_d = os.path.relpath(d, ROOT)
        for f in fs:
            if not f.endswith('.html'):
                continue
            if f in SKIP_FILES:
                continue
            files.append(os.path.join(d, f))
    files.sort()
    return files

def audit_file(p):
    with open(p, 'r', encoding='utf-8') as fh:
        s = fh.read()
    # <html lang=...> lives on the document root, not in head — search full doc
    # for that one. Everything else is restricted to <head> to avoid body
    # injections from masquerading as actual head metadata.
    head_match = re.search(r'<head[^>]*>(.*?)</head>', s, re.DOTALL | re.I)
    head = head_match.group(1) if head_match else s
    findings = []
    for label, rx, sev in CHECKS:
        scope = s if label == 'lang attr on <html>' else head
        if not rx.search(scope):
            findings.append((label, sev))
    return findings

def main():
    files = collect()
    err_total = 0
    warn_total = 0
    pages_with_issues = 0
    print(f'Auditing {len(files)} HTML files...\n')
    for p in files:
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        findings = audit_file(p)
        if not findings:
            continue
        pages_with_issues += 1
        errs  = [(l, s) for l, s in findings if s == 'err']
        warns = [(l, s) for l, s in findings if s == 'warn']
        err_total  += len(errs)
        warn_total += len(warns)
        # Only show files with at least one ERR; warnings-only files are summarised
        if errs:
            print(f'[ERR] {rel}')
            for label, _ in errs:
                print(f'    - missing {label}')
            for label, _ in warns:
                print(f'    ~ (warn) missing {label}')
        else:
            # Pure warnings — single line summary
            warn_labels = ', '.join(l for l, _ in warns)
            print(f'[warn] {rel}: {warn_labels}')
    print('\n' + '-' * 60)
    print(f'Files audited: {len(files)}')
    print(f'Files with issues: {pages_with_issues}')
    print(f'Total ERRORS: {err_total}')
    print(f'Total WARNINGS: {warn_total}')
    print('-' * 60)
    sys.exit(1 if err_total else 0)

if __name__ == '__main__':
    main()
