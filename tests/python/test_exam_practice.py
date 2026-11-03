"""Owner request 2026-11-03: the 考古卷 practice paper is kept until handed in or given up.

- The timer bar carries a 「放棄這份試卷」 button (hidden until a paper is on the page;
  exam.js shows it) next to 交卷, and the bar stays hidden until a paper exists: the
  inline style must not override its hidden attribute.
- The 已作答 x／y bar sits inside the sticky timer bar there, so it is not sticky itself.
"""
import unittest

from bs4 import BeautifulSoup

import _gen_exam as gen


class PracticePaperMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()
        cls.html = gen.practice_page(cls.data, cls.version)
        cls.doc = BeautifulSoup(cls.html, "html.parser")

    def test_bar_has_hidden_discard_button_after_hand_in(self):
        bar = self.doc.select_one("[data-exam-bar]")
        self.assertTrue(bar.has_attr("hidden"))
        buttons = bar.find_all("button")
        self.assertEqual([b.get_text() for b in buttons], ["交卷並計分", "放棄這份試卷"])
        discard = bar.select_one("button.ex-discard")
        self.assertEqual(discard.get("type"), "button")
        self.assertTrue(discard.has_attr("hidden"))

    def test_styles_keep_hidden_bar_hidden_and_nested_answer_bar_static(self):
        style = gen.EXAM_STYLE
        self.assertIn(".ex-exam-bar[hidden]{display:none}", style)
        self.assertIn(".ex-exam-bar .ex-ans-bar{position:static;", style)
        self.assertIn(".ex-exam-bar button:disabled{opacity:.5;", style)
        self.assertIn(gen.EXAM_STYLE, self.html)


if __name__ == "__main__":
    unittest.main()
