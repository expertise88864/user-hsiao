"""
One-off: add geo-targeting `<meta>` tags to every indexable HTML page.

Why: HsiaoEye's content is Taiwan-focused (健保給付規定, Taiwan-specific
NHI codes, Taiwan epidemiology). Google + Bing use `geo.region` /
`geo.country` to bias regional ranking — Taiwanese users searching
"乾眼症 治療" should see HsiaoEye prioritised vs HK / mainland sources
with similar content quality. Without these signals, search engines
treat the site as locale-neutral and lose the home-court advantage.

Adds 3 meta tags right after `<meta name="robots">`:
  <meta name="geo.region" content="TW" />
  <meta name="geo.country" content="TW" />
  <meta name="geo.placename" content="Taiwan" />

Safe to re-run: skips files that already have geo.region.
"""
import glob
import os

GEO_META = (
    '<meta name="geo.region" content="TW" />\n'
    '<meta name="geo.country" content="TW" />\n'
    '<meta name="geo.placename" content="Taiwan" />'
)
SKIP_BASENAMES = {'404.html', 'offline.html', 'admin.html'}


def main():
    n = 0
    for fp in sorted(glob.glob('**/*.html', recursive=True)):
        norm = fp.replace(os.sep, '/')
        if os.path.basename(fp) in SKIP_BASENAMES:
            continue
        if norm.startswith('admin/'):
            continue
        with open(fp, encoding='utf-8') as f:
            c = f.read()
        if 'name="geo.region"' in c:
            continue
        # Insert right after the robots meta (added in batch Z); fall back to
        # right after charset if robots not present yet.
        anchor = None
        for cand in (
            '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />',
            '<meta charset="UTF-8" />',
            '<meta charset="UTF-8">',
        ):
            if cand in c:
                anchor = cand
                break
        if not anchor:
            continue
        new_c = c.replace(anchor, anchor + '\n' + GEO_META, 1)
        if new_c == c:
            continue
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(new_c)
        n += 1
        print(f'  + {norm}')
    print(f'\nadded geo meta to {n} file(s)')


if __name__ == '__main__':
    main()
