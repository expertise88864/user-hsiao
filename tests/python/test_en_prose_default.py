from pathlib import Path
import sys
import unittest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _gen_en_pages import _swap_inner_to_english


class EnglishProseDefault(unittest.TestCase):
    def test_table_instruction_is_english_and_untranslated_table_keeps_chinese(self):
        source = ('<body><div class="hs-table-reader"><p class="hs-table-hint" id="table-hint" '
                  'data-zh="表格可左右捲動" data-en="Scroll horizontally">表格可左右捲動</p>'
                  '<div class="hs-table-scroll" aria-labelledby="table-hint"><table><tr><td>'
                  '這是尚未翻譯的中文表格資料，必須保留原本語言與所有數值。'
                  '</td></tr></table></div></div></body>')
        output = _swap_inner_to_english(source)
        soup = BeautifulSoup(output, 'html.parser')
        self.assertEqual(soup.select_one('.hs-table-scroll')['lang'], 'en')
        self.assertEqual(soup.select_one('.hs-table-hint')['lang'], 'en')
        self.assertEqual(soup.table['lang'], 'zh-Hant')
        self.assertEqual(soup.table.td.get_text(), '這是尚未翻譯的中文表格資料，必須保留原本語言與所有數值。')
        self.assertEqual(_swap_inner_to_english(output), output)

    def test_english_mirror_exposes_existing_english_without_javascript(self):
        head = '<!doctype html><html lang="en"><head><title>Fixture</title></head><body>'
        source = head + ('<div id="proseZh" style="padding:2px; DISPLAY: block !important">中文原文</div>'
                         '<div id="proseEn" style="display:none; margin:3px">English source</div></body></html>')
        result = _swap_inner_to_english(source)
        self.assertTrue(result.startswith(head))
        soup = BeautifulSoup(result, 'html.parser')
        self.assertEqual(soup.find(id='proseZh')['style'], 'padding:2px;display:none')
        self.assertEqual(soup.find(id='proseEn')['style'], 'margin:3px;display:block')
        self.assertEqual(soup.find(id='proseEn').get_text(), 'English source')
        self.assertEqual(soup.find(id='proseZh').get_text(), '中文原文')
        self.assertEqual(_swap_inner_to_english(result), result)

    def test_missing_or_empty_english_does_not_hide_the_available_source(self):
        for tail in ['', '<div id="proseEn" style="display:none"> </div>']:
            source = '<body><div id="proseZh">中文原文</div>' + tail + '</body>'
            soup = BeautifulSoup(_swap_inner_to_english(source), 'html.parser')
            self.assertNotIn('style', soup.find(id='proseZh').attrs)

    def test_paired_navigation_changes_language_and_targets_together(self):
        source = ('<body><nav><div data-zh="&lt;a href=&quot;#zh&quot;&gt;中文&lt;/a&gt;" '
                  'data-en="&lt;a href=&quot;#en&quot;&gt;English&lt;/a&gt;"><a href="#zh">中文</a></div></nav></body>')
        soup = BeautifulSoup(_swap_inner_to_english(source), 'html.parser')
        self.assertEqual(soup.nav.a['href'], '#en')
        self.assertEqual(soup.nav.a.get_text(), 'English')
