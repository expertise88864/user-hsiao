"""Read explicit author metadata; ordinary legacy pages keep existing fallbacks."""
from html.parser import HTMLParser
import json
import re
from urllib.parse import unquote
from halfwidth_to_fullwidth import RULES


def author_metadata(source):
    class Reader(HTMLParser):
        def __init__(self):
            super().__init__()
            self.values = []
            self.in_head = False

        def handle_starttag(self, tag, attrs):
            if tag == 'head':
                self.in_head = True
            values = dict(attrs)
            if self.in_head and tag == 'meta' and values.get('name') == 'hs-editor-metadata':
                self.values.append(values.get('content') or '')

        def handle_endtag(self, tag):
            if tag == 'head':
                self.in_head = False

    reader = Reader()
    reader.feed(source)
    if not reader.values:
        return {}
    if len(reader.values) != 1:
        raise ValueError('Duplicate editor metadata')
    if re.search(r'%(?![a-fA-F0-9]{2})', reader.values[0]):
        raise ValueError('Invalid editor metadata encoding')
    data = json.loads(unquote(reader.values[0], errors='strict'))
    limits = {'titleZh': 512, 'titleEn': 512, 'searchTitleZh': 512,
              'descriptionZh': 2000, 'descriptionEn': 2000}
    if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] != 1 or set(data) - (set(limits) | {'version', 'catalogBaseSha'}):
        raise ValueError('Invalid editor metadata')
    for key, limit in limits.items():
        if key in data and (not isinstance(data[key], str) or len(data[key].encode('utf-16-le')) // 2 > limit or
                            re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', data[key]) or 'title' in key.lower() and not data[key].strip()):
            raise ValueError('Invalid editor metadata field')
    if 'catalogBaseSha' in data and (not isinstance(data['catalogBaseSha'], str) or not re.fullmatch(r'[a-f0-9]{40}', data['catalogBaseSha'])):
        raise ValueError('Invalid catalog version')
    # Explicit metadata is plain text, so trailing punctuation is normalized
    # before generators apply it; percent encoding/attribute quotes are not
    # part of the text's Chinese context. Preserve unrelated legacy markup.
    for key in limits:
        if key in data and re.search(r'[一-鿿]', data[key]):
            for pattern, replacement in RULES:
                data[key] = pattern.sub(replacement, data[key])
    return data
