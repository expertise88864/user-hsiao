#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Single place that serialises JSON-LD destined for a <script> block. (M-13)

WHY THIS EXISTS
    `json.dumps` does not escape `<`. Any generator that drops its output into
    `<script type="application/ld+json">…</script>` therefore ends the block
    early if a title or description ever contains a literal `</script>`, and
    everything after it is parsed as markup.

    Today's content is the site owner's own medical writing, so this is
    defence-in-depth rather than a live hole — but the emitters are spread over
    eight generators, and "every one of them remembers" is exactly the kind of
    invariant that decays. One helper, one rule.

WHAT IT ESCAPES, AND WHY THESE THREE
    `<`, `>` and `&` become `\\u003c`, `\\u003e`, `\\u0026`. This is the standard
    JSON-LD/JSON-in-HTML convention: the escapes are valid JSON string escapes,
    so the parsed VALUE is byte-identical — nothing about the schema changes —
    while no substring of the output can close the script element or open a
    markup construct. Escaping `<` alone would be enough for `</script>`;
    including `>` and `&` also neutralises `<!--` / `]]>` style sequences that
    HTML parsers treat specially inside script content.
"""

from __future__ import annotations

import json

_HTML_UNSAFE = {'<': '\\u003c', '>': '\\u003e', '&': '\\u0026'}


def dumps(data: object, **kwargs: object) -> str:
    """json.dumps with the HTML-sensitive characters escaped.

    Accepts the same keyword arguments as json.dumps; `ensure_ascii=False` is the
    default here because the site's JSON-LD is full of Chinese and escaping it
    would bloat every block.
    """
    kwargs.setdefault('ensure_ascii', False)
    out = json.dumps(data, **kwargs)  # type: ignore[arg-type]
    for ch, esc in _HTML_UNSAFE.items():
        out = out.replace(ch, esc)
    return out


def script_block(data: object, **kwargs: object) -> str:
    """A complete <script type="application/ld+json"> element."""
    return ('<script type="application/ld+json">\n'
            + dumps(data, **kwargs) + '\n</script>')
