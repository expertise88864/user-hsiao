"""Owner request 2026-10-18: exam chapter notes styled like the dermatology exam section.

「考題標記像是我皮膚科考試專區 用類似上標的方式做標記 也把大綱弄成像是左邊懸浮緊跟使用者的方式
 易錯陷阱欄位也用顏色淡一點如皮膚科的樣子（易混淆的也可以弄淡一點）」

- {{q:N}} citations render as small superscript links (「Q1170」, accessible name
  「考題 Q1170」) right after the tested phrase; the <mark> they cite gets the soft
  highlighter (class ex-key), other <mark>s stay a plain key-point underline.
- Page refs are grey chips; refs to other BCSC sections get a second chip colour.
- Wide screens get a sticky 「本章目錄」 left column; phones keep the inline list.
- 易錯陷阱 / 易混淆比較與口訣 boxes are soft tints with a thin left border and a small pill label.
Plus two owner-approved deletions in the same change: privacy policy section
「8. 醫療免責」 and the 「Schiffman 2000」 chip on /tools.
"""
import re
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

import _gen_exam as gen

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class CitationMarkupTests(unittest.TestCase):
    def test_cited_mark_becomes_a_key_fact_and_others_stay_plain(self):
        out = gen.key_marks("<li><mark>A</mark> 與 <mark>B</mark>。{{q:1}}</li><li><mark>C</mark>。</li>")
        self.assertEqual(out, '<li><mark class="ex-key">A</mark> 與 <mark class="ex-key">B</mark>{{q:1}}。</li>'
                              "<li><mark>C</mark>。</li>")

    def test_citation_moves_onto_the_highlighted_phrase(self):
        self.assertEqual(gen.key_marks("<p>色素性<mark>鐵質線</mark>。{{q:960}}<span>p.1</span></p>"),
                         '<p>色素性<mark class="ex-key">鐵質線</mark>{{q:960}}。<span>p.1</span></p>')
        # Without a highlighted phrase the citation still goes before the full stop.
        self.assertEqual(gen.key_marks("<li>上皮增厚。{{q:922}}</li>"), "<li>上皮增厚{{q:922}}。</li>")

    def test_a_citation_covers_only_its_own_statement(self):
        out = gen.key_marks("<li><mark>A</mark>{{q:1}}；<mark>B</mark>{{q:2}}</li><li><mark>X</mark></li><li>{{q:3}}</li>")
        self.assertEqual(out.count('class="ex-key"'), 2)
        self.assertIn("<li><mark>X</mark></li>", out)

    def test_superscript_links_keep_the_login_gated_jump(self):
        out = gen.expand_hits("<li><mark>A</mark>{{q:922,359}}</li>", "8-6", {922, 359})
        doc = BeautifulSoup(out, "html.parser")
        sup = doc.select_one("sup.ex-qref")
        self.assertIsNotNone(sup)
        self.assertTrue(sup.previous_sibling.endswith("⁠"), "word joiner keeps the label on the phrase's line")
        links = sup.select("a")
        self.assertEqual([a.get_text() for a in links], ["Q922", "Q359"])
        self.assertEqual([a["aria-label"] for a in links], ["考題 Q922", "考題 Q359"])
        self.assertEqual(links[0]["href"], "/exam/login?next=/exam/bcsc8-6%23q-922")
        self.assertEqual(links[0]["data-q"], "922")
        self.assertNotIn("ex-hit", out)
        self.assertNotIn("考過", out)

    def test_other_section_refs_get_their_own_chip(self):
        out = gen.expand_hits('<li>x<span class="ref">p.1</span><span class="ref">BCSC 9 p.343</span></li>', "8-6", set())
        self.assertIn('<span class="ref">p.1</span>', out)
        self.assertIn('<span class="ref ref-ext">BCSC 9 p.343</span>', out)


class ChapterPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()

    def page(self, key):
        return BeautifulSoup(gen.chapter_page(self.data, key, self.version), "html.parser")

    def test_every_noted_chapter_has_superscripts_and_no_old_badges(self):
        for key in self.data["notes"]:
            doc = self.page(key)
            with self.subTest(key=key):
                self.assertFalse(doc.select(".ex-hit"))
                for a in doc.select(".ex-note sup.ex-qref a"):
                    self.assertRegex(a.get_text(), r"^Q\d+$")
                    self.assertEqual(a["aria-label"], "考題 " + a.get_text())
                    self.assertEqual(a["href"], gen.login_href(f"/exam/bcsc{key}#q-{a['data-q']}"))

    def test_sticky_outline_mirrors_the_inline_outline(self):
        key = "8-6"
        doc = self.page(key)
        main = doc.select_one("main#main-content")
        self.assertIn("ex-has-side", main["class"])
        side = main.find(True)
        self.assertEqual((side.name, side["class"], side["aria-label"]), ("nav", ["ex-toc-side"], "本章目錄"))
        self.assertEqual(side.select_one("details")["open"], "")
        self.assertEqual(side.summary.get_text(), "本章目錄")
        content = main.select_one(":scope > .ex-content")
        self.assertTrue(content.select_one(".ex-crumbs") and content.select_one("h1.ex-h1"))
        inline = [a["href"] for a in doc.select("nav.ex-toc a")]
        sticky = [a["href"] for a in side.select("a")]
        self.assertEqual(inline, sticky)
        self.assertEqual(sticky[-1], "#qs-h")
        for href in sticky:
            self.assertIsNotNone(doc.find(id=href[1:]), href)
        self.assertEqual(side.select_one(".ex-toc-qs").get_text(), f"考題（{len(self.data['by_chapter'][key])} 題）")

    def test_chapters_without_notes_keep_the_plain_layout(self):
        key = next(k for k in self.data["by_chapter"] if k not in self.data["notes"])
        doc = self.page(key)
        self.assertFalse(doc.select(".ex-toc-side, .ex-content"))
        self.assertNotIn("ex-has-side", doc.select_one("main")["class"])

    def test_legend_explains_the_markers(self):
        legend = self.page("8-6").select_one(".ex-notes .ex-legend")
        self.assertIn("考過的考點", legend.get_text())
        self.assertIn("易錯陷阱", legend.get_text())


class ExamStyleTests(unittest.TestCase):
    css = gen.EXAM_STYLE

    def test_sticky_outline_only_on_wide_screens(self):
        self.assertIn(".ex-toc-side{display:none}", self.css)
        wide = re.search(r"@media \(min-width:1100px\)\{(.*?)\}\n", self.css).group(1)
        self.assertIn("position:sticky", wide)
        self.assertIn("overflow:auto", wide)
        self.assertIn(".ex-has-side .ex-toc{display:none}", wide)

    def test_trap_and_tip_boxes_are_soft(self):
        self.assertIn(".ex-note .ex-trap{background:#fef5f5;border-left:3px solid #f87171", self.css)
        self.assertNotIn("⚠", self.css)
        self.assertRegex(self.css, r"\.ex-note \.hs-tip-box\{background:#f3f9f5;border-left:3px solid")
        self.assertNotRegex(self.css, r"\.ex-hit(?!box)")


class OwnerDeletionTests(unittest.TestCase):
    def test_privacy_policy_has_no_medical_disclaimer_section(self):
        for rel in ("privacy.html", "en/privacy.html"):
            html = read(rel)
            body = re.sub(r"<footer\b.*?</footer>", "", html.split("<body", 1)[1], flags=re.S)
            with self.subTest(page=rel):
                self.assertNotIn("醫療免責", body)
                self.assertNotIn("Medical disclaimer", body)
                numbers = [int(n) for n in re.findall(r'<h2 [^>]*\bdata-zh="(\d+)\. ', html)]
                self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        self.assertNotIn("醫療衛教內容與個人醫療建議的界線", read("privacy.html"))

    def test_tools_page_drops_the_schiffman_label_but_keeps_the_tool(self):
        for rel in ("tools.html", "en/tools.html"):
            html = read(rel)
            with self.subTest(page=rel):
                self.assertNotIn("Schiffman 2000", html)
                self.assertIn('data-calc="osdi"', html)
                self.assertIn('<span class="ref">DEWS II 2017</span>', html)


if __name__ == "__main__":
    unittest.main()
