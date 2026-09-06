#!/usr/bin/env python
"""Shared local/hosted asset budget; thresholds moved unchanged from CI."""
import gzip
from pathlib import Path

BUDGETS = {
    # path -> (raw_kb, gzip_kb), enforced as a hard failure
    # blog-shared.min.js is what ships to browsers (esbuild-minified);
    # the readable blog-shared.js source is parsed by tooling only and
    # is not budgeted as a delivered asset.
    'blog/blog-shared.min.js': (190, 53),
    'assets/app.css':      (45, 14),
    'assets/article.css':  (18,  6),
    'sw.js':               (52, 21),
    'middleware.js':       (45,  7),
}
SKIP_PARTS = {'.git', '__pycache__', 'node_modules', 'tests', 'test-results'}
warnings = []
report = []
all_assets = []

for path in Path('.').rglob('*'):
    if not path.is_file():
        continue
    if SKIP_PARTS & set(path.parts):
        continue
    if path.suffix not in {'.js', '.css', '.html'}:
        continue
    rel = path.as_posix()
    data = path.read_bytes()
    raw_kb = len(data) / 1024
    gz_kb = len(gzip.compress(data, compresslevel=9)) / 1024
    all_assets.append((rel, raw_kb, gz_kb))

all_assets.sort(key=lambda x: -x[2])
report.append(f"{'PATH':<60} {'RAW kB':>8} {'GZIP kB':>8}")
report.append('-' * 80)
for p, r, g in all_assets[:25]:
    report.append(f"{p:<60} {r:>8.1f} {g:>8.1f}")

for path, (max_raw, max_gz) in BUDGETS.items():
    for p, r, g in all_assets:
        if p == path:
            if r > max_raw:
                warnings.append(f"  WARN {p}: {r:.1f} kB raw exceeds budget {max_raw} kB")
            if g > max_gz:
                warnings.append(f"  WARN {p}: {g:.1f} kB gzip exceeds budget {max_gz} kB")

print('\n'.join(report))
if warnings:
    print('\n=== BUDGET VIOLATIONS ===')
    for w in warnings:
        print(w)
    raise SystemExit(1)
else:
    print('\nAll asset budgets within limits')
