"""Owner decisions 2026-11-04: dermatology-site ports, group 3 (data validation and pages).

1. data/exam/chapter_zh.json: Taiwan official Chinese chapter names. The first is shown
   with the English title (h1 .ex-h1-zh, <title>, description, breadcrumb, share card, hub
   chapter list); every name is a search name (header Cmd+K nav-search.json, hub search).
   Chapters without an entry keep the English-only form.
2. data/exam/links.json: 「圖片與延伸閱讀」 on chapter pages, EyeWiki / EyeRounds / Moran
   CORE only, after the notes and before 本章考點; nothing when a chapter has no links.
3. doubts.json time machine fields (changed, impact): validated here, rendered by exam.js
   (tests/seo/exam-time-machine.spec.js). Examples live only in tests/fixtures.
4. data/exam/concept_kaofa.json: a public one-line 考法 per question in each concept's
   details, with no answers, option letters or traps.
Page dates and share cards: test_exam_dates_og.py.
"""
import copy
import functools
import json
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

import _gen_exam as gen

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "exam-time-machine.json"


@functools.cache
def shared() -> tuple[dict, str]:
    return gen.load(), gen.site_version()


def chapter_doc(key: str, data: dict | None = None) -> BeautifulSoup:
    base, version = shared()
    return BeautifulSoup(gen.chapter_page(data or base, key, version), "html.parser")


def with_data(**changes) -> dict:
    data = dict(shared()[0], **changes)
    data["concept_rows"] = gen.concept_rows(data)
    return data


class ChapterNameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.version = shared()
        cls.key = next(iter(cls.data["zh"]))
        cls.zh = cls.data["zh"][cls.key][0]
        cls.ch = cls.data["chapters"][cls.key]

    def test_committed_names_are_valid(self):
        self.assertTrue(self.data["zh"], "the placeholder chapter_zh.json covers a few chapters")
        raw = json.loads((ROOT / "data" / "exam" / "chapter_zh.json").read_text(encoding="utf-8"))
        self.assertEqual(gen.load_chapter_zh(raw, self.data["chapters"]), self.data["zh"])

    def test_validation(self):
        chapters = self.data["chapters"]
        for bad in ({"99-1": ["青光眼"]}, {"10-7": []}, {"10-7": "青光眼"}, {"10-7": [" 青光眼"]},
                    {"10-7": ["Glaucoma"]}, {"10-7": ["青光眼", "青光眼"]}, {"10-7": ["视网膜"]}, []):
            with self.subTest(bad=bad), self.assertRaises(SystemExit):
                gen.load_chapter_zh(bad, chapters)

    def test_chapter_page_shows_the_name(self):
        doc = chapter_doc(self.key)
        h1 = doc.select_one("h1.ex-h1")
        self.assertEqual(h1.select_one(".ex-h1-zh").get_text(), self.zh)
        self.assertTrue(h1.get_text().startswith(f"Ch.{self.ch['ch']} {self.ch['title']}"))
        title = doc.title.get_text()
        self.assertTrue(title.startswith(f"BCSC {self.ch['book']} Ch.{self.ch['ch']} {self.zh} "), title)
        self.assertLessEqual(len(gen.esc(title)), gen.TITLE_MAX)
        desc = doc.select_one('meta[name="description"]')["content"]
        self.assertIn(f"{self.zh}（", desc)
        self.assertLessEqual(len(gen.esc(desc)), gen.DESC_MAX)
        for prop in ("og:title", "og:description"):
            self.assertIn(self.zh, doc.select_one(f'meta[property="{prop}"]')["content"])
        crumbs = json.loads(doc.find_all("script", type="application/ld+json")[1].string)
        last = f"BCSC {self.ch['book']} Ch.{self.ch['ch']} {self.zh}"
        self.assertEqual(crumbs["itemListElement"][-1]["name"], last)
        self.assertEqual(doc.select(".ex-crumbs span")[-1].get_text(), last)

    def test_every_named_chapter_title_fits(self):
        for key in self.data["zh"]:
            with self.subTest(key=key):
                title = chapter_doc(key).title.get_text()
                self.assertIn(self.data["zh"][key][0], title)
                self.assertLessEqual(len(gen.esc(title)), gen.TITLE_MAX)

    def test_long_names_keep_the_chinese_and_shorten_the_english(self):
        self.assertEqual(gen.titled_name("", "Glaucoma", 30), "Glaucoma")
        self.assertEqual(gen.titled_name("青光眼", "Glaucoma", 30), "青光眼 Glaucoma")
        got = gen.titled_name("原發性隅角開放性青光眼", "Primary Open-Angle Glaucoma", 30)
        self.assertTrue(got.startswith("原發性隅角開放性青光眼 Primary"), got)
        self.assertLessEqual(len(got), 30)
        self.assertEqual(gen.titled_name("十二個字的中文章節名稱長", "Something Long", 18), "十二個字的中文章節名稱長")

    def test_without_an_entry_the_english_form_stays(self):
        data = with_data(zh={k: v for k, v in self.data["zh"].items() if k != self.key})
        doc = chapter_doc(self.key, data)
        self.assertIsNone(doc.select_one(".ex-h1-zh"))
        self.assertEqual(doc.select_one("h1.ex-h1").get_text(), f"Ch.{self.ch['ch']} {self.ch['title']}")
        self.assertNotIn(self.zh, doc.title.get_text())
        self.assertEqual(gen.OG_CARDS[gen.slug(self.key)]["title"], self.ch["title"])
        self.assertEqual(gen.OG_CARDS[gen.slug(self.key)]["subtitle"], "")
        chapter_doc(self.key)  # restore the shared card text

    def test_hub_list_shows_the_name_muted_after_the_english(self):
        hub = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        link = hub.select_one(f'li[id="ch-{self.key}"] a')
        self.assertEqual(link.select_one(".ex-ch-zh").get_text(), self.zh)
        self.assertTrue(link.get_text().startswith(f"Ch.{self.ch['ch']} {self.ch['title']}"))
        self.assertIn(".ex-ch-zh{", gen.EXAM_STYLE)
        others = [li for li in hub.select("li[data-ch]") if li["data-ch"] not in self.data["zh"]]
        self.assertFalse(any(li.select(".ex-ch-zh") for li in others))

    def test_search_indexes_use_every_name(self):
        public = gen.notes_data(self.data)
        entry = next(e for e in public["find"]["entries"] if e[0] == self.key and e[1] == "")
        for name in self.data["zh"][self.key]:
            self.assertIn(name, entry[3][:entry[5]], "a primary hub search name")
        self.assertEqual(public["chapters"][self.key]["zh"], self.zh)
        nav = {row[0]: row for row in gen.nav_search(self.data, public["find"])}
        self.assertEqual(nav[self.key][4][:len(self.data["zh"][self.key])], self.data["zh"][self.key])
        committed = json.loads((ROOT / "exam" / "nav-search.json").read_text(encoding="utf-8"))
        self.assertIn(self.zh, {r[0]: r[4] for r in committed}[self.key])


class LinkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = shared()[0]
        cls.key = next(iter(cls.data["links"]))

    def test_validation(self):
        chapters = self.data["chapters"]
        ok = {"site": "eyewiki", "label": "Glaucoma", "url": "https://eyewiki.org/Glaucoma"}
        self.assertEqual(gen.load_links({"_verified": "2026-11-04", "10-7": [ok]}, chapters), {"10-7": [ok]})
        www = dict(ok, url="https://www.eyewiki.org/G")
        self.assertEqual(gen.load_links({"_verified": "2026-11-04", "10-7": [www]}, chapters), {"10-7": [www]})
        self.assertEqual(gen.load_links({"_verified": "2026-11-04", "10-7": []}, chapters), {"10-7": []})
        bad_links = [
            dict(ok, site="dermnet"), dict(ok, url="http://eyewiki.org/Glaucoma"),
            dict(ok, url="https://eyewiki.org.evil.com/x"), dict(ok, url="https://evil.com/eyewiki.org"),
            dict(ok, site="moran"), dict(ok, url="https://eyewiki.org:8443/x"),
            dict(ok, url="https://user@eyewiki.org/x"), dict(ok, url="https://eyewiki.org/a b"),
            dict(ok, label=""), dict(ok, label=" Glaucoma"), dict(ok, label="青光眼"), dict(ok, label="1234"),
            {"site": "eyewiki", "url": ok["url"]}, dict(ok, extra=1),
        ]
        for bad in bad_links:
            with self.subTest(bad=bad), self.assertRaises(SystemExit):
                gen.load_links({"_verified": "2026-11-04", "10-7": [bad]}, chapters)
        for raw in ({"10-7": [ok]}, {"_verified": "2026-13-01"}, {"_verified": "2026-11-04", "99-9": [ok]},
                    {"_verified": "2026-11-04", "10-7": [ok, ok]}, {"_verified": "2026-11-04", "10-7": ok}):
            with self.subTest(raw=raw), self.assertRaises(SystemExit):
                gen.load_links(raw, chapters)

    def test_section_between_notes_and_concepts(self):
        doc = chapter_doc(self.key)
        section = doc.select_one("section.ex-links")
        self.assertEqual(section.h2.get_text(), "圖片與延伸閱讀")
        self.assertEqual(section.select_one(".ex-meta").get_text(),
                         "課本圖片有版權，請到以下網站看臨床與病理照片（外部網站，另開新分頁）。")
        main = str(doc.select_one("main"))
        markers = ['class="ex-note"', 'id="links-h"', 'id="qs-h"']
        if 'id="cpts-h"' in main:
            markers.insert(2, 'id="cpts-h"')
        at = [main.index(m) for m in markers]
        self.assertEqual(at, sorted(at))
        self.assertEqual(doc.select_one('.ex-toc a[href="#links-h"]').get_text(), "圖片與延伸閱讀")
        self.assertIsNotNone(doc.select_one('.ex-toc-side li.ex-toc-links a[href="#links-h"]'))

    def test_links_open_outside_and_are_grouped_by_site(self):
        doc = chapter_doc(self.key)
        items = self.data["links"][self.key]
        anchors = doc.select("section.ex-links a")
        self.assertEqual(len(anchors), len(items))
        for a in anchors:
            self.assertEqual(a["target"], "_blank")
            self.assertEqual(set(a["rel"]), {"noopener", "noreferrer"})
        names = {site: name for site, (_, name) in gen.LINK_SITES.items()}
        self.assertEqual(set(names.values()), {"EyeWiki（美國眼科醫學會）", "EyeRounds（愛荷華大學）", "Moran CORE（猶他大學）"})
        groups = doc.select("section.ex-links .ex-links-group")
        self.assertEqual([g["data-site"] for g in groups],
                         [s for s in gen.LINK_SITES if any(i["site"] == s for i in items)])
        for g in groups:
            self.assertEqual(g.select_one(".ex-links-name").get_text(), names[g["data-site"]])
            self.assertEqual([a["href"] for a in g.select("a")], [i["url"] for i in items if i["site"] == g["data-site"]])

    def test_no_links_no_section(self):
        other = next(k for k in self.data["notes"] if k not in self.data["links"])
        doc = chapter_doc(other)
        self.assertIsNone(doc.select_one(".ex-links, #links-h, a[href='#links-h']"))
        self.assertEqual(gen.links_html([]), "")
        doc = chapter_doc(self.key, with_data(links={self.key: []}))
        self.assertIsNone(doc.select_one(".ex-links"))

    def test_links_also_render_on_a_chapter_without_notes(self):
        data = with_data(notes={k: v for k, v in self.data["notes"].items() if k != self.key})
        self.assertIsNotNone(chapter_doc(self.key, data).select_one("section.ex-links"))
        chapter_doc(self.key)  # restore the shared card text


class TimeMachineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.fixture = {k: v for k, v in raw.items() if k != "_note"}
        cls.data = shared()[0]

    def test_real_data_carries_no_examples_yet(self):
        # Real entries must be sourced; the examples live only in tests/fixtures.
        self.assertFalse(any("changed" in d or "impact" in d for d in self.data["doubts"].values()))

    def test_fixture_entries_are_valid_and_reach_the_bank(self):
        data = copy.deepcopy(self.data)
        for n, extra in self.fixture.items():
            data["doubts"][n].update(extra)
            gen.check_time_machine(n, data["doubts"][n])
        bank = {q["n"]: q for q in gen.bank_data(data)["questions"]}
        for n, extra in self.fixture.items():
            for field, value in extra.items():
                self.assertEqual(bank[int(n)]["doubt"][field], value)
        self.assertNotIn("changed", bank[5]["doubt"])

    def test_validation(self):
        base = {"cat": "outdated", "exam": "x", "now": "現行觀念", "refs": [{"t": "t", "u": "https://x.org"}]}
        gen.check_time_machine("1", dict(base))
        gen.check_time_machine("1", dict(base, changed="2017 年起", impact={"level": "不影響", "note": "說明"}))
        for bad in (dict(base, now="", changed="2017 年起"),
                    {"cat": "typo", "exam": "x", "impact": {"level": "不影響", "note": "n"}},
                    dict(base, changed=""), dict(base, changed=" 2017"), dict(base, changed=3),
                    dict(base, impact={"level": "不影響"}), dict(base, impact={"level": "會影響", "note": "n"}),
                    dict(base, impact={"level": "不影響", "note": " "}),
                    dict(base, impact={"level": "不影響", "note": "n", "x": 1}), dict(base, changed="这个")):
            with self.subTest(bad=bad), self.assertRaises(SystemExit):
                gen.check_time_machine("1", bad)
        self.assertEqual(gen.TM_LEVELS, ("不影響", "依現行觀念答案會不同"))

    def test_exam_js_renders_the_rows_inside_the_doubt_box(self):
        js = (ROOT / "exam" / "exam.js").read_text(encoding="utf-8")
        self.assertIn("var TM_DIFF = '" + gen.TM_LEVELS[1] + "';", js)
        self.assertIn("var tm = timeMachine(q.doubt);", js)
        for rule in (".ex-tm-rows{", ".ex-tm-same{", ".ex-tm-diff{", ':root[data-theme="dark"] .ex-tm-diff{'):
            self.assertIn(rule, gen.EXAM_STYLE)


class KaofaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.version = shared()

    def test_validation(self):
        concepts = [{"id": "c1-001", "title": "t", "qs": [1, 82]}]
        self.assertEqual(gen.load_kaofa({"c1-001": {"82": "考 HIV 的病毒學分期"}}, concepts),
                         {"c1-001": {82: "考 HIV 的病毒學分期"}})
        for line in ("考 HIV 感染哪種細胞（答案是 CD4）", "正解是 helper T", "選 B", "(B) 為錯", "（C）", "A、C 正確",
                     "B 正確", "考 A/B 何者", "本題答案為 A", "官方答案", "問梅毒的表現（題目邏輯有歧義）",
                     "答案有爭議", "Only English", " 考前後空白", "考" * 61,
                     "兩行\n文字", "考视网膜", 3):
            with self.subTest(line=line), self.assertRaises(SystemExit):
                gen.load_kaofa({"c1-001": {"1": line}}, concepts)
        # Letters that are part of names are fine: vitamin A, HLA-B27.
        gen.load_kaofa({"c1-001": {"1": "考維生素 A 缺乏與 HLA-B27 相關疾病"}}, concepts)
        # 選 on its own describes a choice, not an option: 首選藥物, 術式選擇.
        gen.load_kaofa({"c1-001": {"1": "問 GCA 的首選治療與術式選擇"}}, concepts)
        for line in ("選項 C 有誤", "選C"):
            with self.subTest(line=line), self.assertRaises(SystemExit):
                gen.load_kaofa({"c1-001": {"1": line}}, concepts)
        for raw in ({"c9-999": {"1": "考法"}}, {"c1-001": {"3": "考法"}}, {"c1-001": {"01": "考法"}},
                    {"c1-001": {}}, []):
            with self.subTest(raw=raw), self.assertRaises(SystemExit):
                gen.load_kaofa(raw, concepts)

    def test_both_concept_views_show_the_lines(self):
        cid, lines = next(iter(self.data["kaofa"].items()))
        row = next(r for r in self.data["concept_rows"] if r["id"] == cid)
        concepts = BeautifulSoup(gen.concepts_page(self.data, self.version), "html.parser")
        home = chapter_doc(row["home"])
        for doc, sel in ((concepts, f'details[id="{cid}"]'), (home, f'details[id="cpt-{cid}"]')):
            with self.subTest(sel=sel):
                box = doc.select_one(f"{sel} .ex-cpt-how")
                self.assertEqual(box.select_one(".ex-cpt-k").get_text(), "考法")
                items = box.select(".ex-kaofa li")
                labels = [li.select_one(".ex-kaofa-q").get_text() for li in items]
                self.assertEqual(labels, [f"Q{n}" for n in row["qs"] if n in lines])
                self.assertEqual([li.get_text()[len(q):] for li, q in zip(items, labels)],
                                 [gen.fullwidth(lines[n])[0] for n in row["qs"] if n in lines])
                self.assertFalse(box.select("a"), "question labels are plain text")
                # The 題號 line still lists every question once.
                self.assertEqual(len(doc.select(f"{sel} .ex-qno")), len(row["qs"]))

    def test_concepts_without_lines_have_no_block(self):
        # Every concept has lines since 2026-11-04, so drop one concept's lines.
        row = self.data["concept_rows"][0]
        data = {**self.data, "kaofa": {k: v for k, v in self.data["kaofa"].items() if k != row["id"]}}
        self.assertNotIn("ex-cpt-how", gen.concept_html(row, data))


if __name__ == "__main__":
    unittest.main()
