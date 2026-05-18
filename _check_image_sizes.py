"""
HsiaoEye — flag raster images whose file size is wildly out of proportion
to the display dimensions declared on the <img> tag.

Why: about.html shipped <img src="/SUNN1302.jpg" width="220" height="220">
where SUNN1302.jpg was a 5.8 MB original portrait. Even though the
<picture> wrapper carried smaller AVIF/WebP sources, screen readers and
HTTP-only crawlers (plus the fallback path on browsers that fail picture
negotiation) would pull the 5.8 MB original. About.html's LCP was
crushed by this one image until it was switched to /SUNN1302-220.*.

What this catches:
  - <img src="/foo.jpg" width="220" height="220">  where /foo.jpg on disk
    is significantly larger than the declared display dimensions warrant.
  - Heuristic: max acceptable file bytes ≈ width × height × 0.5 (gives
    ~50 KB at 320×320, ~250 KB at 800×800 — generous for raster). Pure
    SVG and inline data: URIs are skipped (vector / no fetch).

The check looks at the `<img src=…>` reference IGNORING the parent
<picture> wrappers, because that's the resource that ACTUALLY gets
fetched if AVIF/WebP source negotiation fails (older browsers, some
crawler bots, Cloudflare WAF rules with strict accepts).
"""
from __future__ import annotations

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {'.git', 'node_modules', '.vercel', '__pycache__'}
RASTER_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'}

# Max bytes per displayed pixel (heuristic).
#   320×320 → 51 KB,  800×800 → 320 KB,  1200×630 → 378 KB
MAX_BYTES_PER_PIXEL = 0.5
# Minimum free byte budget — JPEG/WebP/AVIF have ~10 KB fixed overhead
# before compression payoff, so anything smaller than this is fine
# regardless of display dimensions (avoids flagging 54×54 avatars).
MIN_BYTE_FLOOR = 20_480


def main():
    issues = []
    for fp in sorted(glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)):
        if any(s in fp.split(os.sep) for s in SKIP_DIRS):
            continue
        try:
            with open(fp, encoding='utf-8') as f:
                text = f.read()
        except UnicodeDecodeError:
            continue
        rel = os.path.relpath(fp, ROOT).replace('\\', '/')

        for m in re.finditer(r'<img\b([^>]+)>', text, re.IGNORECASE):
            attrs = m.group(1)
            src = re.search(r'\bsrc=[\"\']([^\"\']+)[\"\']', attrs)
            w = re.search(r'\bwidth=[\"\']?(\d+)', attrs)
            h = re.search(r'\bheight=[\"\']?(\d+)', attrs)
            if not (src and w and h):
                continue
            src_v = src.group(1)
            if src_v.startswith('data:') or src_v.startswith('http'):
                continue
            ext = os.path.splitext(src_v.split('?')[0])[1].lower()
            if ext not in RASTER_EXTS:
                continue
            # Resolve to disk path (strip leading slash).
            disk = os.path.join(ROOT, src_v.lstrip('/').replace('/', os.sep))
            if not os.path.isfile(disk):
                continue
            bytes_ = os.path.getsize(disk)
            display_px = int(w.group(1)) * int(h.group(1))
            if display_px == 0:
                continue
            max_bytes = max(MIN_BYTE_FLOOR, int(display_px * MAX_BYTES_PER_PIXEL))
            if bytes_ <= max_bytes:
                continue
            issues.append((rel, src_v, bytes_, display_px, max_bytes))

    if not issues:
        print('[OK] Image-size audit passed — no <img> source is wildly larger '
              'than its declared display dimensions warrant')
        return 0

    print(f'[WARN] Image-size audit: {len(issues)} oversized <img src> found '
          f'(heuristic: max {MAX_BYTES_PER_PIXEL} bytes per displayed pixel):')
    for rel, src, bytes_, px, mb in issues:
        ratio = bytes_ / mb
        print(f'  {rel}:  src={src}')
        print(f'    {bytes_:,} bytes, displayed {px:,} px → {ratio:.1f}× over budget')
    print()
    print('Fix: point src at a properly-sized variant (e.g. -220 / -440 / -660)')
    print('     or run python _convert_images.py to generate WebP/AVIF.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
