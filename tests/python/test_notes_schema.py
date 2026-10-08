import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _check_site_graph as audit


class NotesSchemaTests(unittest.TestCase):
    def test_actual_bilingual_notes_remain_connected_collections(self):
        for rel in ('notes.html', 'en/notes.html'):
            with self.subTest(rel=rel):
                self.assertEqual(audit.audit_static(rel, audit.STATIC_EXPECTED[rel]), [])

    def test_reintroduced_course_claims_are_rejected_in_both_locales(self):
        claims = [
            {'@type': 'Course'},
            [{'@type': 'Course', 'courseWorkload': 'PT1H'}],
            [{'@graph': [{'@type': 'CourseInstance'}]}],
            {'@graph': [{'@type': ['Thing', 'CourseInstance']}]},
            {'courseWorkload': 'PT1H'},
            {'educationalCredentialAwarded': 'informal knowledge'},
            {'mainEntity': {'@id': audit.DOMAIN + '/notes#course'}},
            {'mainEntity': audit.DOMAIN + '/en/notes#course'},
        ]
        for rel in ('notes.html', 'en/notes.html'):
            original = (ROOT / rel).read_text(encoding='utf-8')
            for claim in claims:
                with self.subTest(rel=rel, claim=claim), tempfile.TemporaryDirectory() as tmp:
                    target = Path(tmp) / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(original.replace('</head>',
                        '<script type="application/ld+json">' + json.dumps(claim) + '</script></head>'), encoding='utf-8')
                    with patch.object(audit, 'ROOT', Path(tmp)):
                        errors = audit.audit_static(rel, audit.STATIC_EXPECTED[rel])
                    self.assertTrue(any('must not claim a course' in error for error in errors), errors)


if __name__ == '__main__':
    unittest.main()
