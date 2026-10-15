"""Import the ophthalmology board-exam question bank PDF into data/exam/questions.json.

One-off importer, rerun only when a new edition of the bank arrives. Requires
PyMuPDF and Pillow (not needed by CI or the build chain):

    python _exam_import.py "<path>/歷屆專科醫師考試題庫.pdf"

The PDF was annotated on an iPad: its text layer mixes the typed questions with
Live Text OCR of handwriting. Only spans in the typeset fonts are kept, so the
handwritten marks never leak into the stems or options. Question numbers sit in
their own left-hand column, which is how question boundaries are found.

Embedded figures are written to data/exam/figures/q<n>.webp (never deployed) and attached to the
question whose vertical span contains them.
"""
from __future__ import annotations

import collections
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "exam" / "questions.json"
IMG_DIR = ROOT / "data" / "exam" / "figures"
TYPED_FONTS = {"TimesNewRomanPSMT", "PMingLiU", "DFKaiShu-SB-Estd-BF", "MS-Gothic", "SegoeUISymbol"}
OPTION_RE = re.compile(r"^\(([A-E])\)\s*(.*)")
CJK = r"一-鿿"
# The bank was typed partly from Simplified sources. The site publishes Traditional
# Chinese only (Taiwan MOE standard forms), so these characters are normalised.
TW_FIXES = str.maketrans({
    "静": "靜", "横": "橫", "纹": "紋", "结": "結", "约": "約", "棱": "稜", "踪": "蹤",
    "痹": "痺", "疱": "皰", "污": "汙", "仆": "卜", "于": "予", "占": "佔",
})


def typed_rows(doc):
    """Yield (page, y, x, text) for each typeset line, dropping page headers and footers."""
    rows = []
    for pno, page in enumerate(doc, start=1):
        height = page.rect.height
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(s["text"] for s in line["spans"] if s["font"] in TYPED_FONTS).strip()
                if not text:
                    continue
                x0, y0 = line["bbox"][0], line["bbox"][1]
                if y0 < 70 and text.startswith("考古題"):
                    continue
                if y0 > height - 60 and re.fullmatch(r"\d+", text):
                    continue
                if text in ("題號", "題目"):
                    continue
                rows.append((pno, round(y0, 1), x0, text))
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    # Rows whose tops are within 4pt form one visual line; order them left to right so a
    # question number always precedes its stem.
    lines, group = [], []
    for row in rows:
        if group and (row[0] != group[0][0] or row[1] - group[0][1] > 4):
            lines += sorted(group, key=lambda g: g[2])
            group = []
        group.append(row)
    return lines + sorted(group, key=lambda g: g[2])


def join(prev: str, nxt: str) -> str:
    if re.search(rf"[{CJK}，、（(]$", prev) or re.match(rf"^[{CJK}，。、）)]", nxt):
        return prev + nxt
    return prev + " " + nxt


def clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(?<=[A-Za-z0-9α-ωΑ-Ω])- (?=[A-Za-z0-9α-ωΑ-Ω])", "-", text)  # line-wrap hyphens
    text = text.replace("ﾟ", "°").translate(TW_FIXES)
    return re.sub(r"\s*。$", "", text)


def parse(doc) -> list[dict]:
    questions: list[dict] = []
    current = None
    last = "stem"
    expect = 1
    for pno, y, x, text in typed_rows(doc):
        if x < 100 and re.fullmatch(r"\d{1,4}", text) and int(text) == expect:
            current = {"n": expect, "page": pno, "y": y, "stem": "", "options": collections.OrderedDict()}
            questions.append(current)
            expect += 1
            last = "stem"
            continue
        if current is None:
            continue
        opt = OPTION_RE.match(text)
        if opt:
            current["options"][opt.group(1)] = opt.group(2).strip()
            last = opt.group(1)
        elif last == "stem":
            current["stem"] = join(current["stem"], text) if current["stem"] else text
        else:
            current["options"][last] = join(current["options"][last], text)
    for q in questions:
        q["stem"] = clean(q["stem"])
        q["options"] = {k: clean(v) for k, v in q["options"].items()}
        if sorted(q["options"]) != list("ABCD"):
            raise SystemExit(f"Q{q['n']}: unexpected options {list(q['options'])}")
    return questions


def attach_images(doc, questions: list[dict]) -> None:
    from PIL import Image

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    for pno, page in enumerate(doc, start=1):
        for info in page.get_images(full=True):
            xref = info[0]
            rect = page.get_image_rects(xref)[0]
            owner = None
            for q in questions:
                if (q["page"], q["y"]) <= (pno, rect.y0):
                    owner = q
            if owner is None:
                continue
            pix = doc.extract_image(xref)
            img = Image.open(io.BytesIO(pix["image"])).convert("RGB")
            name = f"q{owner['n']}.webp"
            img.save(IMG_DIR / name, "WEBP", quality=82, method=6)
            owner["image"] = {"src": f"figures/{name}", "width": img.width, "height": img.height}


def main() -> int:
    import fitz

    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    doc = fitz.open(sys.argv[1])
    questions = parse(doc)
    attach_images(doc, questions)
    out = []
    for q in questions:
        row = {"n": q["n"], "stem": q["stem"], "options": q["options"]}
        if "image" in q:
            row["image"] = q["image"]
        out.append(row)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {len(out)} questions, {sum('image' in q for q in out)} with figures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
