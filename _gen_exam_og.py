#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Render the /exam/** share cards (assets/og/exam/<name>.png, 1200x630).

Ported from the dermatology exam section (2026-11-04). _gen_exam.py decides which card
every exam page uses and writes the card text to data/exam/og_cards.json: one card per
chapter page (「BCSC 12 Ch.5」, the Chinese name or else the English title, the English
title under a Chinese one, 「考題 23 題 · 重點整理」) and hub.png, shared by the hub and
the tool pages (考點總覽, 考古卷, 錯題本, ...). This script draws those cards on the
article cards' backdrop and fonts (_gen_og_images.py) and records what it rendered in
data/exam/og_rendered.json: the hash of the card text and of the PNG.

USAGE
    python _gen_exam_og.py           # render only missing or out-of-date cards
    python _gen_exam_og.py --force   # re-render every card
    python _gen_exam_og.py --check   # exit 1 unless every card is present and current

Rendering needs Pillow and a CJK font, and is local authoring work like the article cards:
the PNG bytes depend on the Pillow/FreeType build and the fonts, so CI never re-renders.
--check needs no Pillow (CI runs it through _check_exam_og_cards.py): every card named in
og_cards.json exists, is an intact 1200x630 PNG of at most MAX_BYTES, matches the recorded
hash and was rendered from the current text, and no stray card is left behind. So a new
chapter page, or a changed chapter name or question count, fails CI until its card is
rendered here and committed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPECS = ROOT / "data" / "exam" / "og_cards.json"
RECORD = ROOT / "data" / "exam" / "og_rendered.json"
OUT = ROOT / "assets" / "og" / "exam"
FIELDS = ("kicker", "title", "subtitle", "foot")
SIZE = (1200, 630)
PALETTE = 64           # colours after quantizing: keeps each card well under MAX_BYTES
MAX_BYTES = 60_000
SITE = "hsiao.chendermatologist.com/exam"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def text_hash(fields: dict) -> str:
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def file_hash(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def png_size(path: Path) -> tuple[int, int] | None:
    """(width, height) of an intact PNG: signature, IHDR first, every chunk CRC valid and
    IEND last. None for anything else. Standard library only, so --check needs no Pillow."""
    raw = path.read_bytes()
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    pos, size, kinds = 8, None, []
    while pos + 12 <= len(raw):
        length, kind = struct.unpack(">I4s", raw[pos:pos + 8])
        data = raw[pos + 8:pos + 8 + length]
        crc = raw[pos + 8 + length:pos + 12 + length]
        if len(data) != length or len(crc) != 4 or zlib.crc32(kind + data) != struct.unpack(">I", crc)[0]:
            return None
        if kind == b"IHDR":
            size = struct.unpack(">II", data[:8])
        kinds.append(kind)
        pos += 12 + length
    if not kinds or kinds[0] != b"IHDR" or kinds[-1] != b"IEND" or pos != len(raw):
        return None
    return size


def stale_cards(specs: dict, record: dict) -> list[str]:
    """Cards whose PNG is missing, differs from its record, or was drawn from older text."""
    out = []
    for name, fields in sorted(specs.items()):
        rec = record.get(name)
        if (not isinstance(rec, dict) or rec.get("text") != text_hash(fields)
                or rec.get("png") is None or rec.get("png") != file_hash(OUT / f"{name}.png")):
            out.append(name)
    return out


def check(specs: dict, record: dict) -> list[str]:
    errors = []
    if not specs:
        errors.append("data/exam/og_cards.json is missing or empty (run python _gen_exam.py)")
    for name, fields in sorted(specs.items()):
        if not re.fullmatch(r"[a-z0-9-]+", name):
            errors.append(f"{name}: card names are lower-case file stems")
        if not isinstance(fields, dict) or set(fields) != set(FIELDS) or not fields.get("title"):
            errors.append(f"{name}: card text must have exactly {FIELDS} and a title")
    for name in stale_cards(specs, record):
        errors.append(f"assets/og/exam/{name}.png is missing or out of date (run python _gen_exam_og.py)")
    for name in sorted(specs):
        path = OUT / f"{name}.png"
        if not path.is_file():
            continue
        size = png_size(path)
        if size != SIZE:
            errors.append(f"assets/og/exam/{name}.png is {size or 'not an intact PNG'}, not 1200x630")
        if path.stat().st_size > MAX_BYTES:
            errors.append(f"assets/og/exam/{name}.png is {path.stat().st_size} bytes (limit {MAX_BYTES})")
    for extra in sorted(set(record) - set(specs)):
        errors.append(f"og_rendered.json records {extra}, which no exam page uses")
    if OUT.is_dir():
        for path in sorted(OUT.iterdir()):
            if path.suffix != ".png" or path.stem not in specs:
                errors.append(f"assets/og/exam/{path.name} is not a card any exam page uses")
    return errors


# ---------------------------------------------------------------- drawing

def wrap(text: str, font, draw, width: int, lines: int) -> list[str]:
    """Greedy wrap that keeps English words whole and breaks Chinese anywhere; the last
    line ends in an ellipsis when the text does not fit in `lines` lines."""
    tokens = re.findall(r"[A-Za-z0-9'’().,:;/&+\-–]+\s*|\s+|.", text)
    out, cur = [], ""
    for tok in tokens:
        test = cur + tok
        if cur and draw.textlength(test.rstrip(), font=font) > width:
            out.append(cur.rstrip())
            cur = tok.lstrip()
        else:
            cur = test
    if cur.strip():
        out.append(cur.rstrip())
    if len(out) > lines:
        out = out[:lines]
        last = out[-1]
        while last and draw.textlength(last + "…", font=font) > width:
            last = last[:-1]
        out[-1] = last.rstrip() + "…"
    return out


def render(fields: dict):
    """One card on the article cards' backdrop: brand top left, kicker chip top right,
    the title, the English subtitle, a divider and the foot line."""
    from PIL import Image, ImageDraw

    import _gen_og_images as og

    img = Image.new("RGB", SIZE, og.BG_COLOR)
    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((-150, -200, 360, 310), fill=(*og.BLUE_TINT, 120))
    od.ellipse((og.W - 360, og.H - 280, og.W + 200, og.H + 220), fill=(*og.OCHRE, 60))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    d = ImageDraw.Draw(img)

    d.text((68, 56), "HsiaoEye", font=og.load_font(og.FONT_CANDIDATES_CJK, 26), fill=og.BLUE_DEEP)
    d.text((68, 92), "眼科專科考試筆記", font=og.load_font(og.FONT_CANDIDATES_CJK, 16), fill=og.MUTED)

    chip_font = og.load_font(og.FONT_CANDIDATES_CJK, 22)
    tw = d.textlength(fields["kicker"], font=chip_font)
    chip_x = og.W - 68 - tw - 36
    d.rounded_rectangle((chip_x, 60, chip_x + tw + 36, 98), radius=19, fill=og.BLUE_DEEP)
    d.text((chip_x + 18, 64), fields["kicker"], font=chip_font, fill=(255, 255, 255))

    width = og.W - 136
    # A long title (an English fallback, mostly) steps down in size before it is cut.
    for size, leading in ((64, 80), (54, 68), (46, 58)):
        font = og.load_font(og.FONT_CANDIDATES_CJK, size)
        lines = wrap(fields["title"], font, d, width, 3)
        if not lines[-1].endswith("…") and len(lines) <= (2 if fields["subtitle"] else 3):
            break
    y = 190
    for line in lines:
        d.text((68, y), line, font=font, fill=og.INK_COLOR)
        y += leading
    if fields["subtitle"]:
        sub = og.load_font(og.FONT_CANDIDATES_LATIN, 26)
        for line in wrap(fields["subtitle"], sub, d, width, 1 if len(lines) > 1 else 2):
            d.text((68, y + 10), line, font=sub, fill=og.BLUE_DEEP)
            y += 38
    div_y = max(470, y + 34)
    d.line((68, div_y, 320, div_y), fill=og.BLUE_DEEP, width=3)
    meta = "  ·  ".join(p for p in (fields["foot"], SITE) if p)
    d.text((68, div_y + 22), meta, font=og.load_font(og.FONT_CANDIDATES_CJK, 24), fill=og.INK2_COLOR)
    return img.quantize(colors=PALETTE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="validate only; render nothing")
    ap.add_argument("--force", action="store_true", help="re-render every card")
    args = ap.parse_args(argv)
    specs = load_json(SPECS)
    record = load_json(RECORD)
    if args.check:
        errors = check(specs, record)
        for error in errors[:30]:
            print(f"[FAIL] {error}")
        if errors:
            return 1
        print(f"[OK] {len(specs)} exam share cards present, intact and rendered from the current text")
        return 0
    todo = sorted(specs) if args.force else stale_cards(specs, record)
    stray = [p for p in OUT.glob("*.png") if p.stem not in specs] if OUT.is_dir() else []
    for path in stray:
        path.unlink()
    record = {k: v for k, v in record.items() if k in specs}
    if not todo:
        if stray:
            RECORD.write_text(json.dumps(record, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        print(f"[OK] {len(specs)} exam share cards current" + (f"; removed {len(stray)} unused" if stray else ""))
        return 0
    try:
        import PIL  # noqa: F401
    except ImportError:
        print(f"[FAIL] {len(todo)} exam share card(s) need rendering ({', '.join(todo[:5])}) and Pillow is "
              "not installed. Run python _gen_exam_og.py locally and commit assets/og/exam/ and "
              "data/exam/og_rendered.json.")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for name in todo:
        path = OUT / f"{name}.png"
        render(specs[name]).save(path, format="PNG", optimize=True)
        record[name] = {"text": text_hash(specs[name]), "png": file_hash(path)}
    RECORD.write_text(json.dumps(record, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"[OK] rendered {len(todo)} exam share card(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
