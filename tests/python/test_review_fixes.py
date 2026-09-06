import contextlib
import io
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _articles_field
import _check_chain_docs
import _check_jsonld_escaping
import _gen_serp_meta
import _check_listing_schema
import _check_en_jsonld


class ReviewFixes(unittest.TestCase):
    def test_real_python_catalog_consumers_preserve_escaped_quotes_and_braces(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'blog').mkdir()
            (root / 'blog/blog-shared.js').write_text(
                r"DN.ARTICLES = [{slug:'fixture',title:'Before } after',title_en:'Sjögren\'s review'}];", encoding='utf-8')
            for module, function in [(_gen_serp_meta, 'read_catalog'), (_check_listing_schema, 'parse_catalog'), (_check_en_jsonld, 'parse_catalog')]:
                original = module.ROOT
                try:
                    module.ROOT = root
                    rows = getattr(module, function)()
                    row = rows['fixture'] if isinstance(rows, dict) else rows[0]
                    self.assertEqual(row['title_en'], "Sjögren's review")
                finally:
                    module.ROOT = original

    def test_error_diagnostic_names_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'index.html').write_text('<script type="application/ld+json">{"name":"a < b"}</script>', encoding='utf-8')
            old = _check_jsonld_escaping.ROOT
            output = io.StringIO()
            try:
                _check_jsonld_escaping.ROOT = root
                with contextlib.redirect_stdout(output):
                    self.assertEqual(_check_jsonld_escaping.main(), 1)
            finally:
                _check_jsonld_escaping.ROOT = old
            self.assertIn('index.html', output.getvalue())
            self.assertNotIn(' - False', output.getvalue())

    def test_command_order_and_regeneration_entry_are_guarded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in [*_check_chain_docs.DOCS, 'docs/MODEL-GUIDE.md', '.github/workflows/quality.yml', '.github/workflows/regen-en.yml']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, target)
            self.assertEqual(_check_chain_docs.check(root), [])
            doc = root / 'AGENTS.md'
            source = doc.read_text(encoding='utf-8')
            doc.write_text(source.replace('python _gen_en_pages.py', 'python _gen_en_pages_MISSING.py'), encoding='utf-8')
            self.assertTrue(_check_chain_docs.check(root))
            doc.write_text(source, encoding='utf-8')
            workflow = root / '.github/workflows/quality.yml'
            source = workflow.read_text(encoding='utf-8')
            source = source.replace('          python _normalize_skiplinks.py\n', '')
            source = source.replace('          python _apply_i_series.py', '          python _normalize_skiplinks.py\n          python _apply_i_series.py')
            workflow.write_text(source, encoding='utf-8')
            self.assertIn('Skip-link pruning must run after injection', _check_chain_docs.check(root))
            regen = root / '.github/workflows/regen-en.yml'
            regen.write_text(regen.read_text(encoding='utf-8') + '\n          git push\n', encoding='utf-8')
            self.assertIn('CMS generation check must not publish unvalidated changes', _check_chain_docs.check(root))
            guide = root / 'docs/MODEL-GUIDE.md'
            guide.write_text(guide.read_text(encoding='utf-8').replace('npm run test:api', '# omitted API tests'), encoding='utf-8')
            self.assertIn('MODEL-GUIDE push recipe must require the complete local CI sequence', _check_chain_docs.check(root))


if __name__ == '__main__':
    unittest.main()
