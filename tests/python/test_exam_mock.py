"""Owner order 2026-11-10: a public, login-free mock exam of self-written questions.

- The paper (data/exam/mock/pilot1.json) is rendered into a public page, /exam/mock, so
  the loader checks every field and refuses anything but the public fields.
- The bank stays behind the login: no mock stem or option may repeat or closely follow a
  bank stem or option.
- The page is complete as served (answers and explanations are in the markup); the
  stylesheet keeps them closed until the paper is handed in.
- Pilot: the page is public but not indexed, and stays out of the sitemap routes.
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
        cls.paper = cls.data["mock"]
        cls.rows = cls.paper["questions"]

    def test_pilot_paper_shape(self):
        self.assertEqual(self.paper["id"], "pilot1")
        self.assertEqual([q["id"] for q in self.rows], [f"p1-{n:02d}" for n in range(1, 51)])
        books = Counter(self.data["chapters"][q["ch"]]["book"] for q in self.rows)
        self.assertEqual(sorted(books), list(range(1, 14)), "every BCSC section is represented")
        answers = Counter(q["answer"] for q in self.rows)
        for key in gen.MOCK_KEYS:
            self.assertTrue(0.15 * len(self.rows) <= answers[key] <= 0.35 * len(self.rows), answers)

    def load_edited(self, edit):
        paper = copy.deepcopy(self.paper)
        edit(paper)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.json"
            path.write_text(json.dumps(paper, ensure_ascii=False), encoding="utf-8")
            with patch.object(gen, "MOCK_PAPER", path):
                return gen.load_mock(self.data["chapters"], self.data["questions"])

    def test_loader_accepts_the_paper_and_rejects_bad_fields(self):
        self.assertEqual(self.load_edited(lambda paper: None), self.paper)
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
        for q in self.rows:
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
        cls.rows = cls.data["mock"]["questions"]
        cls.html = gen.mock_page(cls.data, cls.version)
        cls.doc = BeautifulSoup(cls.html, "html.parser")

    def test_public_page_without_login_or_index(self):
        self.assertEqual(self.doc.select_one('meta[name="robots"]')["content"], "noindex,follow")
        self.assertNotIn("/exam/mock", gen.indexed_routes(self.data))
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

    def test_page_is_built_and_linked_from_the_hub(self):
        built = (ROOT / "exam" / "mock.html").read_text(encoding="utf-8")
        self.assertEqual(built.count('class="ex-mq"'), len(self.rows))
        self.assertIn('data-mock-paper="pilot1"', built)
        hub = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        link = hub.select_one('p.ex-practice a[href="/exam/mock"]')
        self.assertEqual(link.get_text(), f"模擬考：自編 {len(self.rows)} 題（免登入）")
        # the past papers keep their own name and the login note is unchanged
        self.assertEqual(hub.select_one('a[href="/exam/practice"]').get_text(), "考古卷：自選範圍／隨機出題")
        self.assertIn("考題、答案與詳解需要登入才能看", hub.get_text())


if __name__ == "__main__":
    unittest.main()
