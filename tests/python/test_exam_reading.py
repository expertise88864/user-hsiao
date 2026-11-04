"""Owner request 2026-11-02: reading rounds as on the dermatology exam section.

「跟皮膚科網站一樣 閱讀進度(包括讀了幾次...) 讀過可以在考試區域首頁有打勾 讀幾次」

- Each note <h2> carries data-w (visible characters up to the next <h2>, without the
  question labels); exam.js times each section by it and weighs coverage by it.
- Chapter pages with notes have an empty, hidden status line for exam.js to fill.
- Hub rows (chapter list and frequency table) carry data-ch for the ✓N tick.
- The progress page explains the 重點閱讀 column.
The behaviour itself is covered by tests/seo/exam-reading.spec.js.
"""
import re
import unittest

from bs4 import BeautifulSoup

import _gen_exam as gen


class NoteWeightTests(unittest.TestCase):
    def test_weights_count_visible_characters_up_to_the_next_heading(self):
        out = gen.note_weights('<h2 id="a">A 一</h2><p>二 三<sup class="ex-qref"><span>Q12</span></sup></p>'
                               '<h2 id="b">B</h2><ul><li>x &amp; y</li></ul>')
        self.assertEqual(re.findall(r'<h2 id="(\w)" data-w="(\d+)">', out), [("a", "4"), ("b", "4")])

    def test_an_empty_section_still_weighs_one(self):
        self.assertIn('data-w="1"', gen.note_weights('<h2 id="a"></h2>'))


class PageMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()

    def test_noted_chapters_have_weighted_sections_and_a_status_line(self):
        for key in self.data["notes"]:
            doc = BeautifulSoup(gen.chapter_page(self.data, key, self.version), "html.parser")
            with self.subTest(key=key):
                heads = doc.select(".ex-note h2[id]")
                self.assertTrue(heads)
                self.assertTrue(all(int(h["data-w"]) >= 1 for h in heads))
                status = doc.select_one(".ex-notes #ex-reading.ex-reading")
                self.assertIsNotNone(status)
                self.assertTrue(status.has_attr("hidden"))
                self.assertEqual(status.get_text(), "")
                # It sits after the legend and before the notes.
                self.assertIn("ex-legend", status.find_previous_sibling()["class"])
                self.assertIn("ex-note", status.find_next_sibling()["class"])

    def test_chapters_without_notes_have_no_status_line(self):
        # Every chapter has notes since 2026-11-04, so drop one chapter's notes.
        key = "8-6"
        data = {**self.data, "notes": {k: v for k, v in self.data["notes"].items() if k != key}}
        doc = BeautifulSoup(gen.chapter_page(data, key, self.version), "html.parser")
        self.assertIsNone(doc.select_one("#ex-reading"))

    def test_hub_rows_name_their_chapter(self):
        doc = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        rows = doc.select("table.ex-rank tbody tr")
        self.assertEqual([r["data-ch"] for r in rows],
                         [r.select_one("a")["href"].removeprefix("/exam/bcsc") for r in rows])
        for li in doc.select(".ex-chapter-list li"):
            link = li.select_one("a")
            with self.subTest(li=li.get_text()[:30]):
                if link:
                    self.assertEqual(li["data-ch"], link["href"].removeprefix("/exam/bcsc"))
                else:
                    self.assertFalse(li.has_attr("data-ch"))
        # Ticks are added by exam.js only.
        self.assertFalse(doc.select(".ex-rd-badge"))

    def test_progress_page_explains_the_reading_column(self):
        text = BeautifulSoup(gen.progress_page(self.version), "html.parser").get_text()
        self.assertIn("「重點閱讀」欄記錄各章重點整理讀了幾次", text)
        self.assertIn("讀過約 75% 算讀完一次", text)
        self.assertIn("同樣只存在這台裝置", text)


class ProgressSortMarkupTests(unittest.TestCase):
    """2026-11-03, as on the dermatology exam section: /exam/progress can order the
    chapters of each book table; exam.js shows the bar, enables the select (only when
    storage works) and remembers the choice. Behaviour: tests/seo/exam-progress-sort.spec.js."""

    @classmethod
    def setUpClass(cls):
        cls.doc = BeautifulSoup(gen.progress_page(gen.site_version()), "html.parser")

    def test_sort_select_offers_the_four_orders_and_starts_hidden_and_disabled(self):
        bar = self.doc.select_one(".ex-prog-bar")
        self.assertTrue(bar.has_attr("hidden"), "without JavaScript there is nothing to sort")
        select = bar.select_one("select.ex-progress-sort")
        self.assertTrue(select.has_attr("disabled"))
        self.assertEqual(select["aria-label"], "章節排序")
        self.assertEqual(select["aria-controls"], "ex-progress")
        self.assertEqual([(o["value"], o.get_text()) for o in select.select("option")],
                         [("order", "章節順序"), ("todo", "尚未作答優先"),
                          ("low", "正確率低優先"), ("reading", "閱讀進度低優先")])
        self.assertIn(".ex-prog-bar[hidden]{display:none}", gen.EXAM_STYLE, ".ex-toolbar is display:flex")

    def test_storage_notice_and_bar_come_before_the_tables(self):
        note = self.doc.select_one(".ex-prog-store")
        self.assertTrue(note.has_attr("hidden"))
        self.assertEqual(note["role"], "status")
        self.assertEqual(note.get_text(), "", "exam.js writes the message only when storage fails")
        html = str(self.doc.select_one("main"))
        self.assertLess(html.index("ex-prog-store"), html.index("ex-prog-bar"))
        self.assertLess(html.index("ex-prog-bar"), html.index('id="ex-progress"'))


class StyleTests(unittest.TestCase):
    def test_reading_styles_exist_in_both_themes(self):
        css = gen.EXAM_STYLE
        for rule in (".ex-reading{", ".ex-reading[hidden]{display:none}", ".ex-rd-badge{", ".ex-rd-bar{",
                     ".ex-rd-fill{", ".ex-toast{position:fixed"):
            self.assertIn(rule, css)
        for rule in ('[data-theme="dark"] .ex-rd-badge{', '[data-theme="dark"] .ex-rd-fill{'):
            self.assertIn(rule, css)


if __name__ == "__main__":
    unittest.main()
