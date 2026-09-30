import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _check_en_publishability as audit


class EnglishPublishability(unittest.TestCase):
    def audit_fixture(self, *, gated=True, missing=True, noindex=True, leak=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'blog').mkdir()
            (root/'en/blog').mkdir(parents=True)
            (root/'blog/blog-shared.js').write_text(
                "DN.ARTICLES = [{slug:'fixture'}]; DN.STUB_SLUGS = new Set([]); "
                + "DN.EN_STUB_SLUGS = new Set([" + ("'fixture'" if gated else '') + "]);", encoding='utf8')
            url = audit.DOMAIN + '/en/blog/fixture'
            alternates = '' if gated else '<link rel="alternate" hreflang="en" href="' + url + '">'
            (root/'blog/fixture.html').write_text(alternates,encoding='utf8')
            source = ('<meta name="robots" content="' + ('noindex,follow' if noindex else 'index,follow') + '">'
                      '<link rel="canonical" href="' + url + '">' + alternates +
                      '<body><div id="proseZh" style="display:none"><h2 id="section">中文</h2><figure>Source figure</figure></div>'
                      '<div id="proseEn"><h2 id="section-en">English source</h2>' +
                      ('' if missing else '<figure>English figure</figure>') + '</div></body>')
            (root/'en/blog/fixture.html').write_text(source,encoding='utf8')
            old_root, old_artifacts = audit.ROOT, audit.DISCOVERY_ARTIFACTS
            audit.ROOT, audit.DISCOVERY_ARTIFACTS = root, [root/'sitemap.xml']
            if leak: (root/'sitemap.xml').write_text(url,encoding='utf8')
            try:
                with contextlib.redirect_stdout(io.StringIO()) as captured:
                    code = audit.main()
                return code, captured.getvalue()
            finally: audit.ROOT, audit.DISCOVERY_ARTIFACTS = old_root, old_artifacts

    def test_readable_partial_english_retains_noindex_gate(self):
        self.assertEqual(self.audit_fixture()[0], 0)

    def test_incomplete_mirror_cannot_be_indexed_even_when_english_looking(self):
        code, message = self.audit_fixture(gated=False, noindex=False)
        self.assertEqual(code, 1)
        self.assertIn('incomplete source coverage', message)

    def test_complete_english_stub_still_requires_explicit_reclassification(self):
        code, message = self.audit_fixture(missing=False)
        self.assertEqual(code, 1)
        self.assertIn('remove it from EN_STUB_SLUGS', message)

    def test_missing_noindex_and_discovery_leaks_still_fail(self):
        self.assertEqual(self.audit_fixture(noindex=False)[0], 1)
        self.assertEqual(self.audit_fixture(leak=True)[0], 1)

    def test_missing_section_is_a_coverage_gap(self):
        self.assertEqual(audit.translation_gaps(
            '<div id="proseZh"><h2 id="follow-up">Follow-up</h2></div><div id="proseEn">English</div>'), ['follow-up'])
