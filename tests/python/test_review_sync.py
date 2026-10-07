"""Clinical and author-policy contracts across authored and generated surfaces."""
import json
from pathlib import Path
import sys
import unittest

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _gen_faqpage_jsonld import extract_faqs


def load(path):
    return (ROOT / path).read_text(encoding="utf-8")


class ReviewSynchronization(unittest.TestCase):
    def test_hzo_case_denominator_does_not_become_risk_or_treatment_advice(self):
        for path in ["blog/hzo-stromal-keratitis-zeds-lessons.html",
                     "en/blog/hzo-stromal-keratitis-zeds-lessons.html", "llms-full.txt"]:
            with self.subTest(path=path):
                source = load(path)
                self.assertNotRegex(source, r"前三個月最容易復發|risk highest in the first 3 months")
                self.assertNotRegex(source, r"其餘約九成單靠|roughly 90% were controlled by adjusting topical steroid alone")
                self.assertNotRegex(source, r"38% 在停類固醇 3 個月內復發|僅 10% 需介入口服")
                self.assertNotRegex(source, r"風險回降|Risk drops|Taper, don't quit|danger window|危險窗口")
                self.assertIn("11/105", source)
        soup = BeautifulSoup(load("blog/hzo-stromal-keratitis-zeds-lessons.html"), "html.parser")
        faqs = extract_faqs(str(soup))
        schema = json.loads(soup.select_one("script[data-faq-auto]").string)
        self.assertEqual([{"q": r["name"], "a": r["acceptedAnswer"]["text"]}
                          for r in schema["mainEntity"]], faqs)
        oral = next(r["a"] for r in faqs if "口服抗病毒" in r["q"])
        self.assertIn("11/105", oral)
        self.assertIn("不能推論", oral)
        description = soup.select_one('svg[aria-labelledby="hero-title"] desc')
        self.assertIsNotNone(description)
        self.assertIn("18", description.get_text())
        self.assertIn("48", description.get_text())
        self.assertIn("不是所有停藥者的復發率", description.get("data-zh", ""))
        self.assertIn("not the recurrence rate", description.get("data-en", ""))
        self.assertEqual(description.parent.get("aria-describedby"), description.get("id"))

    def test_sudden_floaters_alone_are_an_urgent_diagram_branch(self):
        for path in ["index.html", "en/index.html", "blog/blog-shared.js"]:
            with self.subTest(path=path):
                source = load(path)
                self.assertNotRegex(source, r"48\s*小時(?:內必須就醫|警訊)|Golden treatment window|黃金治療期")
        source = load("blog/floaters-retinal-detachment.html")
        soup = BeautifulSoup(source, "html.parser")
        diagram = soup.select_one("#floater-triage-title").parent
        text = diagram.get_text(" ", strip=True)
        self.assertIn("突然大量飛蚊", text)
        self.assertIn("任一", text)
        self.assertIn("當天", text)
        self.assertIn("慢性穩定", text)
        self.assertNotRegex(text, r"7\s*日內|24\s*小時內|是否合併警訊")
        for path in ["blog/floaters-retinal-detachment.html", "en/blog/floaters-retinal-detachment.html"]:
            article = BeautifulSoup(load(path), "html.parser")
            for anchor, same_day in [("self-check", "當天"), ("self-check-en", "same-day")]:
                with self.subTest(path=path, anchor=anchor):
                    paragraph = article.find(id=anchor).find_next_sibling("p").get_text(" ", strip=True)
                    self.assertIn(same_day, paragraph)
                    self.assertNotRegex(paragraph, r"當週就醫|that week")
        home = BeautifulSoup(load("index.html"), "html.parser")
        faq = json.loads(home.select_one("script[data-faq-auto]").string)
        self.assertEqual([{"q": r["name"], "a": r["acceptedAnswer"]["text"]}
                          for r in faq["mainEntity"]], extract_faqs(str(home)))

    def test_floaters_reference_journal_is_consistent_in_search_projections(self):
        for path in ["_gen_serp_meta.py", "blog/floaters-retinal-detachment.html",
                     "en/blog/floaters-retinal-detachment.html", "llms.txt", "llms-full.txt"]:
            with self.subTest(path=path):
                self.assertNotIn("Eye 2010", load(path))
        soup = BeautifulSoup(load("blog/floaters-retinal-detachment.html"), "html.parser")
        for selector in ['meta[name="description"]', 'meta[property="og:description"]',
                         'meta[name="twitter:description"]']:
            self.assertIn("Br J Ophthalmol 2010", soup.select_one(selector)["content"])

    def test_trauma_cost_summary_has_the_period_not_an_annual_cost(self):
        for path in ["blog/ophthalmic-trauma-overlooked-burden.html",
                     "en/blog/ophthalmic-trauma-overlooked-burden.html"]:
            with self.subTest(path=path):
                soup = BeautifulSoup(load(path), "html.parser")
                answer = soup.select(".myth-card .truth")[1].get_text(" ", strip=True)
                self.assertIn("2001–2014", answer)
                self.assertTrue("17.2" in answer or "1.72" in answer)
                self.assertTrue("不是單一年" in answer or "not an annual" in answer)

    def test_author_training_institutions_are_removed_but_school_and_referrals_remain(self):
        for path in ["about.html", "en/about.html"]:
            with self.subTest(path=path):
                source = load(path)
                self.assertNotRegex(source, r"彰化基督教醫院|台中榮民總醫院|Changhua Christian Hospital|Taichung Veterans General Hospital")
                self.assertIn("PGY", source)
                self.assertTrue("高雄醫學大學" in source or "Kaohsiung Medical University" in source)
        # D-08 permits general referral information; do not erase it as author affiliation.
        self.assertIn("台北榮總", load("blog/lacrimal-gland-tumor.html"))

    def test_error_page_does_not_advertise_the_custom_tool_as_osdi(self):
        soup = BeautifulSoup(load("404.html"), "html.parser")
        link = soup.select_one('a[href="/tools"]')
        self.assertNotIn("OSDI", str(link))
        self.assertIn("六題", link.get_text())


if __name__ == "__main__":
    unittest.main()
