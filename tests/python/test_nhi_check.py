"""tools/nhi_check.py and data/nhi/registry.json. Offline: every network call is faked."""
import csv
import importlib.util
import io
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest import mock
import urllib.error
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "nhi"
_spec = importlib.util.spec_from_file_location("nhi_check", ROOT / "tools" / "nhi_check.py")
nc = importlib.util.module_from_spec(_spec)
sys.modules["nhi_check"] = nc
_spec.loader.exec_module(nc)

TODAY = "2026-11-05"
SAMPLE = (FIXTURES / "rules_sample.txt").read_text(encoding="utf-8")
ATROPINE_START = "14.9.6.Atropine"
ATROPINE_END = "14.9.7.新生血管抑制劑"
PDF_URL = "https://example.test/rules.pdf"
_network_guard = None


def setUpModule():
    global _network_guard
    _network_guard = mock.patch.object(socket.socket, "connect", side_effect=AssertionError("network used in test"))
    _network_guard.start()


def tearDownModule():
    _network_guard.stop()


def baseline_for(text=SAMPLE):
    return nc.extract_section(nc.strip_page_furniture(text), ATROPINE_START, ATROPINE_END)


def pdf_entry(**source_overrides):
    baseline = baseline_for()
    source = {
        "title": "藥品給付規定",
        "url": PDF_URL,
        "retrieved": TODAY,
        "kind": "pdf_section",
        "start": ATROPINE_START,
        "end": ATROPINE_END,
        "document_version": "115.10.22",
    }
    source.update(source_overrides)
    return {
        "id": "atropine",
        "topic": "低濃度 Atropine",
        "rule_zh": "限用於18歲以下兒童及青少年",
        "effective": "2026-08-01",
        "version": "第 14.9.6 節",
        "source": source,
        "affects": {"articles": ["blog/pediatric-myopia-control.html"], "questions": [7], "related_questions": [9]},
        "fingerprint": nc.fingerprint(baseline),
        "baseline": baseline,
    }


def pdf_fetcher(url, method="GET", body=None):
    return b"%PDF-fake", {"content-type": "application/pdf"}


class CheckPdfEntry(unittest.TestCase):
    def check(self, document=SAMPLE, entry=None, fetcher=pdf_fetcher):
        with mock.patch.object(nc, "pdf_to_text", return_value=document):
            return nc.check_entry(entry or pdf_entry(), fetcher, TODAY)

    def test_same_text_is_unchanged(self):
        result = self.check()
        self.assertEqual(result["status"], nc.UNCHANGED)
        self.assertEqual(result["document_version"], "115.10.22")
        self.assertEqual(result["reason"], "")

    def test_layout_only_changes_stay_unchanged(self):
        reflowed = SAMPLE.replace("規格量≧ 3.5 mL 項目，", "規格量≧ 3.5 mL\n項目，").replace("（", "(")
        self.assertEqual(self.check(reflowed)["status"], nc.UNCHANGED)

    def test_new_document_version_with_same_text_is_unchanged_and_noted(self):
        result = self.check(SAMPLE.replace("115.10.22更新", "115.11.21更新"))
        self.assertEqual(result["status"], nc.UNCHANGED)
        self.assertIn("115.11.21", result["reason"])

    def test_changed_rule_text_reports_a_diff(self):
        result = self.check(SAMPLE.replace("18歲以下", "16歲以下"))
        self.assertEqual(result["status"], nc.CHANGED)
        joined = "\n".join(result["diff"])
        self.assertIn("-", joined)
        self.assertIn("16歲以下", joined)
        self.assertIn("18歲以下", joined)

    def test_removed_section_is_changed_not_unknown(self):
        removed = SAMPLE.replace("14.9.6.Atropine sulfate", "14.9.6.(刪除)")
        result = self.check(removed)
        self.assertEqual(result["status"], nc.CHANGED)
        self.assertIn("段落", result["reason"])

    def test_fetch_failure_is_unknown(self):
        def blocked(url, method="GET", body=None):
            raise nc.SourceUnavailable("HTTP 403")

        result = self.check(fetcher=blocked)
        self.assertEqual(result["status"], nc.UNKNOWN)
        self.assertIn("403", result["reason"])

    def test_html_instead_of_pdf_is_unknown(self):
        result = self.check(fetcher=lambda url, method="GET", body=None: (b"<html>wait</html>", {"content-type": "text/html"}))
        self.assertEqual(result["status"], nc.UNKNOWN)

    def test_document_without_text_layer_is_unknown(self):
        self.assertEqual(self.check(document="  ")["status"], nc.UNKNOWN)

    def test_missing_pypdf_is_unknown(self):
        nc.pdf_to_text.cache_clear()
        with mock.patch.dict(sys.modules, {"pypdf": None}):
            result = nc.check_entry(pdf_entry(), pdf_fetcher, TODAY)
        self.assertEqual(result["status"], nc.UNKNOWN)
        self.assertIn("pypdf", result["reason"])


class Normalization(unittest.TestCase):
    def test_width_spacing_and_bracket_variants_are_unified(self):
        self.assertEqual(nc.normalize("（如 Ａ）〔Ⅰ〕\n 5　mL"), nc.normalize("(如A)[I]5mL"))

    def test_page_header_and_number_are_removed(self):
        stripped = nc.strip_page_furniture(SAMPLE)
        self.assertNotIn("更新", stripped)
        self.assertNotIn("260", stripped)
        self.assertIn("3.5 mL", stripped)
        self.assertEqual(nc.document_version(SAMPLE), "115.10.22")

    def test_section_ends_at_its_end_marker(self):
        section = baseline_for()
        self.assertTrue(section.startswith("14.9.6.Atropine"))
        self.assertNotIn("14.9.7", section)

    def test_absence_summary_flips_when_a_term_appears(self):
        self.assertEqual(nc.absence_summary("no such drug", ["teprotumumab"]), "teprotumumab=absent")
        self.assertEqual(nc.absence_summary("TEPROTUMUMAB 500mg", ["teprotumumab"]), "teprotumumab=present")


class OtherSourceKinds(unittest.TestCase):
    def json_source(self, parser, label=None):
        query = {"body": {"q": 1}}
        if label:
            query["label"] = label
        return {"kind": "json_query", "url": "https://example.test/api", "parser": parser, "queries": [query]}

    def run_parser(self, parser, payload):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        return nc.extract(self.json_source(parser), lambda u, m="GET", b=None: (content, {}), TODAY)[0]

    def test_iol_medians_and_pay_price(self):
        rows = json.loads((FIXTURES / "iol_rows.json").read_text(encoding="utf-8"))
        medians = self.run_parser("iol_medians", rows)
        self.assertIn("非球面(含黃片))=30500", medians)
        self.assertIn("三焦點、非球面(含黃片))=85000", medians)
        self.assertEqual(self.run_parser("iol_pay_price", rows), "健保支付點數=2744")

    def test_empty_price_query_is_unavailable_not_a_rule_change(self):
        with self.assertRaises(nc.SourceUnavailable):
            self.run_parser("iol_medians", [])

    def test_malformed_query_rows_are_unavailable(self):
        with self.assertRaises(nc.SourceUnavailable):
            self.run_parser("iol_medians", [{"unexpected": 1}])

    def test_non_json_reply_is_unavailable(self):
        fetch = lambda u, m="GET", b=None: (b"<html>", {})
        with self.assertRaises(nc.SourceUnavailable):
            nc.extract(self.json_source("service_items"), fetch, TODAY)

    def test_drug_listing_uses_end_date_and_price(self):
        current = {"paY_E_DATE": "2910-12-31T00:00:00", "paY_PRICE": "270.00"}
        ended = {"paY_E_DATE": "2019-02-28T00:00:00", "paY_PRICE": "20.00"}
        unpriced = {"paY_E_DATE": "2910-12-31T00:00:00", "paY_PRICE": "0"}
        self.assertEqual(self.run_parser("drug_listing", {"data": [ended, current]}), "listed")
        self.assertEqual(self.run_parser("drug_listing", {"data": [ended, unpriced]}), "not-listed")
        self.assertEqual(self.run_parser("drug_listing", {"data": None}), "not-listed")

    def test_drug_listing_with_missing_or_bad_fields_is_unavailable(self):
        current = {"paY_E_DATE": "2910-12-31T00:00:00", "paY_PRICE": "270.00"}
        bad_rows = ({}, {"paY_PRICE": "270.00"}, {"paY_E_DATE": current["paY_E_DATE"]}, dict(current, paY_E_DATE="soon"), dict(current, paY_PRICE=""))
        for row in bad_rows:
            with self.assertRaises(nc.SourceUnavailable):
                self.run_parser("drug_listing", {"data": [current, row]})

    def test_service_item_fingerprint_ignores_price(self):
        row = {"treaT_CODE": "60007C", "curE_CNAME": "小樑雷射術", "paY_PRICE": 3900}
        repriced = dict(row, paY_PRICE=4100)
        self.assertEqual(self.run_parser("service_items", {"data": [row]}), self.run_parser("service_items", {"data": [repriced]}))

    def csv_bytes(self, rows):
        buffer = io.StringIO()
        csv.writer(buffer).writerows(rows)
        return buffer.getvalue().encode("big5hkscs")

    def test_csv_absent_flags_a_new_listing(self):
        filler = [["特材收錄品項表", "品項"]] + [["x" * 40, "品項"] for _ in range(10)]
        source = {"kind": "csv_absent", "url": "u", "encoding": "big5hkscs", "header_contains": "特材收錄品項表", "terms": [r"\bistent\b"]}
        before = nc.extract(source, lambda u, m="GET", b=None: (self.csv_bytes(filler), {}), TODAY)[0]
        after = nc.extract(source, lambda u, m="GET", b=None: (self.csv_bytes(filler + [["iStent inject W", "品項"]]), {}), TODAY)[0]
        self.assertEqual(before, r"\bistent\b=absent")
        self.assertEqual(after, r"\bistent\b=present")

    def test_csv_error_page_is_not_read_as_absence(self):
        source = {"kind": "csv_absent", "url": "u", "encoding": "big5hkscs", "header_contains": "特材收錄品項表", "terms": [r"\bistent\b"]}
        pages = (
            ("系統維護中，請稍後再試。" * 40).encode("big5hkscs"),
            ("<html><body>" + "maintenance, please retry\n" * 40 + "</body></html>").encode("big5hkscs"),
            self.csv_bytes([["特材收錄品項表" + "x" * 300]]),
        )
        for page in pages:
            with self.assertRaises(nc.SourceUnavailable):
                nc.extract(source, lambda u, m="GET", b=None, page=page: (page, {}), TODAY)

    def test_zip_csv_rows_filters_and_deduplicates(self):
        rows = [["證號", "品名"]] + [[f"A{i}", "other device" * 4] for i in range(10)]
        rows += [["B1", "iStent infinite"], ["B1", "iStent infinite"]]
        buffer = io.StringIO()
        csv.writer(buffer).writerows(rows)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as handle:
            handle.writestr("d.csv", buffer.getvalue().encode("utf-8-sig"))
        source = {
            "kind": "zip_csv_rows",
            "url": "u",
            "member": "d.csv",
            "encoding": "utf-8-sig",
            "header_contains": "證號",
            "contains": r"\bistent\b",
            "search_fields": [1],
            "fields": [0, 1],
        }
        result = nc.extract(source, lambda u, m="GET", b=None: (archive.getvalue(), {}), TODAY)[0]
        self.assertEqual(result, "B1|iStentinfinite")

    def test_bad_zip_is_unavailable(self):
        source = {"kind": "zip_csv_rows", "url": "u", "member": "d.csv", "encoding": "utf-8", "contains": "x", "search_fields": [0], "fields": [0]}
        with self.assertRaises(nc.SourceUnavailable):
            nc.extract(source, lambda u, m="GET", b=None: (b"not a zip", {}), TODAY)

    def test_html_section_is_compared_after_removing_tags_and_entities(self):
        page = "<html><head><title>x</title></head><body><td>起點</td><td>規定&nbsp;內容</td><td>終點</td>" + "填充" * 120 + "</body></html>"
        source = {"kind": "html_section", "url": "u", "start": "起點", "end": "終點"}
        result = nc.extract(source, lambda u, m="GET", b=None: (page.encode("utf-8"), {}), TODAY)[0]
        self.assertEqual(result, "起點規定內容")


class Fetching(unittest.TestCase):
    def test_cloudflare_challenge_is_unavailable(self):
        error = urllib.error.HTTPError("https://x.test", 403, "Forbidden", {"cf-mitigated": "challenge"}, io.BytesIO(b""))
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(nc.SourceUnavailable) as caught:
                nc.fetch_url("https://x.test")
        self.assertIn("Cloudflare", str(caught.exception))

    def test_connection_error_is_unavailable(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")):
            with self.assertRaises(nc.SourceUnavailable):
                nc.fetch_url("https://x.test")

    def test_tls_verification_stays_on(self):
        import ssl

        context = nc._tls_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_cached_fetcher_fetches_once_and_remembers_failures(self):
        calls = []

        def fetch(url, method="GET", body=None):
            calls.append(url)
            if url == "bad":
                raise nc.SourceUnavailable("HTTP 500")
            return b"ok", {}

        fetcher = nc.CachedFetcher(fetch)
        fetcher("good")
        fetcher("good")
        for _ in range(2):
            with self.assertRaises(nc.SourceUnavailable):
                fetcher("bad")
        self.assertEqual(calls, ["good", "bad"])

    def test_pdf_text_is_read_from_a_real_pdf(self):
        try:
            import pypdf  # noqa: F401
        except ImportError:
            self.skipTest("pypdf not installed")
        nc.pdf_to_text.cache_clear()
        text = nc.pdf_to_text(minimal_pdf("14.9.6.Atropine sulfate"))
        self.assertIn("14.9.6.Atropine", text)

    def test_corrupt_pdf_is_unavailable(self):
        try:
            import pypdf  # noqa: F401
        except ImportError:
            self.skipTest("pypdf not installed")
        nc.pdf_to_text.cache_clear()
        with self.assertRaises(nc.SourceUnavailable):
            nc.pdf_to_text(b"%PDF-1.4 corrupt")


def minimal_pdf(text):
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


class ExitAndReport(unittest.TestCase):
    def result(self, status, identifier="a"):
        return {
            "id": identifier,
            "topic": "主題",
            "url": "https://example.test",
            "affects": {"articles": ["blog/a.html"], "questions": [7], "related_questions": [9]},
            "status": status,
            "reason": "HTTP 403" if status == nc.UNKNOWN else "",
            "diff": ["-舊", "+新"] if status == nc.CHANGED else [],
            "document_version": None,
        }

    def test_exit_codes(self):
        self.assertEqual(nc.exit_code([self.result(nc.UNCHANGED)]), 0)
        self.assertEqual(nc.exit_code([self.result(nc.CHANGED)]), 1)
        self.assertEqual(nc.exit_code([self.result(nc.UNKNOWN), self.result(nc.UNCHANGED)]), 2)
        self.assertEqual(nc.exit_code([self.result(nc.UNKNOWN), self.result(nc.CHANGED)]), 1)

    def test_report_links_changed_rules_to_articles_and_questions(self):
        report = nc.format_report([self.result(nc.CHANGED)])
        self.assertIn("blog/a.html", report)
        self.assertIn("陳述此規則的題目：7", report)
        self.assertIn("提及相關藥物或器材的題目：9", report)
        self.assertIn("+新", report)

    def test_unknown_is_listed_apart_from_unchanged(self):
        report = nc.format_report([self.result(nc.UNKNOWN, "blocked"), self.result(nc.UNCHANGED, "fine")])
        unknown_part, unchanged_part = report.split("=== unchanged ===")
        self.assertIn("[blocked]", unknown_part)
        self.assertNotIn("[blocked]", unchanged_part)
        self.assertIn("不代表未變", unknown_part)

    def test_main_returns_nonzero_when_a_source_is_blocked(self):
        registry = {"rules": [pdf_entry()]}

        def blocked(url, method="GET", body=None):
            raise nc.SourceUnavailable("HTTP 403")

        with mock.patch.object(nc, "fetch_url", blocked), mock.patch.object(nc, "load_registry", return_value=registry["rules"]):
            with mock.patch("sys.stdout", new=io.StringIO()) as out:
                code = nc.main([])
        self.assertEqual(code, 2)
        self.assertIn("unknown", out.getvalue())


class RegistryContent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = nc.load_registry()

    def test_schema_and_fingerprints(self):
        self.assertEqual(nc.validate_registry(self.rules), [])

    def test_validator_rejects_a_tampered_baseline(self):
        tampered = json.loads(json.dumps(self.rules[0]))
        tampered["baseline"] += "x"
        self.assertTrue(nc.validate_registry([tampered]))

    def test_every_source_is_official(self):
        allowed = ("https://www.nhi.gov.tw/", "https://info.nhi.gov.tw/", "https://data.fda.gov.tw/")
        for rule in self.rules:
            self.assertTrue(rule["source"]["url"].startswith(allowed), rule["id"])
            self.assertRegex(rule["source"]["retrieved"], r"^\d{4}-\d{2}-\d{2}$", rule["id"])

    def test_article_links_exist(self):
        for rule in self.rules:
            self.assertTrue(rule["affects"]["articles"], rule["id"])
            for article in rule["affects"]["articles"]:
                self.assertTrue((ROOT / article).is_file(), f"{rule['id']}: {article}")

    def test_question_links_exist(self):
        bank = {q["n"] for q in json.loads((ROOT / "data/exam/questions.json").read_text(encoding="utf-8"))}
        for rule in self.rules:
            links = rule["affects"]["questions"] + rule["affects"]["related_questions"]
            self.assertLessEqual(set(links), bank, rule["id"])

    def test_quoted_rule_text_appears_in_the_source_text(self):
        for rule in self.rules:
            if rule["source"]["kind"] != "pdf_section":
                continue
            for part in rule["rule_zh"].split("…"):
                self.assertIn(nc.normalize(part), rule["baseline"], rule["id"])

    def test_no_simplified_characters(self):
        simplified = set((ROOT / "data/exam/simplified_chars.txt").read_text(encoding="utf-8").splitlines()[-1])
        for rule in self.rules:
            found = simplified & set(rule["topic"] + rule["rule_zh"])
            self.assertFalse(found, f"{rule['id']}: {sorted(found)}")

    def test_pending_amendment_is_marked_as_not_yet_in_force(self):
        pending = {rule["id"]: rule for rule in self.rules}["adalimumab-uveitis-8-2-4-10-2026-12"]
        self.assertEqual(pending["status"], "announced")
        self.assertEqual(pending["effective"], "2026-12-01")


if __name__ == "__main__":
    unittest.main()
