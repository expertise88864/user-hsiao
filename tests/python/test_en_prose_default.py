from pathlib import Path
import sys
import unittest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _gen_en_pages import _swap_inner_to_english


class EnglishProseDefault(unittest.TestCase):
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
