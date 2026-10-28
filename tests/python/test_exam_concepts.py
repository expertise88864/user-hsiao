"""Owner decision 2026-10-28: 考點 (concept) pages, as on the dermatology exam section.

- Every chapter page with notes has a 「本章考點」 block after 課本重點整理 and before
  考題, listed in both outlines: the concepts whose questions are tagged to the chapter,
  home concepts first, then a collapsed 「本章考題也考到的其他章考點」 list.
- One /exam/concepts page (考點總覽) lists all concepts sorted by question count;
  exam.js adds search, chapter filter, sort and paging. No page per concept.
- Each concept shows its title, question count, question numbers as plain text (never
  links) and the chapters involved as chips. No question stems, options, answers or
  explanations in public HTML.
"""
import functools
import json
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

import _gen_exam as gen

ROOT = Path(__file__).resolve().parents[2]


@functools.cache
def shared() -> tuple[dict, str]:
    return gen.load(), gen.site_version()


@functools.cache
def chapter_html(key: str) -> str:
    data, version = shared()
    return gen.chapter_page(data, key, version)


class ConceptDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = shared()[0]
        cls.rows = cls.data["concept_rows"]

    def test_every_concept_once_sorted_by_count(self):
        self.assertEqual(sorted(r["id"] for r in self.rows), sorted(c["id"] for c in self.data["concepts"]))
        counts = [len(r["qs"]) for r in self.rows]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_chapters_and_home(self):
        tags = self.data["tags"]
        for r in self.rows:
            tagged = {k for n in r["qs"] for k in tags[str(n)]["ch"]}
            self.assertEqual(set(r["chapters"]), tagged, r["id"])
            self.assertIn(r["home"], r["chapters"])
            # The home chapter belongs to the concept's own BCSC section (c<book>-NNN).
            self.assertEqual(self.data["chapters"][r["home"]]["book"], int(r["id"][1:].split("-")[0]), r["id"])


class ConceptPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.version = shared()
        cls.html = gen.concepts_page(cls.data, cls.version)
        cls.doc = BeautifulSoup(cls.html, "html.parser")

    def test_lists_every_concept_by_count_without_js(self):
        items = self.doc.select("#ex-cpt-all > details.ex-cpt")
        self.assertEqual(len(items), len(self.data["concepts"]))
        self.assertEqual([d["id"] for d in items], [r["id"] for r in self.data["concept_rows"]])
        self.assertFalse(any(d.has_attr("hidden") for d in items), "without JavaScript the whole list shows")
        self.assertTrue(self.doc.select_one("form[data-concept-filter]").has_attr("hidden"))
        more = self.doc.select_one("[data-cpt-more]")
        self.assertTrue(more.has_attr("hidden"))
        self.assertEqual(more.button.get_text(), "載入更多")
        self.assertEqual(self.doc.select_one("#ex-cpt-all")["data-cpt-step"], "25")

    def test_concept_content(self):
        rows = {r["id"]: r for r in self.data["concept_rows"]}
        for d in self.doc.select("details.ex-cpt"):
            r = rows[d["id"]]
            self.assertEqual(d.select_one(".ex-cpt-t").get_text(), gen.fullwidth(r["title"])[0])
            self.assertEqual(d.select_one("summary .ex-count").get_text(), f"{len(r['qs'])} 題")
            self.assertEqual([q.get_text() for q in d.select(".ex-qno")], [f"Q{n}" for n in r["qs"]])
            # Question numbers are plain text: no links anywhere but the chapter chips.
            self.assertEqual([q.name for q in d.select(".ex-qno")], ["span"] * len(r["qs"]))
            self.assertEqual([a["href"] for a in d.select("a")], [f"/exam/bcsc{k}" for k in r["chapters"]])
            self.assertEqual(d["data-ch"].split(), r["chapters"])

    def test_chip_targets_exist(self):
        for a in self.doc.select("details.ex-cpt a.ex-chip"):
            self.assertTrue((ROOT / (a["href"].lstrip("/") + ".html")).exists(), a["href"])

    def test_filter_controls(self):
        form = self.doc.select_one("form[data-concept-filter]")
        for name, field in (("kw", "input"), ("ch", "select"), ("sort", "select")):
            node = form.select_one(f"{field}[name={name}]")
            self.assertEqual(form.select_one(f'label[for="{node["id"]}"]').name, "label")
        sorts = [o["value"] for o in form.select("select[name=sort] option")]
        self.assertEqual(sorts, ["count", "chapter"])
        chapters = [o["value"] for o in form.select("select[name=ch] option") if o["value"]]
        used = {k for r in self.data["concept_rows"] for k in r["chapters"]}
        self.assertEqual(set(chapters), used)
        self.assertEqual(chapters, [k for k in self.data["chapters"] if k in used])

    def test_head_and_indexing(self):
        self.assertEqual(self.doc.title.get_text(), "考點總覽" + gen.SITE_SUFFIX)
        self.assertEqual(self.doc.select_one('meta[name="robots"]')["content"], "noindex,follow")
        self.assertEqual(self.doc.select_one('link[rel="canonical"]')["href"], gen.DOMAIN + "/exam/concepts")
        self.assertNotIn("/exam/concepts", gen.indexed_routes(self.data))
        self.assertEqual(self.doc.select_one("body")["data-exam-page"], "concepts")

    def test_one_overview_page_and_no_page_per_concept(self):
        self.assertTrue((ROOT / "exam" / "concepts.html").exists())
        self.assertFalse(list((ROOT / "exam").glob("c[0-9]*")))
        self.assertIn("concepts_page(data, version)", (ROOT / "_gen_exam.py").read_text(encoding="utf-8"))

    def test_hub_links_the_overview_in_the_tools_row(self):
        hub = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        self.assertEqual(hub.select_one(".ex-tools a")["href"], "/exam/concepts")
        self.assertEqual(hub.select_one(".ex-tools a").get_text(), "考點總覽")


class ChapterBlockTests(unittest.TestCase):
    key = "8-6"

    @classmethod
    def setUpClass(cls):
        cls.data, cls.version = shared()

    def page(self, key):
        return BeautifulSoup(chapter_html(key), "html.parser")

    def test_every_notes_chapter_has_the_block_between_notes_and_questions(self):
        for key in self.data["notes"]:
            with self.subTest(key=key):
                main = str(self.page(key).select_one("main"))
                at = [main.index(m) for m in ('id="notes-h"', 'class="ex-note"', 'id="cpts-h"', 'id="qs-h"')]
                self.assertEqual(at, sorted(at))

    def test_chapters_without_notes_have_no_block(self):
        key = next(k for k in self.data["by_chapter"] if k not in self.data["notes"])
        self.assertFalse(self.page(key).select("#cpts-h, .ex-cpts"))

    def test_home_concepts_first_then_collapsed_others(self):
        for key in self.data["notes"]:
            with self.subTest(key=key):
                doc = self.page(key)
                section = doc.select_one("section.ex-cpts")
                home, other = gen.chapter_concepts(self.data, key)
                shown = [d["id"] for d in section.select(":scope > .ex-cpt-list > details.ex-cpt")]
                self.assertEqual(shown, ["cpt-" + r["id"] for r in home])
                more = section.select_one(":scope > details.ex-cpt-other")
                if other:
                    self.assertFalse(more.has_attr("open"))
                    self.assertTrue(more.summary.get_text().startswith("本章考題也考到的其他章考點"))
                    self.assertEqual([d["id"] for d in more.select("details.ex-cpt")], ["cpt-" + r["id"] for r in other])
                else:
                    self.assertIsNone(more)
                tagged = {c["id"] for c in self.data["concepts"]
                          if any(key in self.data["tags"][str(n)]["ch"] for n in c["qs"])}
                self.assertEqual({r["id"] for r in home + other}, tagged)
                for group in (home, other):
                    counts = [len(r["qs"]) for r in group]
                    self.assertEqual(counts, sorted(counts, reverse=True))
                # The current chapter's chip is not a link to itself.
                for d in section.select("details.ex-cpt"):
                    self.assertNotIn(f"/exam/bcsc{key}", [a["href"] for a in d.select("a")])
                    self.assertEqual(len(d.select(".ex-chip-on")), 1)
                    self.assertFalse(d.select(".ex-qno a, a.ex-qno"))

    def test_toc_entries(self):
        doc = self.page(self.key)
        n = sum(map(len, gen.chapter_concepts(self.data, self.key)))
        inline = [a["href"] for a in doc.select("nav.ex-toc a")]
        side = doc.select_one("nav.ex-toc-side")
        self.assertEqual(inline[-2:], ["#cpts-h", "#qs-h"])
        self.assertEqual([a["href"] for a in side.select("a")], inline)
        self.assertEqual(doc.select_one('nav.ex-toc a[href="#cpts-h"]').get_text(), "本章考點")
        self.assertEqual(side.select_one(".ex-toc-cpts").get_text(), f"本章考點（{n} 個）")
        self.assertEqual(side.select_one(".ex-toc-qs a")["href"], "#qs-h")


class NoQuestionTextLeakTests(unittest.TestCase):
    """Concept pages carry titles and numbers only: no stem, option or explanation text."""

    @classmethod
    def setUpClass(cls):
        cls.data, version = shared()
        overview = BeautifulSoup(gen.concepts_page(cls.data, version), "html.parser")
        cls.pages = {"concepts": str(overview.select_one("main"))}
        for key in cls.data["notes"]:
            doc = BeautifulSoup(chapter_html(key), "html.parser")
            cls.pages[key] = str(doc.select_one("section.ex-cpts"))

    def check(self, snippets, label):
        for name, content in self.pages.items():
            for text in snippets:
                self.assertNotIn(text, content, f"{label} leaked into {name}")

    def test_no_stems_or_options(self):
        stems = {gen.fullwidth(q["stem"].strip())[0][:40] for q in self.data["questions"] if len(q["stem"].strip()) >= 20}
        options = {gen.fullwidth(v.strip())[0] for q in self.data["questions"] for v in q["options"].values()
                   if len(v.strip()) >= 25}
        self.check(stems, "stem")
        self.check(options, "option")

    def test_no_answers_or_explanations(self):
        texts = set()
        for e in self.data["explanations"].values():
            if len(e["summary"]) >= 20:
                texts.add(gen.fullwidth(e["summary"])[0][:40])
            texts.update(gen.fullwidth(it["text"])[0][:40] for it in e["items"] if len(it["text"]) >= 25)
        self.check(texts, "explanation")
        for content in self.pages.values():
            self.assertNotIn("ex-q-no", content)
            self.assertNotIn("正確答案", content)
            self.assertNotIn('<article class="ex-q', content)

    def test_generated_file_matches(self):
        on_disk = (ROOT / "exam" / "concepts.html").read_text(encoding="utf-8")
        self.assertIn('id="ex-cpt-all"', on_disk)
        public = json.loads((ROOT / "exam" / "notes-data.json").read_text(encoding="utf-8"))
        self.assertNotIn("concepts", public)


if __name__ == "__main__":
    unittest.main()
