"""Owner requests 2026-10-17: pinned board-exam card, hub disease search, hub order.

- index.html and blog/index.html pin a card to /exam at the top of the article
  list; it is not an article, so filters, counts and the date sort ignore it.
- The /exam hub has a disease search whose results land on the exact note
  paragraph: every searchable paragraph of a chapter carries id "np-<n>", in
  the same order as exam/notes-data.json lists it.
- Hub order: search, tools, access note, 考古卷, chapters, frequency table
  (all ranked chapters; exam.js shows 25 at a time).
"""
import re
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

import _gen_exam as gen
from _gen_blog_filter import render

ROOT = Path(__file__).resolve().parents[2]


def norm(text: str) -> str:
    return re.sub(r"[\W_]+", "", text).lower()


class PinnedExamCardTests(unittest.TestCase):
    def check_list(self, rel: str, selector: str):
        doc = BeautifulSoup((ROOT / rel).read_text(encoding="utf-8"), "html.parser")
        lst = doc.select_one(selector)
        first = lst.find(True)
        self.assertEqual(first.name, "a")
        self.assertEqual(first.get("href"), "/exam")
        self.assertIn("hs-pin-card", first["class"])
        self.assertNotIn("article-list-item", first["class"])
        self.assertEqual(first.h3.get_text(strip=True), "眼科專科醫師考試重點整理與考題解析")
        for node in [first.h3, first.p, *first.select(".chip")]:
            self.assertTrue(node.get("data-zh") and node.get("data-en"), node)
        self.assertEqual(len(doc.select(".hs-pin-card")), 1)
        self.assertFalse(first.select('[class*="cat-"]'), "a cat-* chip would make filters treat it as an article")
        return doc

    def test_homepage_pins_the_exam_card_first(self):
        self.check_list("index.html", "#hs-article-list")

    def test_blog_index_pins_the_exam_card_first_and_filter_ignores_it(self):
        doc = self.check_list("blog/index.html", ".article-list")
        articles = len(doc.select(".article-list-item"))
        out = BeautifulSoup(render((ROOT / "blog/index.html").read_text(encoding="utf-8"), ""), "html.parser")
        everything = out.select_one('#hs-blog-filter button[data-cat=""] .count')
        self.assertEqual(int(everything.get_text()), articles)

    def test_english_mirrors_show_the_english_card_text(self):
        for rel in ("en/index.html", "en/blog/index.html"):
            card = BeautifulSoup((ROOT / rel).read_text(encoding="utf-8"), "html.parser").select_one(".hs-pin-card")
            self.assertEqual(card.h3.get_text(strip=True), "Ophthalmology Board Exam: BCSC Notes and Question Explanations", rel)
            self.assertEqual(card["href"], "/exam")


class ExamHubTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()
        cls.hub = gen.hub_page(cls.data, cls.version)
        cls.doc = BeautifulSoup(cls.hub, "html.parser")

    def test_hub_order(self):
        main = str(self.doc.select_one("main"))
        marks = ['data-hub-search', 'class="ex-tools"', "課本重點整理公開；考題、答案與詳解需要登入才能看。",
                 'href="/exam/practice"', ">依 BCSC 章節瀏覽</h2>", ">出題頻率：最常考</h2>", 'class="ex-rank"', 'class="ex-more"']
        at = [main.index(m) for m in marks]
        self.assertEqual(at, sorted(at), list(zip(marks, at)))
        self.assertLess(main.index("</h1>"), at[0])

    def test_practice_is_called_kaoguzhuan(self):
        cta = self.doc.select_one('a[href="/exam/practice"]')
        self.assertEqual(cta.get_text(), "考古卷：自選範圍／隨機出題")
        practice = gen.practice_page(self.data, self.version)
        for page in (self.hub, practice):
            self.assertNotIn("模擬考", page)
        self.assertIn('<p class="ex-kicker">考古卷</p>', practice)
        self.assertIn("考古卷", self.doc.select_one('meta[name="description"]')["content"])

    def test_rank_table_lists_every_chapter_with_questions(self):
        rows = self.doc.select("table.ex-rank tbody tr")
        with_qs = [k for k, qs in self.data["by_chapter"].items() if qs]
        self.assertEqual(len(rows), len(with_qs))
        self.assertGreater(len(rows), gen.TOP_N)
        counts = [int(r.select_one(".ex-num").get_text()) for r in rows]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertEqual(self.doc.select_one("table.ex-rank")["data-rank-step"], str(gen.TOP_N))
        more = self.doc.select_one(".ex-more")
        self.assertTrue(more.has_attr("hidden"), "without JavaScript every row stays visible and no button shows")
        self.assertEqual(more.button.get_text(), "載入更多")
        self.assertFalse(any(r.has_attr("hidden") for r in rows))
        self.assertTrue(self.doc.select("table.ex-rank .ex-badge"))
        self.assertTrue(self.doc.select("table.ex-rank .ex-bar"))

    def test_hub_search_falls_back_to_the_search_page(self):
        form = self.doc.select_one("form[data-hub-search]")
        self.assertEqual((form["action"], form["method"], form.get("role")), ("/exam/search", "get", "search"))
        field = form.select_one("input[name=q]")
        self.assertEqual(form.select_one("label")["for"], field["id"])
        # The submit button says what it finds (chapters), not a generic 搜尋.
        self.assertEqual(form.select_one("button[type=submit]").get_text(), "找章節")
        self.assertTrue(self.doc.select_one(".ex-find-status[aria-live]"))

    def test_search_index_paragraphs_match_page_ids(self):
        notes = gen.notes_data(self.data)["notes"]
        self.assertTrue(notes)
        for key, paras in notes.items():
            page = BeautifulSoup(gen.chapter_page(self.data, key, self.version), "html.parser")
            for hit in page.select(".ex-qref"):  # expanded {{q:...}} links are not indexed
                hit.decompose()
            ids = [el["id"] for el in page.select('.ex-note [id^="np-"]')]
            self.assertEqual(ids, [f"np-{i + 1}" for i in range(len(paras))], key)
            for i in (0, len(paras) // 2, len(paras) - 1):
                element = page.find(id=f"np-{i + 1}")
                self.assertIn(norm(paras[i]["t"])[:40], norm(element.get_text()), (key, i))

    def test_chapter_data_says_which_chapters_have_pages_and_sections(self):
        chapters = gen.notes_data(self.data)["chapters"]
        for key, ch in chapters.items():
            self.assertEqual(ch["q"], len(self.data["by_chapter"].get(key, [])))
            self.assertEqual("secs" in ch, key in self.data["notes"])
        key = next(iter(self.data["notes"]))
        self.assertTrue(all(chapters[key]["secs"].values()))

    def test_source_paragraph_ids_are_rejected(self):
        with self.assertRaises(SystemExit):
            gen.anchor_notes("1-1", '<h2 id="ch1-s1">A</h2><p id="mine">text</p>')
        out = gen.anchor_notes("1-1", '<h2 id="ch1-s1">A</h2><ul><li>one<ul><li>two</li></ul></li><li></li><li>three</li></ul><p>four</p>')
        self.assertEqual(re.findall(r'id="(np-\d+)"', out), ["np-1", "np-2", "np-3"])
        self.assertEqual([p["t"] for p in gen.note_text(out)], ["onetwo", "three", "four"])


if __name__ == "__main__":
    unittest.main()
