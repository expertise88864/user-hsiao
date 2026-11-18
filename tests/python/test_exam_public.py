"""Owner order 2026-11-18: 「題庫公開」 and the exam year of each question.

- The question bank (questions, answers, explanations) is public: no login page, no login
  entry, no "需要登入" anywhere in the exam pages, and /exam/login redirects to /exam.
  The bank is still one JSON (api/_exam_bank.js via /api/exam/data) rendered by exam.js,
  so the page files stay light and carry no question text.
- 「若考古豹上面有該題目的年份 則把本站同樣題目表示年份及題號（包括考題區以及考試重點）」:
  data/exam/years.json maps a bank question to the papers by year it appeared in
  (113 年 123 題, 114 年 82 題 matched to the bank by comparing the text). The question
  card shows it (the bank row's "yr") and so does every {{q:N}} label in the notes.
"""
import json
import re
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

import _gen_exam as gen

ROOT = Path(__file__).resolve().parents[2]


class PublicBankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.version = gen.site_version()

    def test_no_login_page_or_entry(self):
        self.assertFalse((ROOT / "exam" / "login.html").exists())
        self.assertFalse(hasattr(gen, "login_page"))
        self.assertFalse(hasattr(gen, "AUTH_BAR"))
        redirects = {r["source"]: r for r in json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))["redirects"]}
        self.assertEqual(redirects["/exam/login"]["destination"], "/exam")
        self.assertIs(redirects["/exam/login"]["permanent"], True)
        for path in sorted((ROOT / "exam").glob("*.html")):
            with self.subTest(page=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertNotIn("/exam/login", text)
                self.assertNotIn("需要登入", text)
                self.assertNotIn('class="ex-auth"', text)
        for name in ("_exam_login.js", "_exam_logout.js", "_exam_session.js"):
            self.assertFalse((ROOT / "api" / name).exists(), name)

    def test_chapter_page_loads_the_questions_without_login(self):
        key = next(k for k in self.data["chapters"] if self.data["by_chapter"].get(k))
        doc = BeautifulSoup(gen.chapter_page(self.data, key, self.version), "html.parser")
        box = doc.select_one("#ex-chapter-qs")
        self.assertIsNotNone(box)
        self.assertEqual(box.select_one("p.ex-loading").get_text(),
                         f'本章考題 {len(self.data["by_chapter"][key])} 題載入中⋯（需要開啟 JavaScript）')
        self.assertFalse(box.select("a"))
        hub = BeautifulSoup(gen.hub_page(self.data, self.version), "html.parser")
        self.assertIn("考題、答案與詳解都公開，不用登入", hub.get_text())

    def test_exam_js_no_longer_signs_in(self):
        js = (ROOT / "exam" / "exam.js").read_text(encoding="utf-8")
        for gone in ("/exam/login", "/api/exam/logout", "err.login", "initAuthBar", "data-exam-bank", "no-store"):
            self.assertNotIn(gone, js)
        self.assertIn("fetch('/api/exam/data' + (v ? '?v=' + v : ''), { credentials: 'omit' })", js)


class ExamYearTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.raw = json.loads((ROOT / "data" / "exam" / "years.json").read_text(encoding="utf-8"))

    def test_years_file(self):
        rows = [(n, y, no) for n, v in self.raw.items() for y, no in v]
        by_year = {y: sorted(no for _, yy, no in rows if yy == y) for y in {r[1] for r in rows}}
        self.assertEqual(sorted(by_year), [113, 114])
        # 113: every question of the 123-question paper is in the bank; 114: 82 of 200.
        self.assertEqual(by_year[113], list(range(1, 124)))
        self.assertEqual(len(by_year[114]), 82)
        self.assertEqual(len(set(by_year[114])), 82)
        self.assertTrue(all(1 <= no <= 200 for no in by_year[114]))
        # the bank's 113 block (至 113 年公佈版本, questions 1652-1774) is the 113 paper
        self.assertEqual(sorted(int(n) for n, y, _ in rows if y == 113), list(range(1652, 1775)))

    def test_loader_refuses_bad_rows(self):
        numbers = {"1", "2"}
        self.assertEqual(gen.load_years({"1": [[113, 3], [114, 9]]}, numbers), {"1": [[113, 3], [114, 9]]})
        for raw in ({"9": [[113, 1]]}, {"1": []}, {"1": [[13, 1]]}, {"1": [[113, 0]]}, {"1": [[113, "1"]]},
                    {"1": [[114, 2], [113, 1]]}, {"1": [[113, 1], [113, 1]]}, {"1": [[113, 1]], "2": [[113, 1]]}):
            with self.subTest(raw=raw), self.assertRaises(SystemExit):
                gen.load_years(raw, numbers)

    def test_bank_rows_carry_the_label(self):
        bank = gen.bank_data(self.data)["questions"]
        labelled = {str(q["n"]): q["yr"] for q in bank if "yr" in q}
        self.assertEqual(set(labelled), set(self.raw))
        self.assertEqual(labelled["1652"], "113 年第 1 題")
        both = next(n for n, v in self.raw.items() if len(v) == 2)
        self.assertEqual(labelled[both], "、".join(f"{y} 年第 {no} 題" for y, no in self.raw[both]))
        js = (ROOT / "exam" / "exam.js").read_text(encoding="utf-8")
        self.assertIn("if (q.yr) head.appendChild(el('span', 'ex-q-yr', q.yr));", js)

    def test_notes_labels_show_the_year(self):
        out = gen.expand_hits("<li>x{{q:1652,1}}</li>", "1-1", {1652, 1}, {"1652": [[113, 1]]})
        spans = BeautifulSoup(out, "html.parser").select("sup.ex-qref > span")
        self.assertEqual([s.get_text() for s in spans], ["Q1652（113 年第 1 題）", "Q1"])
        self.assertEqual(spans[0].select_one("small.ex-qyr").get_text(), "（113 年第 1 題）")
        # on the built pages: every cited question with a known year shows it
        cited = 0
        for path in sorted((ROOT / "exam").glob("bcsc*.html")):
            for n, label in re.findall(r'<span>Q(\d+)(?:<small class="ex-qyr">（([^）]*)）</small>)?</span>',
                                       path.read_text(encoding="utf-8")):
                if n in self.raw:
                    cited += 1
                    self.assertEqual(label, gen.year_label(self.raw[n]), (path.name, n))
                else:
                    self.assertEqual(label, "", (path.name, n))
        self.assertGreater(cited, 100)


if __name__ == "__main__":
    unittest.main()
