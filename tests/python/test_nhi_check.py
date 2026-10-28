import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import nhi_check
from nhi_check import (FetchError, RegistryError, check_registry, check_rule, exit_code, extract_section,
                       fingerprint, normalize, record, reverse_lookup, validate_registry)

# Fixture text is invented for the tests; it is not a quotation of any official rule.
PAGE = '''<html><head><style>p{}</style><script>var a = "第 9 節";</script></head><body>
<h2>第 9 節　測試條文</h2><p>甲、限 　測試病例使用。</p>
<p>乙、每次&nbsp;處方以１瓶為限。</p><h2>第 10 節　下一節</h2><p>無關內容。</p></body></html>'''
SECTION = {'start': '第 9 節', 'end': '第 10 節'}


def rule(**overrides):
    base = {
        'id': 'fixture-rule', 'topic': '測試規定', 'rule_zh': '測試摘要', 'effective': '2026-01-01',
        'version': '測試版', 'section': dict(SECTION),
        'source': {'title': '測試來源', 'url': 'https://example.invalid/rule', 'retrieved': '2026-10-28', 'format': 'html'},
        'affects': {'articles': ['blog/glaucoma-treatment-selection.html'], 'questions': [12]},
        'fingerprint': fingerprint(extract_section(nhi_check.html_to_text(PAGE), SECTION)),
    }
    base.update(overrides)
    return base


def registry(rules=None, pending=None):
    return {'schema_version': 1, 'rules': [rule()] if rules is None else rules, 'pending': pending or []}


def serve(body):
    return lambda url: body.encode('utf-8')


def unreachable(url):
    raise FetchError('ConnectionRefusedError: refused')


class NormalizeTests(unittest.TestCase):
    def test_whitespace_and_width_do_not_change_the_fingerprint(self):
        self.assertEqual(normalize('每次 處方\n以１瓶　為限'), normalize('每次處方以1瓶為限'))

    def test_section_stops_before_the_end_marker_and_ignores_scripts(self):
        text = extract_section(nhi_check.html_to_text(PAGE), SECTION)
        self.assertTrue(text.startswith('第9節'))
        self.assertIn('每次處方以1瓶為限', text)
        self.assertNotIn('下一節', text)
        self.assertNotIn('var', text)

    def test_missing_markers_raise(self):
        with self.assertRaises(LookupError):
            extract_section('無此節', SECTION)
        with self.assertRaises(LookupError):
            extract_section('第 9 節 但沒有結尾', SECTION)


class CheckTests(unittest.TestCase):
    def test_unchanged(self):
        result = check_rule(rule(), serve(PAGE))
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(exit_code([result]), 0)

    def test_formatting_only_change_stays_unchanged(self):
        reformatted = PAGE.replace('<p>', '<div>\n  ').replace('</p>', '</div>')
        self.assertEqual(check_rule(rule(), serve(reformatted))['status'], 'unchanged')

    def test_changed_rule_reports_diff_and_affected_pages_and_exits_non_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshots = Path(tmp)
            (snapshots / 'fixture-rule.txt').write_text(
                extract_section(nhi_check.html_to_text(PAGE), SECTION), encoding='utf-8')
            result = check_rule(rule(), serve(PAGE.replace('１瓶', '２瓶')), snapshots)
        self.assertEqual(result['status'], 'changed')
        self.assertIn('-乙、每次處方以1瓶為限。', result['diff'])
        self.assertIn('+乙、每次處方以2瓶為限。', result['diff'])
        self.assertEqual(result['affects']['questions'], [12])
        self.assertEqual(exit_code([result]), 1)
        report = nhi_check.format_report([result])
        self.assertIn('[CHANGED] fixture-rule', report)
        self.assertIn('blog/glaucoma-treatment-selection.html', report)

    def test_unreachable_is_unknown_never_unchanged(self):
        result = check_rule(rule(), unreachable)
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(exit_code([result]), 2)

    def test_moved_section_is_unknown(self):
        result = check_rule(rule(), serve('<p>頁面改版，找不到條文</p>'))
        self.assertEqual(result['status'], 'unknown')
        self.assertIn('marker', result['reason'])

    def test_unrecorded_fingerprint_is_unknown_without_fetching(self):
        def forbidden(url):
            raise AssertionError('must not fetch')
        self.assertEqual(check_rule(rule(fingerprint=None), forbidden)['status'], 'unknown')

    def test_changed_wins_over_unknown_and_pending_is_not_unchanged(self):
        self.assertEqual(exit_code([{'status': 'unknown'}, {'status': 'changed'}]), 1)
        self.assertEqual(exit_code([{'status': 'unchanged'}, {'status': 'pending'}]), 2)

    def test_pending_entries_are_reported_and_never_fetched(self):
        item = {'id': 'cand', 'topic': '候選', 'site_cites': '第 9 節', 'blocker': '原文未開啟',
                'affects': {'articles': [], 'questions': []}}
        results = check_registry(registry(rules=[], pending=[item]), unreachable)
        self.assertEqual([r['status'] for r in results], ['pending'])

    def test_pdf_sources_are_read(self):
        try:
            import pypdf  # noqa: F401
        except ImportError:
            self.skipTest('pypdf not installed')
        with self.assertRaises(FetchError):
            nhi_check.source_text(b'not a pdf', 'pdf')


class RegistryValidationTests(unittest.TestCase):
    def test_fixture_registry_is_valid(self):
        validate_registry(registry())

    def test_rejects_bad_entries(self):
        cases = {
            'missing source url': rule(source={'title': 't', 'retrieved': '2026-10-28', 'format': 'html'}),
            'http url': rule(source={**rule()['source'], 'url': 'http://example.invalid'}),
            'bad date': rule(effective='115-09-22'),
            'bad fingerprint': rule(fingerprint='abc'),
            'missing article': rule(affects={'articles': ['blog/no-such-article.html'], 'questions': []}),
            'question out of bank': rule(affects={'articles': [], 'questions': [10 ** 6]}),
        }
        for name, bad in cases.items():
            with self.subTest(name), self.assertRaises(RegistryError):
                validate_registry(registry(rules=[bad]))

    def test_rejects_duplicate_ids_and_unverified_content_in_pending(self):
        with self.assertRaises(RegistryError):
            validate_registry(registry(rules=[rule(), rule()]))
        item = {'id': 'cand', 'topic': '候選', 'site_cites': '第 9 節', 'blocker': '原文未開啟',
                'affects': {'articles': [], 'questions': []}, 'rule_zh': '未經確認的摘要'}
        with self.assertRaises(RegistryError):
            validate_registry(registry(rules=[], pending=[item]))

    def test_record_writes_fingerprint_and_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'registry.json'
            data = registry(rules=[rule(fingerprint=None)])
            path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            snapshots = Path(tmp) / 'snapshots'
            digest = record(path, 'fixture-rule', serve(PAGE), snapshots)
            self.assertEqual(digest, rule()['fingerprint'])
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['rules'][0]['fingerprint'], digest)
            self.assertTrue((snapshots / 'fixture-rule.txt').is_file())

    def test_reverse_lookup(self):
        data = registry()
        self.assertEqual(reverse_lookup(data, article='blog/glaucoma-treatment-selection.html')[0]['id'], 'fixture-rule')
        self.assertEqual(reverse_lookup(data, question=12)[0]['kind'], 'rule')
        self.assertEqual(reverse_lookup(data, question=13), [])


class CommittedRegistryTests(unittest.TestCase):
    def setUp(self):
        self.registry = nhi_check.load_registry()

    def test_committed_registry_is_valid_and_rules_carry_their_sources(self):
        for entry in self.registry['rules']:
            self.assertTrue(entry['source']['url'].startswith('https://'))
        self.assertGreater(len(self.registry['rules']) + len(self.registry['pending']), 0)

    def test_committed_registry_and_report_use_traditional_chinese_only(self):
        lines = (ROOT / 'data' / 'exam' / 'simplified_chars.txt').read_text(encoding='utf-8').splitlines()
        simplified = set(lines[-1])
        for path in (ROOT / 'data' / 'nhi' / 'registry.json', ROOT / 'docs' / 'NHI_REGISTRY_R1.md'):
            found = sorted(set(path.read_text(encoding='utf-8')) & simplified)
            self.assertEqual(found, [], f'{path.name} contains simplified characters')

    def test_offline_check_of_committed_registry_never_reports_unchanged(self):
        results = check_registry(copy.deepcopy(self.registry), unreachable)
        self.assertNotIn('unchanged', {r['status'] for r in results})
        self.assertNotEqual(exit_code(results), 0)


if __name__ == '__main__':
    unittest.main()
