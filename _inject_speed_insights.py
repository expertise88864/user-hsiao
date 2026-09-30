"""
Normalize public analytics to one eligibility-gated bootstrap.

The legacy filename remains a compatible build-chain entry. Operates on ZH
sources only; _gen_en_pages.py mirrors the tag. GA4, Vercel Web Analytics and
Speed Insights share production/reader/privacy/automation exclusions.
"""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).parent
GA_MARKER = 'G-0ZKDQP9DNH'          # only inject on real public (analytics) pages
MARKER = '/assets/telemetry.js'
SPEED_MARKER = '/_vercel/speed-insights/script.js'
SCRIPT_RE = re.compile(r'<script\b[^>]*>[\s\S]*?</script\s*>', re.I)


def candidates() -> list[Path]:
    files = [p for p in ROOT.glob('*.html') if not p.name.startswith('_')]
    files += list((ROOT / 'blog').glob('*.html'))
    files += list((ROOT / 'tools').glob('*.html'))
    return sorted(files)


def inject(text: str) -> tuple[str, bool]:
    if not any(marker in text for marker in (GA_MARKER, MARKER, SPEED_MARKER, 'blog/blog-shared.min.js')):
        return text, False
    if not re.search(r'</head\s*>', text, re.I):
        return text, False
    version = re.search(r'[?&]v=(\d{8})', text)
    suffix = '?v=' + version[1] if version else ''
    tag = '<script defer src="' + MARKER + suffix + '"></script>'
    seen = False

    def remove_legacy(match: re.Match) -> str:
        nonlocal seen
        script = match[0]
        if MARKER in script:
            if seen:
                return ''
            seen = True
            return tag
        if any(marker in script for marker in (SPEED_MARKER, 'googletagmanager.com/gtag/js')):
            return ''
        if GA_MARKER in script and ('gtag(' in script or 'dataLayer' in script):
            return ''
        return script

    updated = SCRIPT_RE.sub(remove_legacy, text)
    # Keep an existing tag in place: later generators append FAQ/schema scripts
    # after it, so repeatedly moving it would accumulate blank lines.
    if seen:
        return updated, updated != text
    # Keep article content untouched; normalize the trailing blank lines left
    # by replacing our own tag so a second generation is byte-identical.
    updated = re.sub(r'\n*</head\s*>', lambda m: '\n' + tag + '\n' + m[0].lstrip('\n'), updated, count=1, flags=re.I)
    return updated, updated != text


def main() -> int:
    n = 0
    for p in candidates():
        c = p.read_text(encoding='utf-8')
        new_c, changed = inject(c)
        if changed:
            p.write_text(new_c, encoding='utf-8')
            n += 1
            print(f'normalized telemetry: {p.relative_to(ROOT).as_posix()}')
    print(f'Telemetry normalized in {n} file(s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
