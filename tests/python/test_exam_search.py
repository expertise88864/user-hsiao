"""Owner request 2026-11-03: search and layout details ported from the dermatology exam section.

- notes-data.json "find": ranked names per chapter page and note section, with a glossary
  built from the notes ("Full Name（ABBR）", "ABBR（…）", "English（中文）"), so an
  abbreviation finds sections that only spell the name out, and the reverse.
- exam/nav-search.json: chapters with notes and their h2 headings for the site header search.
- Each note table scrolls in its own .ex-table-wrap box instead of the whole note.
- Hub chapter list items carry ids so /exam#ch-<key> can open their closed BCSC part.
"""
import json
import re
import unittest
from collections import defaultdict

from bs4 import BeautifulSoup

import _gen_exam as gen


def entries_by_section(index):
    return {(e[0], e[1]): e for e in index["entries"]}


def primary(entry):
    return entry[3][:entry[5]], entry[4][:entry[6]]


class NameSplittingTests(unittest.TestCase):
    def test_heading_with_abbreviation_and_chinese(self):
        names, abbrs, pairs = gen.split_name("六、Multifocal choroiditis（MFC，多灶性脈絡膜炎），包括 PIC")
        self.assertEqual(names, ["Multifocal choroiditis", "多灶性脈絡膜炎"])
        self.assertEqual(abbrs, ["MFC", "PIC"])
        self.assertIn(("Multifocal choroiditis", "MFC"), pairs)
        self.assertIn(("Multifocal choroiditis", "多灶性脈絡膜炎"), pairs)

    def test_abbreviation_heading_and_lists(self):
        names, abbrs, pairs = gen.split_name("四、MEWDS（多發性一過性白點症候群）")
        self.assertEqual((names, abbrs), (["多發性一過性白點症候群"], ["MEWDS"]))
        self.assertEqual(pairs, [("MEWDS", "多發性一過性白點症候群")])
        self.assertEqual(gen.split_name("七、AZOOR、AMN、AIM")[1], ["AZOOR", "AMN", "AIM"])
        names = gen.split_name("九、Vogt-Koyanagi-Harada disease 與 Sympathetic ophthalmia")[0]
        self.assertEqual(names, ["Vogt-Koyanagi-Harada disease", "Sympathetic ophthalmia"])
        # ABBR（full name）
        self.assertIn(("primary vitreoretinal lymphoma", "PVRL"),
                      gen.split_name("PVRL（primary vitreoretinal lymphoma）")[2])

    def test_prose_defines_abbreviations_only(self):
        text = "常見於 primary vitreoretinal lymphoma（PVRL，原發性玻璃體視網膜淋巴瘤），需 vitreous biopsy（玻璃體切片）。"
        self.assertEqual(gen.prose_pairs(text), [("primary vitreoretinal lymphoma", "PVRL")])
        self.assertIsNone(gen.long_form("PVRL", "常見於 vitreous"))

    def test_block_tags_separate_words(self):
        self.assertEqual(gen.plain("<td>Lacrimal gland</td><td>Lens</td>"), "Lacrimal gland Lens")
        self.assertEqual(gen.plain("<i>S.</i> aureus{{q:12}}"), "S. aureus")


def fake_data():
    chapters = {
        "1-1": {"title": "Uveitis Masquerade", "book": 1, "ch": 1},
        "1-2": {"title": "Keratoconus", "book": 1, "ch": 2},
        "1-3": {"title": "Untouched Chapter", "book": 1, "ch": 3},
    }
    notes = {
        "1-1": ('<h2 id="a1">一、Intraocular lymphoma（眼內淋巴瘤）</h2>'
                '<ul><li><strong>Primary vitreoretinal lymphoma（PVRL，原發性玻璃體視網膜淋巴瘤）</strong>偽裝成葡萄膜炎。</li></ul>'
                '<h3>治療</h3>'
                '<h2 id="a2">二、PVRL 的診斷</h2><p>玻璃體切片。</p>'
                '<h2 id="a3">三、Primary vitreoretinal lymphoma 的治療</h2><p>放射治療。</p>'),
        "1-2": ('<h2 id="b1">一、圓錐角膜</h2><p>角膜變薄。</p><h3>治療</h3>'
                '<h2 id="b2">二、Keratoconus（圓錐角膜）臨床表現</h2><p>Munson sign。</p>'
                '<table class="ted-table"><tbody><tr><td>Fleischer ring（費氏環）</td><td>鐵沉積</td></tr></tbody></table>'),
        "1-3": '<h2 id="c1">一、Other</h2><p>治療</p><h3>治療</h3>',
    }
    by_chapter = defaultdict(list, {"1-3": [{"n": 1}]})
    return {"chapters": chapters, "notes": notes, "by_chapter": by_chapter}


class GlossaryIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = gen.search_index(fake_data())
        cls.by = entries_by_section(cls.index)

    def test_every_page_and_section_has_an_entry(self):
        self.assertEqual(set(self.by), {("1-1", ""), ("1-2", ""), ("1-3", ""), ("1-1", "a1"), ("1-1", "a2"),
                                        ("1-1", "a3"), ("1-2", "b1"), ("1-2", "b2"), ("1-3", "c1")})
        self.assertEqual(self.by[("1-1", "a1")][2], "Intraocular lymphoma（眼內淋巴瘤）")

    def test_heading_names_are_primary(self):
        names, abbrs = primary(self.by[("1-1", "a1")])
        self.assertIn("Intraocular lymphoma", names)
        self.assertIn("眼內淋巴瘤", names)
        entry = self.by[("1-1", "a1")]
        self.assertIn("Primary vitreoretinal lymphoma", entry[3][entry[5]:])  # found inside: not primary
        self.assertIn("PVRL", entry[4][entry[6]:])

    def test_abbreviation_finds_the_spelled_out_section_and_back(self):
        # 「三、Primary vitreoretinal lymphoma 的治療」 never writes PVRL ...
        self.assertIn("PVRL", primary(self.by[("1-1", "a3")])[1])
        # ... and 「二、PVRL 的診斷」 never spells it out.
        self.assertIn("Primary vitreoretinal lymphoma", primary(self.by[("1-1", "a2")])[0])

    def test_english_and_chinese_names_meet(self):
        # 「一、圓錐角膜」 gets the English name the notes give elsewhere, the English chapter
        # title its Chinese name.
        self.assertIn("Keratoconus", primary(self.by[("1-2", "b1")])[0])
        self.assertIn("圓錐角膜", primary(self.by[("1-2", "")])[0])
        self.assertIn("費氏環", self.by[("1-2", "b2")][3])  # table first cell, both languages
        self.assertIn("Fleischer ring", self.by[("1-2", "b2")][3])

    def test_generic_headings_are_not_names(self):
        # 「治療」 is an h3 in three chapters here: fine; real notes drop names used in 4+ chapters.
        real = gen.search_index(gen.load())
        self.assertFalse([e for e in real["entries"] if "易錯陷阱" in e[3]])
        self.assertFalse([e for e in real["entries"] if {"治療", "Treatment"} & set(e[3][e[5]:])])

    def test_chapter_title_is_one_name(self):
        self.assertEqual(primary(self.by[("1-3", "")]), (["Untouched Chapter"], []))


class RealIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.public = gen.notes_data(cls.data)
        cls.by = entries_by_section(cls.public["find"])

    def test_entries_point_at_real_sections(self):
        for (key, sid), e in self.by.items():
            self.assertTrue(self.data["by_chapter"].get(key) or key in self.data["notes"], key)
            self.assertEqual(len(e), 7)
            self.assertLessEqual(e[5], len(e[3]))
            self.assertLessEqual(e[6], len(e[4]))
            if sid:
                self.assertIn(sid, self.public["chapters"][key]["secs"], (key, sid))

    def test_known_abbreviations(self):
        names, abbrs = primary(self.by[("12-11", "ch11-s4")])
        self.assertIn("MEWDS", abbrs)
        self.assertTrue(any(n.lower() == "multiple evanescent white dot syndrome" for n in names), names)
        self.assertIn("多發性一過性白點症候群", names)
        # An English chapter title gets the Chinese name its notes give.
        self.assertIn("糖尿病視網膜病變", primary(self.by[("12-5", "")])[0])

    def test_public_files_carry_no_question_text(self):
        # Names come from the public notes only: no question stem (same 60-character rule as
        # build()'s fail-closed check) and no answer or explanation field.
        stems = [q["stem"].strip()[:60] for q in self.data["questions"] if len(q["stem"].strip()) >= 30]
        nav = gen.nav_search(self.data, self.public["find"])
        for name, value in (("find", self.public["find"]), ("nav-search", nav)):
            text = json.dumps(value, ensure_ascii=False)
            self.assertFalse([s for s in stems if s in text], name)
            self.assertNotRegex(text, r'"(stem|options|answer|expl)"', name)

    def test_nav_search_lists_chapters_with_notes_and_their_headings(self):
        nav = gen.nav_search(self.data, self.public["find"])
        self.assertEqual([row[0] for row in nav], [k for k in self.data["chapters"] if k in self.data["notes"]])
        row = next(r for r in nav if r[0] == "12-11")
        self.assertEqual(row[1], "BCSC 12 Ch.11")
        self.assertEqual(row[2], self.data["chapters"]["12-11"]["title"])
        self.assertEqual([h[0] for h in row[3]], list(self.public["chapters"]["12-11"]["secs"]))
        self.assertIn(["ch11-s4", "MEWDS（多發性一過性白點症候群）"], row[3])  # numbering dropped
        written = json.loads((gen.OUT / "nav-search.json").read_text(encoding="utf-8"))
        self.assertEqual(written, json.loads(json.dumps(nav, ensure_ascii=False)))


class LayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()

    def test_wrap_tables(self):
        out = gen.wrap_tables('<p>x</p><table class="ted-table"><tr><td>a</td></tr></table><p>y</p>')
        self.assertEqual(out, '<p>x</p><div class="ex-table-wrap"><table class="ted-table"><tr><td>a</td></tr>'
                              '</table></div><p>y</p>')

    def test_every_note_table_has_its_own_scroll_box(self):
        for key in ("12-11", "8-6"):
            doc = BeautifulSoup(gen.chapter_page(self.data, key, self.version), "html.parser")
            tables = doc.select(".ex-note table")
            self.assertTrue(tables, key)
            for table in tables:
                self.assertIn("ex-table-wrap", table.parent.get("class", []), key)
        css = gen.EXAM_STYLE
        self.assertNotIn(".ex-note{overflow-x:auto}", css)
        self.assertIn(".ex-table-wrap{overflow-x:auto", css)

    def test_hub_chapter_items_have_ids_for_hash_links(self):
        doc = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        item = doc.select_one("#ch-12-11")
        self.assertEqual(item.name, "li")
        self.assertEqual(item.find_parent("details")["class"], ["ex-part"])
        ids = [li["id"] for li in doc.select(".ex-chapter-list li[id]")]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == "__main__":
    unittest.main()
