from pathlib import Path
import json
import sys
import tempfile
import unittest
from urllib.parse import quote
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _editor_metadata import author_metadata
from _gen_en_pages import meta_for_page
from _gen_en_pages import _swap_inner_to_english
from _gen_serp_meta import normalize_file, meta_content


def document(fields):
    marker = quote(json.dumps({'version': 1, **fields}), safe='')
    return ('<html><head><title>Original</title><meta name="description" content="Old" />'
            f'<meta name="hs-editor-metadata" content="{marker}"></head><body>'
            '<article><p class="tldr" data-en="Existing English body summary">正文</p></article></body></html>')


class EditorMetadata(unittest.TestCase):
    def test_plain_author_fields_are_normalized_before_generators_without_english_changes(self):
        source = document({'titleZh': '作者標題?', 'descriptionZh': '中文摘要! 問題 1:', 'descriptionEn': 'Research study 1:'})
        fields = author_metadata(source)
        self.assertEqual(fields['titleZh'], '作者標題？')
        self.assertEqual(fields['descriptionZh'], '中文摘要！ 問題 1：')
        self.assertEqual(fields['descriptionEn'], 'Research study 1:')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.html'
            path.write_text(source, encoding='utf8')
            normalize_file(path, 'Automatic fallback', True)
            self.assertEqual(meta_content(path.read_text(encoding='utf8'), 'description'), '中文摘要！ 問題 1：')
            self.assertFalse(normalize_file(path, 'Automatic fallback', True))
        _, english = meta_for_page('/en/blog/dry-eye-myths', 'dry-eye-myths', source)
        self.assertEqual(english, 'Research study 1:')

    def test_generated_english_treats_explicit_plaintext_titles_as_text_and_keeps_authored_markup(self):
        source = ('<html><head></head><body><h1><span data-zh="中文" data-en="Research &amp; &lt;img id=payload&gt;" data-hs-text-en>中文</span></h1>'
                  '<p data-zh="原文" data-en="&lt;strong&gt;Authored emphasis&lt;/strong&gt;">原文</p></body></html>')
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(_swap_inner_to_english(source), 'html.parser')
        self.assertEqual(soup.h1.get_text(), 'Research & <img id=payload>')
        self.assertIsNone(soup.find(id='payload'))
        self.assertEqual(soup.p.strong.get_text(), 'Authored emphasis')
    def test_explicit_english_summary_survives_generation_without_changing_title_or_prose(self):
        source = document({'descriptionEn': 'Author summary: <tag> & "quoted"'})
        title, description = meta_for_page('/en/blog/dry-eye-myths', 'dry-eye-myths', source)
        self.assertEqual(description, 'Author summary: <tag> & "quoted"')
        self.assertIn('HsiaoEye', title)
        _, fallback = meta_for_page('/en/blog/dry-eye-myths', 'dry-eye-myths', document({'descriptionEn': ''}))
        self.assertEqual(fallback, 'Existing English body summary')

    def test_explicit_chinese_summary_is_preserved_even_when_short_and_normalization_is_idempotent(self):
        source = document({'descriptionZh': '作者的短摘要 <tag> & "引號"'})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.html'
            path.write_text(source, encoding='utf8')
            normalize_file(path, 'Automatic fallback', True)
            normalized = path.read_text(encoding='utf8')
            self.assertEqual(meta_content(normalized, 'description'), '作者的短摘要 <tag> & "引號"')
            self.assertFalse(normalize_file(path, 'Automatic fallback', True))
            self.assertIn('<article><p', normalized)

    def test_invalid_metadata_fails_before_generation(self):
        with self.assertRaises(ValueError):
            author_metadata(document({'descriptionEn': ['invalid']}))
        self.assertEqual(author_metadata('<html><head></head></html>'), {})
