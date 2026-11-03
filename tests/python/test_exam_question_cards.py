"""Owner request 2026-11-03: question-card features ported from the dermatology exam section.

The signed-in bank (/api/exam/data) carries each flagged question's doubts.json "cat", so
exam.js can label the doubt box (舊版觀念／課本未提及／說法矛盾／選項模稜兩可／題目誤植),
and the inline exam style has the rules the new card features use.
The behaviour itself is covered by tests/seo/exam-question-cards.spec.js.
"""
import json
import re
import unittest
from pathlib import Path

import _gen_exam as gen

ROOT = Path(__file__).resolve().parents[2]


class DoubtCategoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = gen.load()
        cls.bank = gen.bank_data(cls.data)

    def test_every_doubt_in_the_bank_carries_its_category(self):
        flagged = [q for q in self.bank["questions"] if "doubt" in q]
        self.assertEqual(len(flagged), len(self.data["doubts"]))
        for q in flagged:
            with self.subTest(n=q["n"]):
                self.assertEqual(q["doubt"]["cat"], self.data["doubts"][str(q["n"])]["cat"])
                self.assertIn(q["doubt"]["cat"], gen.DOUBT_CAT_LABELS)

    def test_labels_cover_the_validated_categories_with_the_derm_wording(self):
        self.assertEqual(gen.DOUBT_CATS, set(gen.DOUBT_CAT_LABELS))
        self.assertEqual(set(gen.DOUBT_CAT_LABELS.values()),
                         {"舊版觀念", "課本未提及", "說法矛盾", "選項模稜兩可", "題目誤植"})

    def test_exam_js_uses_the_same_labels(self):
        js = (ROOT / "exam" / "exam.js").read_text(encoding="utf-8")
        block = re.search(r"var DOUBT_CATS = \{(.*?)\};", js, re.S).group(1)
        pairs = dict(re.findall(r"(\w+): '([^']+)'", block))
        self.assertEqual(pairs, gen.DOUBT_CAT_LABELS)

    def test_the_bank_module_carries_the_category(self):
        module = gen.bank_module(self.data)
        payload = json.loads(json.loads(module.split("EXAM_BANK_JSON = ", 1)[1].rstrip().rstrip(";")))
        self.assertTrue(any(q.get("doubt", {}).get("cat") == "outdated" for q in payload["questions"]))


class StyleTests(unittest.TestCase):
    def test_new_card_rules_have_light_and_dark_styles(self):
        css = gen.EXAM_STYLE
        for rule in ('.ex-doubt-h{', '.ex-ans-only[aria-pressed="true"]{', 'body.ex-quiz .ex-q.ex-hide',
                     ':root[data-theme="dark"] .ex-doubt-h{', ':root[data-theme="dark"] .ex-ans-only[aria-pressed="true"]{'):
            with self.subTest(rule=rule):
                self.assertIn(rule, css)


if __name__ == "__main__":
    unittest.main()
