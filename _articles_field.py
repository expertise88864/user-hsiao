#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""One parser for DN.ARTICLES single-quoted fields. (M-12)

WHY
    Six generators each carried the same regex, `key:\\s*'([^']*)'`, to pull a
    field out of a DN.ARTICLES entry. `[^']*` stops at the FIRST quote, so a
    value containing an escaped apostrophe — written `\\'` in the JS source —
    is truncated there.

    This is not hypothetical for an ophthalmology site. `Sjögren's` is a leading
    cause of dry eye, and `Behçet's` is a uveitis cause; either in a title would
    silently corrupt the search index, the related-articles map, llms.txt, the OG
    cards, the feeds and the /en/ head metadata AT ONCE, because every consumer
    used its own copy of the same broken pattern.

WHAT
    `FIELD_RE(key)` matches an escaped-quote-aware string, and `field()` unescapes
    what it captured. Six copies became one, so a future fix lands everywhere.
"""

from __future__ import annotations

import re

# `(?:[^'\\]|\\.)*` — any run of non-quote, non-backslash characters, or any
# backslash escape (including \' and \\). Unlike [^']*, this walks straight past
# an escaped apostrophe instead of ending the match on it.
_BODY = r"((?:[^'\\]|\\.)*)"


def FIELD_RE(key: str) -> re.Pattern[str]:
    return re.compile(rf"{re.escape(key)}\s*:\s*'{_BODY}'")


def unescape(raw: str) -> str:
    r"""Turn the JS string literal body into its actual value.

    Handles \' \" \\ \n \t and leaves any other \x as x, which is what the
    generators' consumers expect (they are writing text, not re-emitting JS).
    """
    out: list[str] = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch == '\\' and i + 1 < len(raw):
            nxt = raw[i + 1]
            out.append({'n': '\n', 't': '\t', 'r': '\r'}.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return ''.join(out)


def field(key: str, body: str, default: str = '') -> str:
    """Extract `key: '...'` from a DN.ARTICLES entry body, escapes handled."""
    m = FIELD_RE(key).search(body)
    return unescape(m.group(1)) if m else default
