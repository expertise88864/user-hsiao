#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""HsiaoEye — every /exam share card is present, intact, small and current.

_check_all.py (CI "Run full static quality gate", preflight) runs every _check_*.py, so
this wrapper puts `python _gen_exam_og.py --check` in that battery. It needs no Pillow:
the cards are rendered locally (python _gen_exam_og.py) and committed, never in CI.

Exit codes:
  0   every card named in data/exam/og_cards.json matches data/exam/og_rendered.json
  1   a card is missing, stale, oversized, not an intact 1200x630 PNG, or stray
"""
from __future__ import annotations

import sys

import _gen_exam_og

if __name__ == "__main__":
    sys.exit(_gen_exam_og.main(["--check"]))
