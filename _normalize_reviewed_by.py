"""
Upgrade MedicalWebPage `reviewedBy` from a bare @id reference to a full
Person/Physician object with inline credentials, and couple `lastReviewed`
to the article's modified date.

Why: Google's YMYL / E-E-A-T evaluation rewards a clear "reviewed by a
credentialed clinician" signal ON the article page itself. A bare
{"@id": ".../about#person"} requires Google to resolve the entity by
fetching /about, which it often does not do cross-page. Inlining the
physician's name + credentials + specialty makes the signal self-contained
on every article, while keeping the @id so the entity still reconciles with
the canonical Person node on /about.

Safe with _check_medical_webpage_schema.py: that validator only checks
reviewedBy's @id == PERSON_ID (ref_id()), which we preserve.

Idempotent: re-running makes no changes once upgraded. Operates on ZH
article pages only; _gen_en_pages.py mirrors the result into /en/.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = 'https://hsiao.chendermatologist.com'
PERSON_ID = f'{DOMAIN}/about#person'

# Bare reference form currently baked into every article.
OLD_REVIEWED_BY = '"reviewedBy":{"@id":"' + PERSON_ID + '"}'

# Full Person/Physician object — mirrors the canonical node on /about#person.
NEW_REVIEWED_BY = (
    '"reviewedBy":{"@type":["Person","Physician"],'
    '"@id":"' + PERSON_ID + '",'
    '"name":"蕭閔謙 醫師",'
    '"alternateName":"Min-Chien Hsiao, MD",'
    '"honorificSuffix":"M.D.",'
    '"jobTitle":"Resident Physician, Ophthalmology",'
    '"medicalSpecialty":"https://schema.org/Ophthalmologic",'
    '"url":"' + DOMAIN + '/about"}'
)


def modified_date(text: str) -> str | None:
    """Article's modified date (YYYY-MM-DD) from the OG article:modified_time."""
    m = re.search(
        r'<meta\s+property="article:modified_time"\s+content="(\d{4}-\d{2}-\d{2})',
        text,
    )
    return m.group(1) if m else None


def normalize(text: str) -> tuple[str, bool]:
    changed = False

    # 1) Upgrade reviewedBy (only the bare-@id form; skip already-upgraded).
    if OLD_REVIEWED_BY in text:
        text = text.replace(OLD_REVIEWED_BY, NEW_REVIEWED_BY)
        changed = True

    # 2) Couple lastReviewed to the article's modified date (freshness signal).
    #    lastReviewed appears only inside the MedicalWebPage block.
    md = modified_date(text)
    if md:
        new_text, n = re.subn(
            r'"lastReviewed"\s*:\s*"\d{4}-\d{2}-\d{2}"',
            f'"lastReviewed":"{md}"',
            text,
            count=1,
        )
        if n and new_text != text:
            text = new_text
            changed = True

    return text, changed


def main() -> int:
    n = 0
    for p in sorted((ROOT / 'blog').glob('*.html')):
        if p.name == 'index.html':
            continue
        c = p.read_text(encoding='utf-8')
        if 'MedicalWebPage' not in c:
            continue
        new_c, changed = normalize(c)
        if changed:
            p.write_text(new_c, encoding='utf-8')
            n += 1
            print(f'normalized: {p.name}')
    print(f'reviewedBy/lastReviewed normalized in {n} file(s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
