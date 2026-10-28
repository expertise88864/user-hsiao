#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Check the NHI rule registry (data/nhi/registry.json) against its official sources.

Phase 1 of the NHI / guideline diff engine: no rendering, no scheduling, no
notifications. For every registered rule the checker re-fetches the original
official source, cuts out the registered section, normalizes it and compares
its SHA-256 with the stored fingerprint.

Statuses:
    unchanged   fingerprint matches
    changed     fingerprint differs; a diff against the stored snapshot is printed
    unknown     source unreachable, unreadable or the section markers were not
                found. Unknown is NEVER treated as unchanged.
    pending     candidate rule the site cites but whose original source has not
                been opened and confirmed yet (no fingerprint exists)

Exit codes: 0 every rule unchanged and nothing pending; 1 at least one rule
changed; 2 nothing changed but something is unknown or pending; 3 the registry
itself is invalid.

Usage:
    python tools/nhi_check.py                 check every rule
    python tools/nhi_check.py --json          machine-readable report
    python tools/nhi_check.py --affects blog/x.html | --question 123
                                              reverse lookup, no network
    python tools/nhi_check.py --record ID     fetch ID's source and store its
                                              fingerprint and snapshot; run only
                                              after a person has read the
                                              original and confirmed rule_zh
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import html
import io
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'data' / 'nhi' / 'registry.json'
SNAPSHOTS = ROOT / 'data' / 'nhi' / 'snapshots'
QUESTIONS = ROOT / 'data' / 'exam' / 'questions.json'

DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SHA256 = re.compile(r'^[0-9a-f]{64}$')
RULE_ID = re.compile(r'^[a-z0-9][a-z0-9-]*$')
FORMATS = {'html', 'pdf', 'text'}
RULE_FIELDS = ('id', 'topic', 'rule_zh', 'effective', 'version', 'source', 'section', 'affects')
TIMEOUT = 30
USER_AGENT = 'HsiaoEye-nhi-check/1 (+https://hsiao.chendermatologist.com)'


class RegistryError(ValueError):
    pass


class FetchError(Exception):
    pass


def html_to_text(raw: str) -> str:
    raw = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<!--.*?-->', ' ', raw)
    return html.unescape(re.sub(r'<[^>]+>', ' ', raw))


def pdf_to_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise FetchError('pypdf is not installed; cannot read PDF sources') from exc
    try:
        return '\n'.join(page.extract_text() or '' for page in PdfReader(io.BytesIO(data)).pages)
    except Exception as exc:  # pypdf raises many exception types on bad input
        raise FetchError(f'unreadable PDF: {exc}') from exc


def normalize(text: str) -> str:
    """Fold full-/half-width forms and drop all whitespace.

    PDF and HTML extraction insert line breaks and spaces inside Chinese text at
    arbitrary places, so whitespace carries no meaning for the fingerprint.
    """
    text = unicodedata.normalize('NFKC', text)
    return re.sub(r'\s+', '', text)


def extract_section(text: str, section: dict) -> str:
    """Return the normalized text from section.start up to (not including) section.end."""
    norm = normalize(text)
    start = normalize(section['start'])
    begin = norm.find(start)
    if begin < 0:
        raise LookupError(f'start marker not found: {section["start"]}')
    end_marker = section.get('end')
    if not end_marker:
        return norm[begin:]
    stop = norm.find(normalize(end_marker), begin + len(start))
    if stop < 0:
        raise LookupError(f'end marker not found: {end_marker}')
    return norm[begin:stop]


def fingerprint(section_text: str) -> str:
    return hashlib.sha256(section_text.encode('utf-8')).hexdigest()


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.read()
    except Exception as exc:  # URLError, HTTPError, timeouts, TLS errors, proxy refusals
        raise FetchError(f'{type(exc).__name__}: {exc}') from exc


def source_text(data: bytes, fmt: str) -> str:
    if fmt == 'pdf':
        return pdf_to_text(data)
    text = data.decode('utf-8', errors='replace')
    return html_to_text(text) if fmt == 'html' else text


def load_registry(path: Path = REGISTRY) -> dict:
    try:
        registry = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise RegistryError(f'{path}: {exc}') from exc
    validate_registry(registry)
    return registry


def _validate_affects(where: str, affects, root: Path, question_count) -> list[str]:
    errors = []
    if not isinstance(affects, dict) or set(affects) != {'articles', 'questions'}:
        return [f'{where}: affects must have exactly "articles" and "questions"']
    for article in affects['articles']:
        if not isinstance(article, str) or not re.fullmatch(r'blog/[a-z0-9-]+\.html', article):
            errors.append(f'{where}: bad article path {article!r}')
        elif not (root / article).is_file():
            errors.append(f'{where}: article does not exist: {article}')
    for number in affects['questions']:
        if not isinstance(number, int) or isinstance(number, bool) or number < 1:
            errors.append(f'{where}: bad question number {number!r}')
        elif question_count is not None and number > question_count:
            errors.append(f'{where}: question {number} is outside the bank (1–{question_count})')
    return errors


def validate_registry(registry: dict, root: Path = ROOT) -> None:
    errors = []
    if not isinstance(registry, dict) or registry.get('schema_version') != 1:
        raise RegistryError('registry must be an object with schema_version 1')
    rules = registry.get('rules')
    pending = registry.get('pending')
    if not isinstance(rules, list) or not isinstance(pending, list):
        raise RegistryError('registry needs "rules" and "pending" lists')
    question_count = None
    questions_path = root / 'data' / 'exam' / 'questions.json'
    if questions_path.is_file():
        question_count = len(json.loads(questions_path.read_text(encoding='utf-8')))
    seen = set()
    for index, rule in enumerate(rules):
        where = f'rules[{index}]'
        if not isinstance(rule, dict):
            errors.append(f'{where}: not an object')
            continue
        missing = [field for field in RULE_FIELDS if not rule.get(field)]
        if missing:
            errors.append(f'{where}: missing {", ".join(missing)}')
            continue
        where = f'rule {rule["id"]}'
        if not RULE_ID.match(rule['id']):
            errors.append(f'{where}: bad id')
        if rule['id'] in seen:
            errors.append(f'{where}: duplicate id')
        seen.add(rule['id'])
        if not DATE.match(rule['effective']):
            errors.append(f'{where}: effective must be YYYY-MM-DD')
        source = rule['source']
        if not isinstance(source, dict) or not all(source.get(k) for k in ('title', 'url', 'retrieved', 'format')):
            errors.append(f'{where}: source needs title, url, retrieved and format')
        else:
            if not source['url'].startswith('https://'):
                errors.append(f'{where}: source url must be https')
            if not DATE.match(source['retrieved']):
                errors.append(f'{where}: retrieved must be YYYY-MM-DD')
            if source['format'] not in FORMATS:
                errors.append(f'{where}: format must be one of {sorted(FORMATS)}')
        if not isinstance(rule['section'], dict) or not rule['section'].get('start'):
            errors.append(f'{where}: section needs a start marker')
        # null = entered from the opened original but not yet recorded with --record
        if 'fingerprint' not in rule or not (rule['fingerprint'] is None or SHA256.match(str(rule['fingerprint']))):
            errors.append(f'{where}: fingerprint must be null or a sha256 hex digest')
        errors.extend(_validate_affects(where, rule['affects'], root, question_count))
    for index, item in enumerate(pending):
        where = f'pending[{index}]'
        if not isinstance(item, dict) or not all(item.get(k) for k in ('id', 'topic', 'site_cites', 'blocker')):
            errors.append(f'{where}: needs id, topic, site_cites and blocker')
            continue
        where = f'pending {item["id"]}'
        if item['id'] in seen:
            errors.append(f'{where}: duplicate id')
        seen.add(item['id'])
        # A pending entry has not been confirmed against the original source, so it
        # must not carry anything that would look like confirmed rule content.
        leaked = [k for k in ('rule_zh', 'effective', 'version', 'source', 'fingerprint') if k in item]
        if leaked:
            errors.append(f'{where}: unverified entry must not carry {", ".join(leaked)}')
        errors.extend(_validate_affects(where, item.get('affects'), root, question_count))
    if errors:
        raise RegistryError('\n'.join(errors))


def read_snapshot(rule_id: str, snapshots: Path) -> str | None:
    path = snapshots / f'{rule_id}.txt'
    return path.read_text(encoding='utf-8') if path.is_file() else None


def check_rule(rule: dict, fetcher=fetch, snapshots: Path = SNAPSHOTS) -> dict:
    result = {'id': rule['id'], 'topic': rule['topic'], 'url': rule['source']['url'], 'affects': rule['affects']}
    if rule['fingerprint'] is None:
        return {**result, 'status': 'unknown', 'reason': 'fingerprint not recorded yet (run --record)'}
    try:
        text = source_text(fetcher(rule['source']['url']), rule['source']['format'])
        section = extract_section(text, rule['section'])
    except (FetchError, LookupError) as exc:
        return {**result, 'status': 'unknown', 'reason': str(exc)}
    if not section:
        return {**result, 'status': 'unknown', 'reason': 'empty section'}
    current = fingerprint(section)
    if current == rule['fingerprint']:
        return {**result, 'status': 'unchanged'}
    old = read_snapshot(rule['id'], snapshots)
    if old is None:
        diff = '(no stored snapshot; only the fingerprint differs)'
    else:
        diff = '\n'.join(difflib.unified_diff(_lines(old), _lines(section), 'registered', 'current', lineterm=''))
    return {**result, 'status': 'changed', 'fingerprint': current, 'diff': diff}


def _lines(normalized: str) -> list[str]:
    # Normalized text has no whitespace; break after Chinese full stops and
    # semicolons so the diff stays readable.
    return [line for line in re.split(r'(?<=[。；;])', normalized) if line]


def check_registry(registry: dict, fetcher=fetch, snapshots: Path = SNAPSHOTS) -> list[dict]:
    results = [check_rule(rule, fetcher, snapshots) for rule in registry['rules']]
    for item in registry['pending']:
        results.append({'id': item['id'], 'topic': item['topic'], 'status': 'pending',
                        'reason': item['blocker'], 'affects': item['affects']})
    return results


def exit_code(results: list[dict]) -> int:
    statuses = {result['status'] for result in results}
    if 'changed' in statuses:
        return 1
    if statuses & {'unknown', 'pending'}:
        return 2
    return 0


def reverse_lookup(registry: dict, article: str | None = None, question: int | None = None) -> list[dict]:
    found = []
    for kind, entries in (('rule', registry['rules']), ('pending', registry['pending'])):
        for entry in entries:
            affects = entry['affects']
            if (article and article in affects['articles']) or (question and question in affects['questions']):
                found.append({'id': entry['id'], 'kind': kind, 'topic': entry['topic']})
    return found


def format_report(results: list[dict]) -> str:
    order = ('changed', 'unknown', 'pending', 'unchanged')
    counts = {status: sum(r['status'] == status for r in results) for status in order}
    lines = ['NHI registry check: ' + ', '.join(f'{counts[s]} {s}' for s in order)]
    for status in order:
        for result in (r for r in results if r['status'] == status):
            lines.append(f'\n[{status.upper()}] {result["id"]} — {result["topic"]}')
            if result.get('url'):
                lines.append(f'  source: {result["url"]}')
            if result.get('reason'):
                lines.append(f'  reason: {result["reason"]}')
            affects = result['affects']
            lines.append('  articles: ' + (', '.join(affects['articles']) or '—'))
            lines.append('  questions: ' + (', '.join(map(str, affects['questions'])) or '—'))
            if result.get('diff'):
                lines.append('  diff:')
                lines.extend('    ' + line for line in result['diff'].splitlines())
    return '\n'.join(lines)


def record(registry_path: Path, rule_id: str, fetcher=fetch, snapshots: Path = SNAPSHOTS) -> str:
    registry = load_registry(registry_path)
    rule = next((r for r in registry['rules'] if r['id'] == rule_id), None)
    if rule is None:
        raise RegistryError(f'no registered rule {rule_id!r} (pending entries cannot be recorded)')
    section = extract_section(source_text(fetcher(rule['source']['url']), rule['source']['format']), rule['section'])
    rule['fingerprint'] = fingerprint(section)
    snapshots.mkdir(parents=True, exist_ok=True)
    (snapshots / f'{rule_id}.txt').write_text(section, encoding='utf-8')
    registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return rule['fingerprint']


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--registry', type=Path, default=REGISTRY)
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--affects')
    parser.add_argument('--question', type=int)
    parser.add_argument('--record')
    args = parser.parse_args(argv)
    try:
        if args.record:
            print(record(args.registry, args.record))
            return 0
        registry = load_registry(args.registry)
    except (RegistryError, FetchError, LookupError) as exc:
        print(f'nhi_check: {exc}', file=sys.stderr)
        return 3
    if args.affects or args.question:
        print(json.dumps(reverse_lookup(registry, args.affects, args.question), ensure_ascii=False, indent=2))
        return 0
    results = check_registry(registry)
    print(json.dumps(results, ensure_ascii=False, indent=2) if args.json else format_report(results))
    return exit_code(results)


if __name__ == '__main__':
    sys.exit(main())
