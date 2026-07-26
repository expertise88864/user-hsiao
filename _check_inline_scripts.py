#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Syntax-check every INLINE <script> block in every HTML file.

Why this exists (and why it was rewritten in the 2026-07 round-2 review):
    `_check_js_syntax.py` runs `node --check` over *.js / *.mjs files only.
    Inline scripts embedded in HTML were checked by NOTHING. The previous
    version of this file counted braces/parens in index.html only, printed
    "** UNBALANCED **" when they did not match — and then exited 0 regardless,
    so it could never fail CI (`_check_all.py` keys off the return code).
    A checker that cannot fail is worse than no checker: it looks like
    coverage. It also only saw index.html (11 blocks) out of ~160 blocks
    across ~66 HTML files, and its brace counter had no notion of regex
    literals, so it would have mis-counted `/[{]/` anyway.

Now: extract each inline block and compile it with node's real parser
(`new vm.Script`, compile-only — the code is never executed). One node
process handles every block, so this stays fast.

Type handling uses an ALLOWLIST of JavaScript MIME types (plus absent/empty
type = classic script, and type="module"); everything else is a data block
and is skipped. `type="module"` blocks are checked with real module
semantics (temp .mjs + `node --check`) so a future top-level
import/export/await is not misreported as a syntax error.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE = 'node.exe' if os.name == 'nt' else 'node'
SKIP_DIRS = {'.git', '.lighthouseci', 'node_modules', '__pycache__',
             'playwright-report', 'test-results', '.vercel'}

# Attributes are read with a REAL HTML parser, not a regex (round-2 review):
# a regex over the raw tag mistakes `data-note=' type="text/plain"'` for a
# type attribute, misses entity-encoded values like `type="text&#x2f;javascript"`,
# and can match `src=` inside another attribute's value. html.parser handles
# quoting and decodes character references for us.

# ALLOWLIST, not a denylist (round-2 review): anything that is not a JavaScript
# MIME type is a DATA block per the HTML spec (ld+json, speculationrules,
# importmap, text/plain, x-tmpl-mustache, …). A denylist would compile any
# unlisted custom data type as JS and false-positive.
JS_MIME_TYPES = {
    'application/ecmascript', 'application/javascript',
    'application/x-ecmascript', 'application/x-javascript',
    'text/ecmascript', 'text/javascript', 'text/jscript',
    'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
    'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
    'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5',
}


def classify(attr_map: dict) -> str | None:
    """'classic' | 'module' | None (= data block, skip). Takes PARSED attrs."""
    if 'type' not in attr_map:
        return 'classic'                       # absent type ⇒ classic script
    raw = (attr_map.get('type') or '').strip()
    if raw == '':
        return 'classic'                       # empty type ⇒ classic script
    value = raw.lower()
    if value == 'module':
        return 'module'
    # Strip MIME parameters, e.g. `text/javascript; charset=utf-8`.
    if value.split(';', 1)[0].strip() in JS_MIME_TYPES:
        return 'classic'
    return None


class _ScriptCollector(HTMLParser):
    """Collects inline <script> bodies with correctly-parsed attributes."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[dict] = []
        self._pending: dict | None = None
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'script':
            return
        # HTML keeps the FIRST occurrence of a duplicated attribute; a dict
        # comprehension would keep the LAST, so
        # `<script type="text/javascript" type="text/plain">` (executable in a
        # browser) would be misread as a data block and skipped.
        amap: dict[str, str] = {}
        for k, v in attrs:
            k = k.lower()
            if k not in amap:
                amap[k] = v if v is not None else ''
        self._pending = None
        self._buf = []
        if 'src' in amap:
            return                              # external script
        kind = classify(amap)
        if kind is None:
            return                              # data block
        self._pending = {'kind': kind, 'line': self.getpos()[0]}

    def handle_data(self, data):
        if self._pending is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != 'script':
            return
        if self._pending is not None:
            code = ''.join(self._buf)
            if code.strip():
                self._pending['code'] = code
                self.found.append(self._pending)
        self._pending = None
        self._buf = []

NODE_HARNESS = r'''
const vm = require('vm');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let items;
  try { items = JSON.parse(raw); }
  catch (e) { process.stdout.write(JSON.stringify([{name: '<harness>', msg: 'bad manifest: ' + e.message}])); return; }
  const out = [];
  for (const it of items) {
    try {
      // Compile only — never runs the code.
      new vm.Script(it.code, { filename: it.name });
    } catch (e) {
      out.push({ name: it.name, msg: String((e && e.message) || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
'''


def iter_html_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob('*.html'):
        if not path.is_file():
            continue
        if set(path.relative_to(ROOT).parts) & SKIP_DIRS:
            continue
        files.append(path)
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())


def collect_blocks() -> list[dict]:
    blocks: list[dict] = []
    for path in iter_html_files():
        rel = path.relative_to(ROOT).as_posix()
        try:
            src = path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError) as exc:
            blocks.append({'name': f'{rel}:?', 'code': '', 'read_error': str(exc)})
            continue
        parser = _ScriptCollector()
        try:
            parser.feed(src)
            parser.close()
        except Exception as exc:               # malformed HTML — surface it
            blocks.append({'name': rel, 'code': '', 'read_error': f'HTML parse failed: {exc}'})
            continue
        for idx, b in enumerate(parser.found, start=1):
            blocks.append({
                'name': f'{rel}#block{idx}@L{b["line"]}',
                'code': b['code'],
                'kind': b['kind'],
            })
    return blocks


def check_modules(mod_blocks: list[dict]) -> list[str]:
    """`type="module"` blocks need MODULE parsing.

    vm.Script compiles classic-script semantics, so it rejects top-level
    import/export/await — legal in a module. No inline block uses them today,
    but parsing modules as classic scripts would turn a valid future edit into
    a false positive. Modules are rare (1 today), so a temp .mjs +
    `node --check` per block is cheap and exactly correct.
    """
    errors: list[str] = []
    for b in mod_blocks:
        # Uniquely-created temp file: a deterministic name lets concurrent
        # runs clobber each other and check the wrong content.
        fd, tmp_name = tempfile.mkstemp(suffix='.mjs', prefix='hs_inline_mod_')
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as fh:
                fh.write(b['code'])
            proc = subprocess.run([NODE, '--check', str(tmp)],
                                  capture_output=True, text=True, cwd=ROOT)
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout).strip().split('\n')
                errors.append(f'{b["name"]} (module): ' + ' | '.join(detail[:2]))
        except OSError as exc:
            errors.append(f'{b["name"]} (module): could not check ({exc})')
        finally:
            try:
                tmp.unlink()
            except OSError as exc:
                # Surface it — silently leaking temp files is how cleanup rots.
                errors.append(f'{b["name"]} (module): temp cleanup failed ({exc})')
    return errors


def main() -> int:
    blocks = collect_blocks()
    read_errors = [b for b in blocks if b.get('read_error')]
    blocks = [b for b in blocks if not b.get('read_error')]

    errors = [f"{b['name']}: unreadable ({b['read_error']})" for b in read_errors]

    module_blocks = [b for b in blocks if b.get('kind') == 'module']
    classic_blocks = [b for b in blocks if b.get('kind') != 'module']
    if module_blocks:
        errors.extend(check_modules(module_blocks))

    if classic_blocks:
        manifest = json.dumps([{'name': b['name'], 'code': b['code']} for b in classic_blocks])
        try:
            proc = subprocess.run(
                [NODE, '-e', NODE_HARNESS],
                input=manifest, text=True, capture_output=True,
                cwd=ROOT, encoding='utf-8',
            )
        except FileNotFoundError:
            # Fail closed: silently skipping is how the previous version
            # became a no-op gate.
            print('[FAIL] inline <script> syntax audit: node not found on PATH '
                  '(required — this gate must not silently pass)')
            return 1
        if proc.returncode != 0:
            print('[FAIL] inline <script> syntax audit: node harness failed')
            print((proc.stderr or proc.stdout).strip()[:500])
            return 1
        try:
            found = json.loads(proc.stdout or '[]')
        except json.JSONDecodeError:
            print('[FAIL] inline <script> syntax audit: unparseable harness output')
            print((proc.stdout or '')[:500])
            return 1
        errors.extend(f"{item['name']}: {item['msg']}" for item in found)

    if errors:
        print(f'[FAIL] inline <script> syntax audit — {len(errors)} block(s) with issues:')
        for e in errors[:30]:
            print(' - ' + e)
        if len(errors) > 30:
            print(f'   ... and {len(errors) - 30} more')
        return 1

    n_files = len({b['name'].split('#', 1)[0] for b in blocks})
    print(f'[OK] inline <script> syntax audit passed '
          f'({len(blocks)} block(s) across {n_files} HTML file(s))')
    return 0


if __name__ == '__main__':
    sys.exit(main())
