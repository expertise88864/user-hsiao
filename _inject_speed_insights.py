"""
Inject Vercel Speed Insights into public pages for real-user (field) Core
Web Vitals — LCP / INP / CLS / TTFB from actual Taiwan visitors.

We use the same-origin, deferred form:

    <script defer src="/_vercel/speed-insights/script.js"></script>

This is served by Vercel's edge at the site's own origin, so it needs NO
CSP change (script-src 'self' already covers it; the beacon to
/_vercel/speed-insights/vitals is connect-src 'self'). No inline bootstrap,
so no CSP hash churn and no Trusted-Types interaction.

Targets public pages only (those that already load GA4), is idempotent, and
operates on ZH source pages; _gen_en_pages.py mirrors the tag into /en/.

NOTE: Speed Insights must also be enabled in the Vercel project dashboard
for data to flow; until then the script 404s harmlessly (no user impact).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).parent
GA_MARKER = 'G-0ZKDQP9DNH'          # only inject on real public (analytics) pages
TAG = '<script defer src="/_vercel/speed-insights/script.js"></script>'
MARKER = '/_vercel/speed-insights/script.js'


def candidates() -> list[Path]:
    files = [p for p in ROOT.glob('*.html') if not p.name.startswith('_')]
    files += list((ROOT / 'blog').glob('*.html'))
    return sorted(files)


def inject(text: str) -> tuple[str, bool]:
    if MARKER in text:
        return text, False
    if GA_MARKER not in text:
        return text, False
    idx = text.rfind('</head>')
    if idx == -1:
        return text, False
    new = text[:idx] + TAG + '\n' + text[idx:]
    return new, True


def main() -> int:
    n = 0
    for p in candidates():
        c = p.read_text(encoding='utf-8')
        new_c, changed = inject(c)
        if changed:
            p.write_text(new_c, encoding='utf-8')
            n += 1
            print(f'injected speed-insights: {p.relative_to(ROOT).as_posix()}')
    print(f'Speed Insights injected into {n} file(s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
