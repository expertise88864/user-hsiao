"""
One-off: inject `<meta name="robots" content="…">` into every indexable
HTML file. Required for Google Discover eligibility and bigger SERP
thumbnails on mobile. Safe to re-run: skips files that already have
a robots meta.
"""
import glob
import os

ROBOTS_META = '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />'

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
        if 'name="robots"' in c:
            continue   # already has one — leave it
        # Insert right after <meta charset...>
        new = None
        for needle in ('<meta charset="UTF-8" />', '<meta charset="UTF-8">'):
            if needle in c:
                new = c.replace(needle, needle + '\n' + ROBOTS_META, 1)
                break
        if new is None:
            continue
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(new)
        n += 1
        print(f'  + {norm}')
    print(f'\nadded robots meta to {n} file(s)')


if __name__ == '__main__':
    main()
