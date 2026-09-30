"""CLI scaffolds must use the current site epoch rather than a stale literal."""
import importlib.util
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('new_article', Path(__file__).resolve().parents[2] / 'new-article.py')
scaffold = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scaffold)


class ScaffoldAssets(unittest.TestCase):
    def test_each_render_reads_current_epoch(self):
        args = Namespace(slug='fixture-topic', date='2026-10-01', title_zh='測試標題', title_en='Fixture title',
                         desc_zh='測試摘要', desc_en='Fixture description', tag_zh='測試', tag_en='Fixture', condition_icd10='H99')
        with tempfile.TemporaryDirectory() as folder, patch.object(scaffold, 'ROOT', folder):
            for version in ['20260682', '20260683']:
                Path(folder, 'index.html').write_text("(function(){var T='" + version + "';})();", encoding='utf-8')
                html = scaffold.render(args)
                for asset in ['/assets/app.css', '/assets/telemetry.js', '/blog/blog-shared.js']:
                    self.assertIn(asset + '?v=' + version + '"', html)
                self.assertNotIn('20260673', html)
            self.assertFalse(Path(folder, 'blog', 'fixture-topic.html').exists())

    def test_missing_or_ambiguous_epoch_cannot_emit_a_stale_scaffold(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(scaffold, 'ROOT', folder):
            for source in ['', "var T='20260682'; var T='20260683';", "var T='bad';"]:
                Path(folder, 'index.html').write_text(source, encoding='utf-8')
                with self.assertRaises(ValueError):
                    scaffold.asset_version()


if __name__ == '__main__':
    unittest.main()
