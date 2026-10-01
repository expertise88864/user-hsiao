"""Wrap authored text SVGs in static reading controls without rewriting SVG bytes.

Only canonical blog HTML is written. English mirrors consume this result later.
The parser locates complete article SVG spans; it is not an HTML normalizer.
Malformed spans/viewBoxes fail rather than silently dropping an authored diagram.
"""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import math
import re

ROOT = Path(__file__).resolve().parent
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}


class DiagramSpans(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0]
        self.lines.extend(m.end() for m in re.finditer('\n', source))
        self.stack = []
        self.diagrams = []
        self.svg = None

    def absolute_position(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'svg' and self.svg is None and any(t[0] == 'article' for t in self.stack):
            scroll = next((t for t in reversed(self.stack)
                           if 'hs-diagram-scroll' in (t[1].get('class') or '').split()), None)
            self.svg = {'start': self.absolute_position(), 'attrs': attributes,
                        'depth': len(self.stack), 'scroll': scroll}
        if tag not in VOID:
            self.stack.append((tag, attributes, self.absolute_position(), self.get_starttag_text()))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'svg' and self.svg is not None and len(self.stack) == self.svg['depth'] + 1:
            end = self.source.find('>', self.absolute_position()) + 1
            if not end:
                raise ValueError('Unclosed SVG end tag')
            item = self.svg
            item['end'] = end
            item['html'] = self.source[item['start']:end]
            self.diagrams.append(item)
            self.svg = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def wrap_diagrams(source):
    parser = DiagramSpans(source)
    parser.feed(source)
    parser.close()
    if parser.svg is not None:
        raise ValueError('Unclosed article SVG')
    changes = []
    width_updates = {}
    used_ids = set(re.findall(r'\bid\s*=\s*["\']([^"\']+)["\']', source))
    for index, diagram in enumerate(parser.diagrams, 1):
        if not re.search(r'<text(?:\s|>)', diagram['html'], re.I):
            continue
        values = re.split(r'[\s,]+', (diagram['attrs'].get('viewbox') or '').strip())
        try:
            box = [float(v) for v in values]
        except ValueError as error:
            raise ValueError('Text diagram requires a numeric viewBox') from error
        if len(box) != 4 or not all(math.isfinite(v) for v in box) or box[2] <= 0 or box[3] <= 0:
            raise ValueError('Text diagram requires a finite positive viewBox')
        # Coordinate labels are at least 12px under the existing article CSS.
        # This natural-size floor preserves their layout; transformed labels
        # still require the rendered readability checks, not a ranking score.
        width = math.ceil(box[2] * 16 / 15)
        if diagram['scroll']:
            scroll = diagram['scroll']
            previous = width_updates.get(scroll[2])
            width_updates[scroll[2]] = (scroll, max(width, previous[1] if previous else 0))
            continue
        while any(f'hs-diagram-{kind}-{index}' in used_ids for kind in ('mode', 'label', 'hint')):
            index += 1
        mode = f'hs-diagram-mode-{index}'
        title = f'hs-diagram-label-{index}'
        hint = f'hs-diagram-hint-{index}'
        used_ids.update((mode, title, hint))
        zh = '可用上下左右捲動閱讀，關閉「放大圖表」恢復原尺寸。'
        en = 'Scroll horizontally and vertically to read the diagram. Close Enlarge diagram to restore its original size.'
        opening = (f'<div class="hs-diagram-reader"><details class="hs-diagram-mode" id="{mode}">'
                   f'<summary id="{title}" data-zh="放大圖表" data-en="Enlarge diagram">放大圖表</summary>'
                   f'<p class="hs-diagram-hint" id="{hint}" data-zh="{escape(zh, quote=True)}" '
                   f'data-en="{escape(en, quote=True)}">{zh}</p></details>'
                   f'<div class="hs-diagram-scroll" tabindex="0" role="group" '
                   f'aria-labelledby="{title}" aria-describedby="{hint}" '
                   f'style="--hs-diagram-width:{width}px">')
        changes.append((diagram['start'], diagram['end'], opening + diagram['html'] + '</div></div>'))
    for start, (scroll, width) in width_updates.items():
        raw = scroll[3]
        def update_style(match):
            value = match.group(3)
            if re.search(r'(?:^|;)\s*--hs-diagram-width\s*:', value):
                value = re.sub(r'(--hs-diagram-width\s*:)\s*[^;]+', r'\g<1>' + str(width) + 'px', value)
            else:
                value += (';' if value and not value.endswith(';') else '') + f'--hs-diagram-width:{width}px'
            return match.group(1) + match.group(2) + value + match.group(2)
        if re.search(r'\sstyle\s*=', raw, re.I):
            if not re.search(r'(\sstyle\s*=\s*)(["\'])(.*?)\2', raw, re.I | re.S):
                raise ValueError('Diagram style requires quoted attributes')
            updated = re.sub(r'(\sstyle\s*=\s*)(["\'])(.*?)\2', update_style, raw, flags=re.I | re.S)
        else:
            updated = raw[:-1] + f' style="--hs-diagram-width:{width}px">'
        if updated != raw:
            changes.append((start, start + len(raw), updated))
    for start, end, replacement in sorted(changes, reverse=True):
        source = source[:start] + replacement + source[end:]
    if changes or 'class="hs-diagram-reader"' in source:
        article_css = re.search(r'<link\b[^>]*href=["\'][^"\']*/assets/article\.css\?v=(\d+)["\'][^>]*>', source)
        if not article_css:
            raise ValueError('Diagram reader requires the article stylesheet version')
        version = article_css.group(1)
        if '/assets/diagram-reader.css?' not in source:
            source = source[:article_css.end()] + f'\n<link rel="stylesheet" href="/assets/diagram-reader.css?v={version}">' + source[article_css.end():]
        else:
            source = re.sub(r'(/assets/diagram-reader\.css\?v=)\d+', r'\g<1>' + version, source)
    return source


def main():
    changed = 0
    for path in sorted((ROOT / 'blog').glob('*.html')):
        original = path.read_bytes()
        try:
            result = wrap_diagrams(original.decode('utf-8')).encode('utf-8')
        except ValueError as error:
            raise ValueError(f'{path.name}: {error}') from error
        if result != original:
            path.write_bytes(result)
            changed += 1
    print(f'Diagram reader pages updated: {changed}')


if __name__ == '__main__':
    main()
