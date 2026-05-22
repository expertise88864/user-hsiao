"""
HsiaoEye: verify RSS/Atom feeds expose rich article metadata for discovery.
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parent
DOMAIN = "https://hsiao.chendermatologist.com"
RSS = ROOT / "blog" / "feed.xml"
ATOM = ROOT / "blog" / "atom.xml"
SHARED = ROOT / "blog" / "blog-shared.js"
RSS_LINK = '<link rel="alternate" type="application/rss+xml" title="HsiaoEye RSS" href="/blog/feed.xml" />'
ATOM_LINK = '<link rel="alternate" type="application/atom+xml" title="HsiaoEye Atom" href="/blog/atom.xml" />'


def parse_catalog() -> tuple[list[str], set[str]]:
    js = SHARED.read_text(encoding="utf-8")
    articles = re.search(r"DN\.ARTICLES\s*=\s*\[(.*?)\];", js, re.DOTALL)
    if not articles:
        raise SystemExit("[FAIL] DN.ARTICLES not found")
    stubs_match = re.search(r"DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]", js)
    stubs = set(re.findall(r"'([^']+)'", stubs_match.group(1))) if stubs_match else set()
    slugs = re.findall(r"slug:\s*'([^']+)'", articles.group(1))
    return [slug for slug in slugs if slug not in stubs], stubs


def public_html_files(published: list[str]) -> list[Path]:
    static = [
        "index.html",
        "about.html",
        "notes.html",
        "privacy.html",
        "tools.html",
        "blog/index.html",
        "blog/topics.html",
        "en/index.html",
        "en/about.html",
        "en/notes.html",
        "en/privacy.html",
        "en/tools.html",
        "en/blog/index.html",
        "en/blog/topics.html",
    ]
    paths = [ROOT / rel for rel in static]
    for slug in published:
        paths.append(ROOT / "blog" / f"{slug}.html")
        paths.append(ROOT / "en" / "blog" / f"{slug}.html")
    return [path for path in paths if path.exists()]


def text(node: ET.Element | None) -> str:
    return (node.text or "").strip() if node is not None else ""


def has_mojibake(value: str) -> bool:
    return "\ufffd" in value or "????" in value


def slug_from_article_url(url: str) -> str:
    match = re.search(r"/blog/([^/#?]+)$", url)
    return match.group(1) if match else ""


def head_markup(src: str) -> str:
    match = re.search(r"<head[^>]*>(.*?)</head>", src, re.I | re.S)
    return match.group(1) if match else ""


def main() -> int:
    published, stubs = parse_catalog()
    expected_count = min(30, len(published))
    errors: list[str] = []

    if not RSS.exists():
        errors.append("blog/feed.xml missing")
    if not ATOM.exists():
        errors.append("blog/atom.xml missing")
    if errors:
        print("[FAIL] feed audit failed:")
        for err in errors:
            print("  - " + err)
        return 1

    rss_src = RSS.read_text(encoding="utf-8")
    atom_src = ATOM.read_text(encoding="utf-8")
    for label, src in {"RSS": rss_src, "Atom": atom_src}.items():
        if has_mojibake(src):
            errors.append(f"{label}: mojibake marker found")
        for stub in stubs:
            if f"/blog/{stub}" in src:
                errors.append(f"{label}: stub article leaked into feed: {stub}")

    for path in public_html_files(published):
        src = path.read_text(encoding="utf-8")
        head = head_markup(src)
        rel = path.relative_to(ROOT).as_posix()
        if not head:
            errors.append(f"{rel}: missing head section")
            continue
        if RSS_LINK not in head:
            errors.append(f"{rel}: missing RSS autodiscovery link")
        if ATOM_LINK not in head:
            errors.append(f"{rel}: missing Atom autodiscovery link")
        if head.count('type="application/rss+xml"') != 1:
            errors.append(f"{rel}: expected exactly one RSS autodiscovery link")
        if head.count('type="application/atom+xml"') != 1:
            errors.append(f"{rel}: expected exactly one Atom autodiscovery link")

    try:
        rss_root = ET.fromstring(rss_src)
    except ET.ParseError as exc:
        errors.append(f"RSS parse error: {exc}")
        rss_root = None

    if rss_root is not None:
        ns = {
            "content": "http://purl.org/rss/1.0/modules/content/",
            "media": "http://search.yahoo.com/mrss/",
        }
        if "http://search.yahoo.com/mrss/" not in rss_src:
            errors.append("RSS: missing Media RSS namespace")
        channel = rss_root.find("channel")
        if channel is None:
            errors.append("RSS: missing channel")
        else:
            title = text(channel.find("title"))
            description = text(channel.find("description"))
            if not title.startswith("HsiaoEye"):
                errors.append(f"RSS: unexpected channel title {title!r}")
            if len(description) < 30:
                errors.append("RSS: channel description is too short")

            items = channel.findall("item")
            if len(items) != expected_count:
                errors.append(f"RSS: expected {expected_count} items, found {len(items)}")

            for item in items:
                link = text(item.find("link"))
                slug = slug_from_article_url(link)
                title = text(item.find("title"))
                description = text(item.find("description"))
                enclosure = item.find("enclosure")
                media_content = item.find("media:content", ns)
                media_thumbnail = item.find("media:thumbnail", ns)
                content_html = text(item.find("content:encoded", ns))

                if slug not in published:
                    errors.append(f"RSS: unknown article URL {link!r}")
                if len(title) < 8:
                    errors.append(f"RSS: title missing/too short for {slug or link}")
                if len(description) < 60:
                    errors.append(f"RSS: description missing/too short for {slug or link}")
                if "\u6574\u7406\u7684\u885b\u6559\u6587\u7ae0" in description:
                    errors.append(f"RSS: generic fallback description used for {slug or link}")
                if enclosure is None:
                    errors.append(f"RSS: missing image enclosure for {slug or link}")
                else:
                    expected = f"{DOMAIN}/assets/og/{slug}.png"
                    if enclosure.get("url") != expected:
                        errors.append(f"RSS: enclosure URL mismatch for {slug}: {enclosure.get('url')!r}")
                    if enclosure.get("type") != "image/png":
                        errors.append(f"RSS: enclosure type mismatch for {slug}")
                    if media_content is None or media_content.get("url") != expected:
                        errors.append(f"RSS: media:content URL mismatch for {slug}")
                    elif media_content.get("type") != "image/png" or media_content.get("medium") != "image":
                        errors.append(f"RSS: media:content attributes mismatch for {slug}")
                    if media_thumbnail is None or media_thumbnail.get("url") != expected:
                        errors.append(f"RSS: media:thumbnail URL mismatch for {slug}")
                    if expected not in content_html:
                        errors.append(f"RSS: content:encoded missing OG image for {slug}")

    try:
        atom_root = ET.fromstring(atom_src)
    except ET.ParseError as exc:
        errors.append(f"Atom parse error: {exc}")
        atom_root = None

    if atom_root is not None:
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "media": "http://search.yahoo.com/mrss/",
        }
        if "http://search.yahoo.com/mrss/" not in atom_src:
            errors.append("Atom: missing Media RSS namespace")
        entries = atom_root.findall("atom:entry", ns)
        if len(entries) != expected_count:
            errors.append(f"Atom: expected {expected_count} entries, found {len(entries)}")

        for entry in entries:
            link_node = entry.find("atom:link[@rel='alternate']", ns)
            url = link_node.get("href", "") if link_node is not None else ""
            slug = slug_from_article_url(url)
            title = text(entry.find("atom:title", ns))
            summary = text(entry.find("atom:summary", ns))
            updated = text(entry.find("atom:updated", ns))
            published_at = text(entry.find("atom:published", ns))
            en_link = entry.find("atom:link[@hreflang='en']", ns)
            enclosure = entry.find("atom:link[@rel='enclosure']", ns)
            media_thumbnail = entry.find("media:thumbnail", ns)
            content = entry.find("atom:content", ns)
            content_html = text(content)

            if slug not in published:
                errors.append(f"Atom: unknown article URL {url!r}")
            if len(title) < 8:
                errors.append(f"Atom: title missing/too short for {slug or url}")
            if len(summary) < 60:
                errors.append(f"Atom: summary missing/too short for {slug or url}")
            if "\u6574\u7406\u7684\u885b\u6559\u6587\u7ae0" in summary:
                errors.append(f"Atom: generic fallback summary used for {slug or url}")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", updated):
                errors.append(f"Atom: invalid updated timestamp for {slug or url}: {updated!r}")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", published_at):
                errors.append(f"Atom: invalid published timestamp for {slug or url}: {published_at!r}")
            if en_link is None or en_link.get("href") != f"{DOMAIN}/en/blog/{slug}":
                errors.append(f"Atom: missing English alternate link for {slug or url}")
            expected = f"{DOMAIN}/assets/og/{slug}.png"
            if enclosure is None or enclosure.get("href") != expected:
                errors.append(f"Atom: missing image enclosure for {slug or url}")
            elif enclosure.get("type") != "image/png":
                errors.append(f"Atom: enclosure type mismatch for {slug}")
            if media_thumbnail is None or media_thumbnail.get("url") != expected:
                errors.append(f"Atom: media:thumbnail URL mismatch for {slug or url}")
            if content is None or content.get("type") != "html":
                errors.append(f"Atom: missing HTML content block for {slug or url}")
            elif expected not in content_html:
                errors.append(f"Atom: content block missing OG image for {slug}")

    if errors:
        print("[FAIL] feed audit failed:")
        for err in errors[:120]:
            print("  - " + err)
        if len(errors) > 120:
            print(f"  ... {len(errors) - 120} more")
        return 1

    print(
        f"[OK] feed audit passed: {expected_count} RSS/Atom entries and "
        f"{len(public_html_files(published))} public autodiscovery pages"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
