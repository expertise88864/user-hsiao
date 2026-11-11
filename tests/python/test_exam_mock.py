"""Owner orders 2026-11-10 and 2026-11-11: a public, login-free mock exam of self-written
questions; 200 questions, kept as four files of 50.

- The questions (data/exam/mock/pilot1.json, paper2.json to paper4.json) are rendered into
  a public page, /exam/mock, so the loader checks every field and refuses anything but the
  public fields.
- Ids and stems are unique across the files, and together the files follow the bank's
  share of each BCSC section.
- The bank stays behind the login: no mock stem or option may repeat or closely follow a
  bank stem or option.
- Owner order 2026-11-11 (second): one page where the reader picks the number of questions
  and the order, as on the past-paper page. All the cards are in a pool the stylesheet
  hides; exam.js moves the cards drawn into the paper. The addresses of the fixed papers
  this replaced (/exam/mock-2 to /exam/mock-4) redirect to /exam/mock.
- The page is complete as served (answers and explanations are in the markup); the
  stylesheet keeps them closed until the paper is handed in, and shows the whole pool
  where there is no scripting.
- The page is indexed and in the sitemap routes (owner, 2026-11-10, after reading the pilot).
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
        # the bank: every question with the id of the fixed paper it was published in
        cls.rows = [(paper["id"], q) for paper in cls.papers for q in paper["questions"]]
        cls.html = gen.mock_page(cls.data, cls.version)
        cls.doc = BeautifulSoup(cls.html, "html.parser")

    def test_public_indexed_page_without_login(self):
        self.assertEqual(self.doc.select_one('meta[name="robots"]')["content"], "index,follow,max-image-preview:large")
        self.assertIn("/exam/mock", gen.indexed_routes(self.data))
        self.assertEqual(self.doc.select_one('link[rel="canonical"]')["href"], gen.DOMAIN + "/exam/mock")
        self.assertEqual(self.doc.body["data-exam-page"], "mock")
        self.assertEqual(self.doc.select_one("h1").get_text(), "自選題數／隨機出題")
        self.assertIn(f"自編 {len(self.rows)} 題", self.doc.title.get_text())
        self.assertNotIn("試行版", self.html)
        # nothing on the page waits for the session or the bank
        self.assertFalse(self.doc.select(".ex-auth"))
        self.assertFalse(self.doc.select("article.ex-q"))
        self.assertFalse(self.doc.select("[data-practice-form]"))
        self.assertIn("自編", self.doc.select_one(".ex-lead").get_text())
        self.assertIn(f"題庫共 {len(self.rows)} 題", self.doc.select_one(".ex-lead").get_text())
        self.assertIn("不是歷屆考題", self.doc.select_one("main").get_text())

    def test_every_question_is_a_complete_card_in_the_pool(self):
        cards = self.doc.select("[data-mock-pool] > .ex-mq")
        self.assertEqual(len(cards), len(self.rows))
        self.assertEqual(len(self.doc.select(".ex-mq")), len(cards), "no card outside the pool")
        self.assertEqual(len({card["id"] for card in cards}), len(cards))
        self.assertIn(f"（{len(cards)} 題）", self.doc.select_one(".ex-mock-pool > h2").get_text())
        for no, (card, (paper, q)) in enumerate(zip(cards, self.rows), 1):
            with self.subTest(q=q["id"]):
                # the question id, not a place: a paper shows the cards in its own order
                self.assertEqual(card["id"], f'mq-{q["id"]}')
                self.assertEqual(card["data-mq"], q["id"])
                self.assertEqual(card["data-paper"], paper)
                self.assertEqual(card["data-answer"], q["answer"])
                self.assertEqual(card["data-book"], str(self.data["chapters"][q["ch"]]["book"]))
                self.assertEqual(card.select_one(".ex-q-no").get_text(), f"第 {no} 題")
                radios = card.select('fieldset.ex-opts input[type="radio"]')
                self.assertEqual([r["value"] for r in radios], gen.MOCK_KEYS)
                self.assertEqual({r["name"] for r in radios}, {f'mq-{q["id"]}'})
                self.assertFalse(any(r.has_attr("checked") or r.has_attr("disabled") for r in radios))
                self.assertEqual(card.select_one("fieldset.ex-opts > legend.ex-sr").get_text(), f"第 {no} 題的選項")
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

    def test_the_reader_picks_the_number_of_questions_and_the_order(self):
        form = self.doc.select_one("form[data-mock-form]")
        options = form.select('select[name="ex-count"] > option')
        self.assertEqual([o["value"] for o in options], ["10", "25", "50", "100", "0"])
        self.assertEqual([o.get_text() for o in options], ["10 題", "25 題", "50 題", "100 題", f"全部（{len(self.rows)} 題）"])
        self.assertEqual([o["value"] for o in options if o.has_attr("selected")], ["50"])
        self.assertTrue(form.select_one('select[name="ex-count"]')["aria-label"])
        radios = form.select('input[type="radio"][name="ex-order"]')
        self.assertEqual([r["value"] for r in radios], ["random", "number"])
        self.assertEqual([r["value"] for r in radios if r.has_attr("checked")], ["random"])
        self.assertEqual([lab.get_text().strip() for lab in form.select("label.ex-check")], ["隨機", "依序（從題庫第 1 題起）"])
        # a plain button: without the script the form does nothing and goes nowhere
        button = form.select_one("button.ex-build")
        self.assertEqual(button["type"], "button")
        self.assertEqual(button.get_text(), "產生試卷並開始計時")
        self.assertFalse(form.has_attr("action"))
        self.assertEqual(form.select_one(".ex-build-note")["aria-live"], "polite")
        # the paper is empty until one is drawn
        paper = self.doc.select_one("[data-mock-list]")
        self.assertFalse(paper.select(".ex-mq"))
        self.assertIn("產生試卷並開始計時", paper.select_one("p.ex-pending").get_text())

    def test_sizes_larger_than_the_bank_are_not_offered(self):
        data = dict(self.data)
        first = self.papers[0]
        data["mock"] = [{**first, "questions": first["questions"][:30]}]
        doc = BeautifulSoup(gen.mock_page(data, self.version), "html.parser")
        options = doc.select('select[name="ex-count"] > option')
        self.assertEqual([o["value"] for o in options], ["10", "25", "0"])
        self.assertEqual(options[-1].get_text(), "全部（30 題）")
        self.assertEqual(len(doc.select("[data-mock-pool] > .ex-mq")), 30)

    def test_explanations_stay_closed_until_the_paper_is_handed_in(self):
        css = gen.EXAM_STYLE
        self.assertIn(".ex-mq-exp{display:none", css)
        self.assertIn(".ex-mq.ex-done .ex-mq-exp{display:block}", css)
        # the pool is shown only where no paper can be drawn from it
        self.assertIn(".ex-mock-nojs,.ex-mock-pool{display:none}", css)
        self.assertNotIn(".ex-mock-papers", css)
        # without scripting: the whole pool with its explanations; nothing that needs the script
        rule = re.search(r"@media \(scripting:none\)\{(.*?\})\}", css)
        self.assertIsNotNone(rule)
        self.assertIn(".ex-mq-exp,.ex-mock-nojs,.ex-mock-pool{display:block}", rule.group(1))
        self.assertIn(".ex-mock-bar,.ex-mock-how,.ex-mock-form,.ex-mock-list{display:none}", rule.group(1))

    def test_bar_and_result_start_hidden_and_empty(self):
        bar = self.doc.select_one("[data-mock-bar]")
        self.assertTrue(bar.has_attr("hidden"))
        self.assertEqual(bar.select_one(".ex-timer").get_text(), "00:00")
        self.assertEqual(bar.select_one(".ex-mock-count").get_text(), "")
        self.assertTrue(bar.select_one("button.ex-mock-finish").has_attr("disabled"))
        self.assertEqual(bar.select_one("button.ex-mock-reset").get_text(), "放棄這份試卷")
        result = self.doc.select_one("section[data-mock-result]")
        self.assertTrue(result.has_attr("hidden"))
        self.assertEqual(result["aria-labelledby"], result.h2["id"])
        # one row for every book of the bank; the script fills in the paper's counts
        rows = result.select("tbody tr[data-book]")
        books = {self.data["chapters"][q["ch"]]["book"] for _, q in self.rows}
        self.assertEqual([int(r["data-book"]) for r in rows], sorted(books))
        self.assertTrue(all(r.select_one("td[data-total]").get_text() == "" for r in rows))
        self.assertTrue(all(r.select_one("td[data-right]").get_text() == "" for r in rows))

    def test_one_page_replaces_the_fixed_papers(self):
        built = (ROOT / "exam" / "mock.html").read_text(encoding="utf-8")
        self.assertEqual(built.count('class="ex-mq"'), len(self.rows))
        self.assertIn("data-mock-list", built)
        self.assertNotIn("data-mock-paper", built)
        routes = gen.indexed_routes(self.data)
        self.assertEqual([r for r in routes if r.startswith("/exam/mock")], ["/exam/mock"])
        self.assertFalse(hasattr(gen, "mock_path"))
        # the fixed papers' addresses (published 2026-11-11) lead to the page that replaced them
        redirects = {r["source"]: r for r in json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))["redirects"]}
        for no in (2, 3, 4):
            with self.subTest(paper=no):
                self.assertFalse((ROOT / "exam" / f"mock-{no}.html").exists())
                moved = redirects[f"/exam/mock-{no}"]
                self.assertEqual(moved["destination"], "/exam/mock")
                self.assertIs(moved["permanent"], True)
        for name in ("sitemap.xml", "api/_exam_routes.js"):
            with self.subTest(file=name):
                listed = (ROOT / name).read_text(encoding="utf-8")
                self.assertIn("/exam/mock", listed)
                self.assertNotIn("/exam/mock-", listed)

    def test_page_is_linked_from_the_hub(self):
        hub = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        link = hub.select_one('p.ex-practice a[href="/exam/mock"]')
        self.assertEqual(link.get_text(), f"模擬考：自編 {len(self.rows)} 題（免登入）")
        self.assertEqual(len(self.rows), 200)
        # the past papers keep their own name and the login note is unchanged
        self.assertEqual(hub.select_one('a[href="/exam/practice"]').get_text(), "考古卷：自選範圍／隨機出題")
        self.assertIn("考題、答案與詳解需要登入才能看", hub.get_text())


if __name__ == "__main__":
    unittest.main()
