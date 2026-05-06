"""
HsiaoEye — convert half-width punctuation adjacent to Chinese characters to full-width.

Uses explicit \\u escapes for the replacement chars so IME ambiguity can't
silently turn the rules into no-ops.

Half → full:
  ( U+0028 -> ( U+FF08
  ) U+0029 -> ) U+FF09
  , U+002C -> , U+FF0C
  ; U+003B -> ; U+FF1B
  ! U+0021 -> ! U+FF01
  ? U+003F -> ? U+FF1F

Conversions only fire when at least one side is a CJK Unified Ideograph,
so JS code, JSON syntax, and English contexts are untouched.

Usage:
  python halfwidth_to_fullwidth.py [--dry-run]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
EXTS = {'.html', '.htm'}
SKIP_DIRS = {'.git', 'node_modules', '.vercel', '__pycache__'}

CN = r'[一-鿿]'   # CJK Unified Ideographs
SP = '　'              # ideographic space (not used, but for reference)

# Full-width punctuation as explicit unicode escapes — no IME ambiguity.
FW_LP   = '（'   # (
FW_RP   = '）'   # )
FW_COMM = '，'   # ,
FW_SEMI = '；'   # ;
FW_COLN = '：'   # :
FW_EXCL = '！'   # !
FW_QUES = '？'   # ?

RULES = [
    # (中  -> (中
    (re.compile(rf'\(({CN})'),                rf'{FW_LP}\g<1>'),
    # 中(  -> 中(
    (re.compile(rf'({CN})\('),                rf'\g<1>{FW_LP}'),
    # 中)  -> 中)
    (re.compile(rf'({CN})\)'),                rf'\g<1>{FW_RP}'),
    # )中  -> )中
    (re.compile(rf'\)({CN})'),                rf'{FW_RP}\g<1>'),
    # 中,中 -> 中,中
    (re.compile(rf'({CN}),({CN})'),           rf'\g<1>{FW_COMM}\g<2>'),
    # 中,<空白>  -> 中,<空白>
    (re.compile(rf'({CN}),(\s)'),             rf'\g<1>{FW_COMM}\g<2>'),
    # 中;中 -> 中;中
    (re.compile(rf'({CN});({CN})'),           rf'\g<1>{FW_SEMI}\g<2>'),
    # 中:中 -> 中：中  (colon after Chinese, before Chinese OR space — common bug)
    (re.compile(rf'({CN}):({CN})'),           rf'\g<1>{FW_COLN}\g<2>'),
    # 中:<空白/標籤>  -> 中：
    (re.compile(rf'({CN}):(\s|<|$)'),         rf'\g<1>{FW_COLN}\g<2>'),
    # Number range with colon (e.g. "問題 1:") — Chinese-context heading
    (re.compile(rf'(?<=[一-鿿\s])(\d+):(\s|<|$)'),       rf'\g<1>{FW_COLN}\g<2>'),
    # 中!中 -> 中!中
    (re.compile(rf'({CN})!({CN})'),           rf'\g<1>{FW_EXCL}\g<2>'),
    # 中!尾 -> 中!尾
    (re.compile(rf'({CN})!(\s|<|$)'),         rf'\g<1>{FW_EXCL}\g<2>'),
    # 中?中 -> 中?中
    (re.compile(rf'({CN})\?({CN})'),          rf'\g<1>{FW_QUES}\g<2>'),
    # 中?尾 -> 中?尾
    (re.compile(rf'({CN})\?(\s|<|$)'),        rf'\g<1>{FW_QUES}\g<2>'),
]

# CSS never has punctuation that needs conversion — stash <style> blocks
STYLE_BLOCK_RE = re.compile(r'<style[^>]*>.*?</style>', re.DOTALL | re.IGNORECASE)

def convert(text: str) -> tuple[str, int]:
    placeholders: list[str] = []
    def stash(m: re.Match) -> str:
        placeholders.append(m.group(0))
        return f'\x00PH{len(placeholders)-1}\x00'

    text = STYLE_BLOCK_RE.sub(stash, text)

    total = 0
    # One pass is enough since rules transform half→full only.
    for pat, rep in RULES:
        new_text, n = pat.subn(rep, text)
        if n > 0:
            total += n
            text = new_text

    for i, ph in enumerate(placeholders):
        text = text.replace(f'\x00PH{i}\x00', ph)

    return text, total

def walk_files(root: Path):
    for p in root.rglob('*'):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in EXTS and p.is_file():
            yield p

def main():
    dry = '--dry-run' in sys.argv
    grand_total = 0
    files_changed = 0
    for fp in walk_files(ROOT):
        try:
            original = fp.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            print(f'skip (not utf-8): {fp}')
            continue
        new, n = convert(original)
        if n > 0:
            rel = fp.relative_to(ROOT)
            print(f'  {rel}: {n} replacements')
            grand_total += n
            files_changed += 1
            if not dry:
                fp.write_text(new, encoding='utf-8')
    mode = 'WOULD WRITE' if dry else 'WROTE'
    print(f'\n{mode}: {files_changed} files, {grand_total} total replacements')

if __name__ == '__main__':
    main()
