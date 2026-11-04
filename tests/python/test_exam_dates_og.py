"""Owner decisions 2026-11-04: per-page dates and share cards for /exam, ported from the
dermatology exam section.

- data/exam/page_dates.json is the date ledger: a page keeps its dates while the hash of
  its visible text matches, so CI's regenerate-and-compare reproduces it on any day; new
  or changed text takes the build's content date. The dates feed JSON-LD datePublished /
  dateModified, the 「最後更新」 line (hub, chapters, 考點總覽) and sitemap <lastmod>.
- Every chapter page has its own 1200x630 card (assets/og/exam/bcsc<b>-<c>.png); the hub
  and the tool pages share hub.png. _gen_exam_og.py --check (CI, via
  _check_exam_og_cards.py) needs no Pillow.

Builds run in memory (_gen_exam.build() writes nothing); temporary files only for --check.
"""
import contextlib
import io
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import _gen_exam as gen
import _gen_exam_og as og

ROOT = Path(__file__).resolve().parents[2]


def committed_ledger() -> dict:
    return json.loads((ROOT / "data" / "exam" / "page_dates.json").read_text(encoding="utf-8"))


def route_of(name: str) -> str:
    return "/exam" if name == "index.html" else "/exam/" + name[:-5]


class LedgerTests(unittest.TestCase):
    def dates(self, ledger: dict, path: str, body: str, today: str) -> tuple[str, str]:
        with patch.dict(gen.LEDGER, ledger, clear=True), patch.dict(gen.NEW_LEDGER, {}, clear=True), \
                patch.object(gen, "CONTENT_DATE", [today]), patch.object(gen, "LEDGER_LOADED", [True]):
            got = gen.page_dates(path, body)
            self.assertEqual((gen.NEW_LEDGER[path]["published"], gen.NEW_LEDGER[path]["modified"]), got)
            return got

    def test_unchanged_content_keeps_dates_on_any_day(self):
        body = "<h1>Ch.1</h1><p>重點</p>"
        entry = {"hash": gen.content_hash(body), "published": "2026-10-15", "modified": "2026-10-21"}
        self.assertEqual(self.dates({"/exam/x": entry}, "/exam/x", body, "2099-01-01"), ("2026-10-15", "2026-10-21"))

    def test_changed_content_takes_the_content_date_and_keeps_published(self):
        entry = {"hash": gen.content_hash("<p>舊</p>"), "published": "2026-10-15", "modified": "2026-10-21"}
        self.assertEqual(self.dates({"/exam/x": entry}, "/exam/x", "<h1>a</h1><p>新</p>", "2026-11-05"),
                         ("2026-10-15", "2026-11-05"))

    def test_new_page_is_published_and_modified_on_the_content_date(self):
        self.assertEqual(self.dates({}, "/exam/new", "<h1>a</h1>", "2026-11-05"), ("2026-11-05", "2026-11-05"))

    def test_hash_ignores_markup_and_the_outline_but_not_text(self):
        base = gen.content_hash('<h1>Ch.1</h1><p class="a">重點 一</p>')
        self.assertEqual(base, gen.content_hash('<h1 class="x">Ch.1</h1>\n<p><b>重點</b>一</p>'))
        self.assertEqual(base, gen.content_hash('<h1>Ch.1</h1><nav class="ex-toc"><ol><li>x</li></ol></nav><p>重點一</p>'))
        self.assertEqual(base, gen.content_hash('<h1>Ch.1</h1><p><a href="/a?v=2">重點</a>一</p>'))
        self.assertNotEqual(base, gen.content_hash("<h1>Ch.1</h1><p>重點二</p>"))

    def test_visible_date_joins_the_meta_line_or_gets_its_own(self):
        stamp = '<span class="ex-updated">最後更新：<time datetime="2026-11-04">2026-11-04</time></span>'
        self.assertEqual(gen.with_updated('<h1>a</h1><p class="ex-meta">原書 p.1</p><p>x</p>', "2026-11-04"),
                         f'<h1>a</h1><p class="ex-meta">原書 p.1 · {stamp}</p><p>x</p>')
        self.assertEqual(gen.with_updated('<h1>a</h1><p class="ex-lead">x</p>', "2026-11-04"),
                         f'<h1>a</h1><p class="ex-meta">{stamp}</p><p class="ex-lead">x</p>')

    def test_invalid_ledger_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "page_dates.json"
            for bad in ({"/exam": {"hash": "x", "published": "2026-10-28", "modified": "2026-10-01"}},
                        {"/exam": {"hash": "x", "published": "2026-1-1", "modified": "2026-10-01"}},
                        {"/exam": {"hash": "x", "published": "2026-10-01"}}):
                path.write_text(json.dumps(bad), encoding="utf-8")
                with self.subTest(bad=bad), patch.object(gen, "PAGE_DATES", path), self.assertRaises(SystemExit):
                    gen.load_ledger()


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = gen.build("2099-01-01")
        cls.ledger = dict(gen.NEW_LEDGER)
        cls.cards = dict(gen.OG_CARDS)
        cls.data = gen.load()

    def test_rebuild_on_another_day_reproduces_the_committed_dates(self):
        # No wall clock: an unchanged tree rebuilds the committed ledger in 2099.
        self.assertEqual(self.ledger, committed_ledger())
        self.assertEqual(self.files["../data/exam/page_dates.json"], gen.ledger_text(committed_ledger()))
        self.assertEqual(set(self.ledger), {route_of(n) for n in self.files if n.endswith(".html") and "/" not in n})
        # Every chapter page changed on 2026-11-04 (Chinese names, links), so look at the
        # first-published dates, which still come from each page's own history.
        self.assertGreater(len({e["published"] for e in self.ledger.values()}), 2, "dates are per page, not one day")

    def test_a_content_change_moves_only_that_pages_date(self):
        real_load = gen.load
        key = "8-6"

        def edited():
            data = real_load()
            data["notes"][key] = data["notes"][key].replace("</li>", "（測試用新增文字）</li>", 1)
            return data

        with patch.object(gen, "load", edited):
            files = gen.build("2099-01-01")
            ledger = dict(gen.NEW_LEDGER)
        moved = {p: e for p, e in ledger.items() if e != self.ledger[p]}
        self.assertEqual(list(moved), [f"/exam/bcsc{key}"])
        self.assertEqual(moved[f"/exam/bcsc{key}"]["modified"], "2099-01-01")
        self.assertEqual(moved[f"/exam/bcsc{key}"]["published"], self.ledger[f"/exam/bcsc{key}"]["published"])
        self.assertIn('"dateModified":"2099-01-01"', files[f"bcsc{key}.html"])
        self.assertIn('<time datetime="2099-01-01">2099-01-01</time>', files[f"bcsc{key}.html"])
        self.assertIn(f"url: '/exam/bcsc{key}', priority: '0.6', changefreq: 'monthly', lastmod: '2099-01-01'",
                      files["../api/_exam_routes.js"])

    def test_check_mode_fails_when_the_ledger_is_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            stale = committed_ledger()
            stale["/exam/bcsc8-6"]["hash"] = "0" * 16
            path = Path(folder) / "page_dates.json"
            path.write_text(gen.ledger_text(stale), encoding="utf-8")
            with patch.object(gen, "PAGE_DATES", path), contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(gen.main(["--check"]), 1)
            self.assertIn("page_dates.json", out.getvalue())

    def test_jsonld_visible_dates_and_image(self):
        for name, html in self.files.items():
            if not name.endswith(".html") or "/" in name:
                continue
            with self.subTest(page=name):
                entry = self.ledger[route_of(name)]
                node = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html).group(1))
                self.assertEqual((node["datePublished"], node["dateModified"]), (entry["published"], entry["modified"]))
                kind = re.search(r'data-exam-page="(\w+)"', html).group(1)
                self.assertEqual(html.count('<span class="ex-updated">'), 1 if kind in gen.STAMPED else 0)
                image = re.search(r'<meta property="og:image" content="([^"]+)" />', html).group(1)
                self.assertEqual(node["image"]["url"], image)
                self.assertIn(f'<meta name="twitter:image" content="{image}" />', html)
                card = "hub" if kind != "chapter" else name[:-5]
                self.assertEqual(image, f"{gen.DOMAIN}/assets/og/exam/{card}.png")
                self.assertIn(card, self.cards)

    def test_card_text(self):
        key = "8-6"
        ch, qs = self.data["chapters"][key], self.data["by_chapter"][key]
        self.assertEqual(self.cards[f"bcsc{key}"], {
            "kicker": f"BCSC {ch['book']} Ch.{ch['ch']}", "title": self.data["zh"][key][0], "subtitle": ch["title"],
            "foot": f"考題 {len(qs)} 題 · 重點整理"})
        # A chapter tagged by no question (1-1) has notes only.
        self.assertEqual(self.cards["bcsc1-1"]["foot"], "重點整理")
        # Every chapter has a Chinese name since 2026-11-04, so drop one to see the English form.
        data = {**self.data, "zh": {k: v for k, v in self.data["zh"].items() if k != key}}
        saved = gen.OG_CARDS[f"bcsc{key}"]
        try:
            gen.chapter_page(data, key, gen.site_version())
            self.assertEqual(gen.OG_CARDS[f"bcsc{key}"]["title"], ch["title"])
            self.assertEqual(gen.OG_CARDS[f"bcsc{key}"]["subtitle"], "")
        finally:
            gen.OG_CARDS[f"bcsc{key}"] = saved
        self.assertEqual(self.cards["hub"]["title"], gen.HUB_TITLE)
        self.assertEqual(self.files["../data/exam/og_cards.json"],
                         (ROOT / "data" / "exam" / "og_cards.json").read_text(encoding="utf-8"))

    def test_cards_cover_every_chapter_page_and_the_hub(self):
        self.assertEqual(set(self.cards), {n[:-5] for n in self.files if re.fullmatch(r"bcsc\d+-\d+\.html", n)} | {"hub"})


class CommittedOutputTests(unittest.TestCase):
    def test_sitemap_lastmod_is_each_pages_date_modified(self):
        sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
        lastmods = dict(re.findall(r"<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", sitemap))
        ledger = committed_ledger()
        routes = gen.indexed_routes()
        self.assertTrue(routes)
        for route in routes:
            self.assertEqual(lastmods.get(gen.DOMAIN + route), ledger[route]["modified"], route)
        api = (ROOT / "api" / "_exam_routes.js").read_text(encoding="utf-8")
        for route in routes:
            self.assertIn(f"url: '{route}', priority: '{'0.8' if route == '/exam' else '0.6'}', changefreq: 'monthly', "
                          f"lastmod: '{ledger[route]['modified']}'", api)
        self.assertIn("p.lastmod || siteUpdated", (ROOT / "api" / "sitemap.js").read_text(encoding="utf-8"))

    def test_committed_cards_match_their_text(self):
        specs = og.load_json(og.SPECS)
        record = og.load_json(og.RECORD)
        self.assertEqual(og.check(specs, record), [])
        name = next(n for n in specs if n != "hub")
        edited = dict(specs, **{name: dict(specs[name], foot="考題 999 題 · 重點整理")})
        self.assertEqual(og.stale_cards(edited, record), [name])
        for path in (og.OUT / f"{n}.png" for n in specs):
            self.assertLessEqual(path.stat().st_size, og.MAX_BYTES)
            self.assertEqual(og.png_size(path), (1200, 630))

    def test_card_check_reports_missing_stray_and_broken_files(self):
        specs = og.load_json(og.SPECS)
        record = og.load_json(og.RECORD)
        name = next(n for n in specs if n != "hub")
        errors = og.check(dict(specs, **{"bcsc99-9": dict(specs[name], title="x")}), record)
        self.assertTrue(any("bcsc99-9.png is missing" in e for e in errors))
        errors = og.check({k: v for k, v in specs.items() if k != name}, record)
        self.assertTrue(any(name in e and "no exam page uses" in e for e in errors))
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            shutil.copy(og.OUT / f"{name}.png", out / f"{name}.png")
            broken = (out / f"{name}.png").read_bytes()[:-20]
            (out / f"{name}.png").write_bytes(broken)
            self.assertIsNone(og.png_size(out / f"{name}.png"))
            with patch.object(og, "OUT", out):
                errors = og.check({name: specs[name]}, {name: dict(record[name], png=og.file_hash(out / f"{name}.png"))})
            self.assertTrue(any("not an intact PNG" in e for e in errors), errors)

    def test_check_needs_no_pillow_and_is_wired_into_the_static_gate(self):
        src = (ROOT / "_gen_exam_og.py").read_text(encoding="utf-8")
        head = src.split("def render(", 1)[0]
        self.assertNotIn("PIL", head.replace("Pillow", ""), "--check must not import Pillow")
        wrapper = (ROOT / "_check_exam_og_cards.py").read_text(encoding="utf-8")
        self.assertIn('_gen_exam_og.main(["--check"])', wrapper)


if __name__ == "__main__":
    unittest.main()
