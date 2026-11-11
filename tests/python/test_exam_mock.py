"""Owner orders 2026-11-10 and 2026-11-11: a public, login-free mock exam of self-written
questions; 200 questions as four papers of 50.

- The papers (data/exam/mock/pilot1.json, paper2.json to paper4.json) are rendered into
  public pages, /exam/mock and /exam/mock-2 to /exam/mock-4, so the loader checks every
  field and refuses anything but the public fields.
- Paper 1 keeps the id and the address it was published with; ids and stems are unique
  across the papers, and together the papers follow the bank's share of each BCSC section.
- The bank stays behind the login: no mock stem or option may repeat or closely follow a
  bank stem or option.
- The page is complete as served (answers and explanations are in the markup); the
  stylesheet keeps them closed until the paper is handed in.
- The pages are indexed and in the sitemap routes (owner, 2026-11-10, after reading the pilot).
"""
import copy
import json
import re
import tempfile
import unittest
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from unittest.mock import patch

from bs4 import BeautifulSoup

import _gen_exam as gen

ROOT = Path(__file__).resolve().parents[2]


def bigrams(text: str) -> set[str]:
    return {text[i:i + 2] for i in range(len(text) - 1)}


class MockPaperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.papers = cls.data["mock"]
        cls.paper = cls.papers[0]
        cls.rows = cls.paper["questions"]
        cls.all_rows = [q for paper in cls.papers for q in paper["questions"]]

    def test_four_papers_of_fifty(self):
        # paper 1 keeps the id it was published with: a saved attempt is stored under it
        self.assertEqual([paper["id"] for paper in self.papers], ["pilot1", "paper2", "paper3", "paper4"])
        self.assertEqual([paper["title"] for paper in self.papers], [f"模擬考第 {no} 回" for no in range(1, 5)])
        for no, paper in enumerate(self.papers, 1):
            rows = paper["questions"]
            with self.subTest(paper=no):
                self.assertEqual([q["id"] for q in rows], [f"p{no}-{n:02d}" for n in range(1, 51)])
                books = Counter(self.data["chapters"][q["ch"]]["book"] for q in rows)
                self.assertEqual(sorted(books), list(range(1, 14)), "every BCSC section is represented")
                answers = Counter(q["answer"] for q in rows)
                for key in gen.MOCK_KEYS:
                    self.assertTrue(0.15 * len(rows) <= answers[key] <= 0.35 * len(rows), answers)
        self.assertEqual(gen.mock_total(self.data), 200)
        stems = [gen.mock_norm(q["stem"]) for q in self.all_rows]
        self.assertEqual(len(set(stems)), len(stems), "no stem is used twice")

    def test_the_papers_together_follow_the_bank_by_section(self):
        """Each BCSC section has, within two questions, the share of the 200 questions that
        it has of the bank (a bank question counted under its first chapter)."""
        tags = json.loads((ROOT / "data" / "exam" / "tags.json").read_text(encoding="utf-8"))
        chapters = self.data["chapters"]
        bank = Counter(chapters[tag["ch"][0]]["book"] for tag in tags.values())
        mock = Counter(chapters[q["ch"]]["book"] for q in self.all_rows)
        for book, n in sorted(bank.items()):
            want = len(self.all_rows) * n / sum(bank.values())
            self.assertLess(abs(mock[book] - want), 2, f"BCSC {book}: {mock[book]} questions, bank share {want:.1f}")

    def load_edited(self, edit, no=1):
        """The papers as loaded with paper `no` edited."""
        paper = copy.deepcopy(self.papers[no - 1])
        edit(paper)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.json"
            path.write_text(json.dumps(paper, ensure_ascii=False), encoding="utf-8")
            files = list(gen.MOCK_FILES)
            files[no - 1] = path
            with patch.object(gen, "MOCK_FILES", files):
                return gen.load_mock(self.data["chapters"], self.data["questions"])

    def test_papers_do_not_share_ids_stems_or_names(self):
        first = self.rows[0]
        cases = {
            "paper id of another paper": lambda p: p.update(id="pilot1"),
            "title of another paper": lambda p: p.update(title="模擬考第 1 回"),
            "question id of another paper": lambda p: p["questions"][0].update(id=first["id"]),
            "stem of another paper": lambda p: p["questions"][0].update(stem=first["stem"]),
        }
        for name, edit in cases.items():
            with self.subTest(case=name), self.assertRaises(SystemExit):
                self.load_edited(edit, no=2)

    def test_loader_accepts_the_paper_and_rejects_bad_fields(self):
        self.assertEqual(self.load_edited(lambda paper: None), self.papers)
        bank = next(q for q in self.data["questions"]
                    if all(len(gen.mock_norm(v)) >= gen.MOCK_MIN for v in (q["stem"], q["options"]["A"])))

        def q0(paper):
            return paper["questions"][0]

        def item(paper, key):
            return next(it for it in q0(paper)["items"] if it["key"] == key)

        def reorder(paper):
            q0(paper)["options"] = dict(reversed(list(q0(paper)["options"].items())))

        answer = self.rows[0]["answer"]
        other = next(k for k in gen.MOCK_KEYS if k != answer)
        cases = {
            "top-level field": lambda p: p.update(note="x"),
            "paper id": lambda p: p.update(id="Pilot 1"),
            "title": lambda p: p.update(title="模擬考第 1 回（試行版）"),
            "no questions": lambda p: p.update(questions=[]),
            "writer field": lambda p: q0(p).update(evidence={"A": "quote"}),
            "missing summary": lambda p: q0(p).pop("summary"),
            "repeated id": lambda p: q0(p).update(id=p["questions"][1]["id"]),
            "id form": lambda p: q0(p).update(id="p1-1"),
            "unknown chapter": lambda p: q0(p).update(ch="14-1"),
            "options order": reorder,
            "five options": lambda p: q0(p)["options"].update(E="以上皆非的另一個選項"),
            "repeated option": lambda p: q0(p)["options"].update(B=q0(p)["options"]["A"]),
            "repeated stem": lambda p: q0(p).update(stem=p["questions"][1]["stem"]),
            "bank stem": lambda p: q0(p).update(stem=bank["stem"]),
            # the comparison ignores case, spacing and punctuation
            "bank option": lambda p: q0(p)["options"].update(A=bank["options"]["A"].upper() + "。"),
            "two answers": lambda p: item(p, other).update(answer=True),
            "answer field disagrees": lambda p: q0(p).update(answer=other),
            "answer flag type": lambda p: item(p, answer).update(answer=1),
            "same label four times": lambda p: [it.update(label="正確") for it in q0(p)["items"]],
            "label wording": lambda p: item(p, answer).update(label="對"),
            "item field": lambda p: item(p, "A").update(seed=1),
            "no reference": lambda p: item(p, "A").update(refs=[]),
            "unknown book": lambda p: item(p, "A").update(refs=[[14, "20"]]),
            "book as text": lambda p: item(p, "A").update(refs=[["1", "20"]]),
            "page form": lambda p: item(p, "A").update(refs=[[1, "20-21"]]),
            "empty text": lambda p: item(p, "A").update(text=""),
            "double space": lambda p: q0(p).update(summary="兩個  空格"),
            "line break": lambda p: q0(p).update(stem=q0(p)["stem"] + "\n"),
            "watch-list character": lambda p: q0(p).update(summary="角膜污染"),
            "accented letter": lambda p: q0(p).update(summary="Behçet disease 的敘述"),
        }
        for name, edit in cases.items():
            with self.subTest(case=name), self.assertRaises(SystemExit):
                self.load_edited(edit)

    def test_simplified_characters_are_rejected(self):
        simplified = next(iter(sorted(gen.SIMPLIFIED)))
        with self.assertRaises(SystemExit):
            self.load_edited(lambda p: p["questions"][0].update(summary=f"含有簡體字{simplified}的摘要"))

    def test_no_option_closely_follows_the_bank(self):
        """Exact repeats are refused by the loader; this also refuses an option that is a
        bank stem or option with a few characters changed (the nearest pair in the pilot
        scores about 0.8). Stems are left to the exact check: one like
        「下列關於 X 的敘述，何者正確？」 differs from a bank stem only by its subject."""
        bank = sorted({gen.mock_norm(text) for q in self.data["questions"]
                       for text in (q["stem"], *q["options"].values())} - {""})
        bank = [text for text in bank if len(text) >= gen.MOCK_MIN]
        index = defaultdict(set)
        for i, text in enumerate(bank):
            for gram in bigrams(text):
                index[gram].add(i)
        for q in self.all_rows:
            for name, raw in q["options"].items():
                mine = gen.mock_norm(raw)
                if len(mine) < gen.MOCK_MIN:
                    continue
                grams = bigrams(mine)
                shared = Counter(i for gram in grams for i in index.get(gram, ()))
                for i, n in shared.items():
                    if n < 0.6 * len(grams):
                        continue
                    ratio = SequenceMatcher(None, mine, bank[i], autojunk=False).ratio()
                    self.assertLess(ratio, 0.9, f"{q['id']} option {name} follows a bank sentence: {raw}")


class MockPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()
        cls.papers = cls.data["mock"]
        cls.rows = cls.papers[0]["questions"]
        cls.html = gen.mock_page(cls.data, cls.version)
        cls.doc = BeautifulSoup(cls.html, "html.parser")

    def test_public_indexed_page_without_login(self):
        self.assertEqual(self.doc.select_one('meta[name="robots"]')["content"], "index,follow,max-image-preview:large")
        self.assertIn("/exam/mock", gen.indexed_routes(self.data))
        self.assertEqual(self.doc.select_one('link[rel="canonical"]')["href"], gen.DOMAIN + "/exam/mock")
        self.assertEqual(self.doc.body["data-exam-page"], "mock")
        # nothing on the page waits for the session or the bank
        self.assertFalse(self.doc.select(".ex-auth"))
        self.assertFalse(self.doc.select("article.ex-q"))
        self.assertFalse(self.doc.select("[data-practice-form]"))
        self.assertIn("自編", self.doc.select_one(".ex-lead").get_text())
        self.assertIn("不是歷屆考題", self.doc.select_one("main").get_text())

    def test_every_question_is_a_complete_card(self):
        cards = self.doc.select("[data-mock-paper] > .ex-mq")
        self.assertEqual(self.doc.select_one("[data-mock-paper]")["data-mock-paper"], "pilot1")
        self.assertEqual(len(cards), len(self.rows))
        for no, (card, q) in enumerate(zip(cards, self.rows), 1):
            with self.subTest(q=q["id"]):
                self.assertEqual(card["id"], f"mq-{no}")
                self.assertEqual(card["data-mq"], q["id"])
                self.assertEqual(card["data-answer"], q["answer"])
                self.assertEqual(card["data-book"], str(self.data["chapters"][q["ch"]]["book"]))
                radios = card.select('fieldset.ex-opts input[type="radio"]')
                self.assertEqual([r["value"] for r in radios], gen.MOCK_KEYS)
                self.assertEqual({r["name"] for r in radios}, {f"mq-{no}"})
                self.assertFalse(any(r.has_attr("checked") or r.has_attr("disabled") for r in radios))
                self.assertTrue(card.select_one("fieldset.ex-opts > legend.ex-sr"))
                self.assertEqual(card.select_one(".ex-mq-result").get_text(), "")
                exp = card.select_one("details.ex-mq-exp")
                self.assertFalse(exp.has_attr("open"))
                self.assertEqual(exp.select_one(".ex-answer strong").get_text(), q["answer"])
                right = exp.select("li.ex-ok")
                self.assertEqual(len(right), 1)
                self.assertEqual(right[0].select_one(".ex-item-key").get_text(), q["answer"])
                self.assertEqual(len(exp.select("li.ex-no")), 3)
                self.assertTrue(all(li.select(".ex-ref") for li in exp.select("ul.ex-items > li")))
                # the chapter is named only inside the explanation
                self.assertEqual(len(card.select('a[href^="/exam/bcsc"]')), len(exp.select('a[href^="/exam/bcsc"]')))

    def test_explanations_stay_closed_until_the_paper_is_handed_in(self):
        css = gen.EXAM_STYLE
        self.assertIn(".ex-mq-exp{display:none", css)
        self.assertIn(".ex-mq.ex-done .ex-mq-exp{display:block}", css)
        # without scripting there is no hand-in: explanations open, the bar is hidden
        rule = re.search(r"@media \(scripting:none\)\{(.*?\})\}", css)
        self.assertIsNotNone(rule)
        self.assertIn(".ex-mq-exp,.ex-mock-nojs{display:block}", rule.group(1))
        self.assertIn(".ex-mock-bar,.ex-mock-how{display:none}", rule.group(1))

    def test_bar_and_result_start_empty(self):
        bar = self.doc.select_one("[data-mock-bar]")
        self.assertEqual(bar.select_one(".ex-mock-count").get_text(), f"已作答 0 / {len(self.rows)}")
        self.assertTrue(bar.select_one("button.ex-mock-finish").has_attr("disabled"))
        self.assertTrue(bar.select_one("button.ex-mock-reset").has_attr("hidden"))
        result = self.doc.select_one("section[data-mock-result]")
        self.assertTrue(result.has_attr("hidden"))
        self.assertEqual(result["aria-labelledby"], result.h2["id"])
        per_book = Counter(self.data["chapters"][q["ch"]]["book"] for q in self.rows)
        rows = result.select("tbody tr[data-book]")
        self.assertEqual({int(r["data-book"]): int(r.select_one(".ex-num").get_text()) for r in rows}, dict(per_book))
        self.assertTrue(all(r.select_one("td[data-right]").get_text() == "" for r in rows))

    def test_every_paper_has_its_own_indexed_page(self):
        paths = ["/exam/mock", "/exam/mock-2", "/exam/mock-3", "/exam/mock-4"]
        self.assertEqual([gen.mock_path(no) for no in range(1, len(self.papers) + 1)], paths)
        routes = gen.indexed_routes(self.data)
        titles = set()
        for no, (paper, path) in enumerate(zip(self.papers, paths), 1):
            with self.subTest(paper=no):
                html = gen.mock_page(self.data, self.version, no)
                doc = BeautifulSoup(html, "html.parser")
                self.assertIn(path, routes)
                self.assertEqual(doc.select_one('link[rel="canonical"]')["href"], gen.DOMAIN + path)
                self.assertEqual(doc.select_one('meta[name="robots"]')["content"], "index,follow,max-image-preview:large")
                self.assertEqual(doc.select_one("h1").get_text(), f"模擬考第 {no} 回")
                self.assertIn(f"第 {no} 回", doc.title.get_text())
                titles.add(doc.title.get_text())
                self.assertIn("共 4 回、200 題", doc.select_one("main").get_text())
                self.assertNotIn("試行版", html)
                self.assertEqual(doc.select_one("[data-mock-paper]")["data-mock-paper"], paper["id"])
                cards = doc.select("[data-mock-paper] > .ex-mq")
                self.assertEqual([card["data-mq"] for card in cards], [q["id"] for q in paper["questions"]])
                # the same row of links above and below the questions; this paper is marked
                navs = doc.select("nav.ex-mock-papers")
                self.assertEqual([nav["aria-label"] for nav in navs], ["模擬考各回", "換一回作答"])
                for nav in navs:
                    self.assertEqual([a["href"] for a in nav.select("a")], paths)
                    self.assertEqual([a.get_text() for a in nav.select("a")], [f"第 {n} 回" for n in range(1, 5)])
                    self.assertEqual([a["href"] for a in nav.select('a[aria-current="page"]')], [path])
                name = "mock.html" if no == 1 else f"mock-{no}.html"
                built = (ROOT / "exam" / name).read_text(encoding="utf-8")
                self.assertEqual(built.count('class="ex-mq"'), len(paper["questions"]))
                self.assertIn(f'data-mock-paper="{paper["id"]}"', built)
        self.assertEqual(len(titles), len(self.papers), "every paper has its own page title")

    def test_page_is_built_and_linked_from_the_hub(self):
        built = (ROOT / "exam" / "mock.html").read_text(encoding="utf-8")
        self.assertEqual(built.count('class="ex-mq"'), len(self.rows))
        self.assertIn('data-mock-paper="pilot1"', built)
        hub = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        link = hub.select_one('p.ex-practice a[href="/exam/mock"]')
        self.assertEqual(link.get_text(), "模擬考：自編 200 題（免登入）")
        # the past papers keep their own name and the login note is unchanged
        self.assertEqual(hub.select_one('a[href="/exam/practice"]').get_text(), "考古卷：自選範圍／隨機出題")
        self.assertIn("考題、答案與詳解需要登入才能看", hub.get_text())


if __name__ == "__main__":
    unittest.main()
