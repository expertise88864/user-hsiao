from pathlib import Path
import sys
import unittest

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _gen_reader_navigation import BLOCK, END, START, render_navigation
from _gen_en_pages import _swap_inner_to_english
from _gen_faqpage_jsonld import extract_faqs
from _gen_llms_full_txt import _TextExtractor


class ReaderNavigationTests(unittest.TestCase):
    def source(self, extra='', dual=False):
        headings = ''.join(f'<h2 id="s{i}" data-zh="問題 {i}" data-en="Question {i}">問題 {i}</h2><p>原文不變</p>' for i in range(3))
        english = ('<div id="proseEn" style="display:none">' +
                   ''.join(f'<h2 id="s{i}-en">English {i}</h2>' for i in range(3)) + '</div>') if dual else ''
        return '<html><body><section><h1>標題</h1></section><article>' + extra + '<div id="proseZh">' + headings + '</div>' + english + '</article></body></html>'

    def test_first_paint_contents_preserves_authored_bytes_and_is_a_fixed_point(self):
        source = self.source('<script>const fake="<article><h1>fake</h1>";</script><!-- 作者註解 -->')
        result = render_navigation(source)
        self.assertEqual(BLOCK.sub('', result), source)
        self.assertEqual(render_navigation(result), result)
        self.assertEqual(result.index(START), result.index('<article>') + len('<article>'))
        self.assertEqual(len(BeautifulSoup(result, 'html.parser').select('#hs-inline-toc')), 1)

    def test_cms_removed_helper_and_changed_heading_are_rebuilt(self):
        result = render_navigation(self.source())
        stripped = BLOCK.sub(START + END, result).replace('問題 1', '更新 &amp; 1').replace('Question 1', 'Updated &amp; 1')
        rebuilt = render_navigation(stripped)
        soup = BeautifulSoup(rebuilt, 'html.parser')
        self.assertEqual(soup.select('#hs-inline-toc a')[1].get_text(), '更新 & 1')
        self.assertEqual(render_navigation(rebuilt), rebuilt)
        self.assertEqual(BLOCK.sub('', rebuilt), BLOCK.sub('', stripped))

    def test_english_nojs_links_reach_the_visible_legacy_or_inline_heading(self):
        for dual in (False, True):
            with self.subTest(dual=dual):
                result = render_navigation(self.source(dual=dual))
                soup = BeautifulSoup(_swap_inner_to_english(result), 'html.parser')
                for i, link in enumerate(soup.select('#hs-inline-toc a')):
                    target = 's' + str(i) + ('-en' if dual else '')
                    self.assertEqual(link['href'], '#' + target)
                    self.assertEqual(link.text, ('English ' if dual else 'Question ') + str(i))
                    self.assertIsNotNone(soup.find(id=target))

    def test_contents_are_not_medical_faq_or_llm_prose(self):
        source = self.source()
        result = render_navigation(source)
        self.assertEqual(extract_faqs(result), extract_faqs(source))
        def text(value):
            parser = _TextExtractor()
            parser.feed(value)
            return parser.text()
        self.assertEqual(text(result), text(source))

    def test_english_does_not_link_to_chinese_only_hidden_sections(self):
        source = self.source(dual=True).replace('<h2 id="s1-en">English 1</h2>', '')
        soup = BeautifulSoup(_swap_inner_to_english(render_navigation(source)), 'html.parser')
        self.assertEqual([a['href'] for a in soup.select('#hs-inline-toc a')], ['#s0-en', '#s2-en'])
        self.assertIn('2 sections', soup.select_one('#hs-inline-toc summary').text)

    def test_literal_ampersands_and_rich_heading_labels_survive_both_languages(self):
        source = self.source().replace('data-zh="問題 1"', 'data-zh="常見迷思 Q&amp;A"').replace('data-en="Question 1"', 'data-en="Frequently asked Q&amp;A"')
        source = source.replace('data-zh="問題 2"', 'data-zh="&lt;strong&gt;R&amp;amp;D&lt;/strong&gt;"').replace('data-en="Question 2"', 'data-en="&lt;strong&gt;R&amp;amp;D&lt;/strong&gt;"')
        result = render_navigation(source)
        zh = BeautifulSoup(result, 'html.parser')
        en = BeautifulSoup(_swap_inner_to_english(result), 'html.parser')
        self.assertEqual(zh.select('#hs-inline-toc a')[1].text, '常見迷思 Q&A')
        self.assertEqual(en.select('#hs-inline-toc a')[1].text, 'Frequently asked Q&A')
        self.assertEqual(zh.select('#hs-inline-toc a')[2].text, 'R&D')
        self.assertEqual(en.select('#hs-inline-toc a')[2].text, 'R&D')

    def test_english_body_keeps_literal_ampersands_markup_and_attribute_quotes(self):
        source = ('<html><body><h2 data-zh="問答" data-en="Q&amp;A">問答</h2>'
                  '<p data-zh="原文" data-en="&lt;strong&gt;R&amp;amp;D&lt;/strong&gt; &lt;a href=&quot;https://example.test/?x=&amp;quot;a&amp;quot;&amp;amp;y=2&quot;&gt;Q&amp;A&lt;/a&gt;">原文</p>'
                  '<p data-zh="字面標記" data-en="&amp;lt;strong&amp;gt;Q&amp;A&amp;lt;/strong&amp;gt;">字面標記</p></body></html>')
        soup = BeautifulSoup(_swap_inner_to_english(source), 'html.parser')
        self.assertEqual(soup.h2.text, 'Q&A')
        self.assertEqual(soup.strong.text, 'R&D')
        self.assertEqual(soup.a.text, 'Q&A')
        self.assertEqual(soup.a['href'], 'https://example.test/?x="a"&y=2')
        self.assertEqual(soup.find_all('p')[1].text, '<strong>Q&A</strong>')

    def test_numeric_unicode_and_quoted_heading_ids_are_safe_native_fragments(self):
        source = self.source().replace('id="s1"', 'id="1 問題&amp;more"')
        soup = BeautifulSoup(render_navigation(source), 'html.parser')
        self.assertEqual(soup.select('#hs-inline-toc a')[1]['href'], '#1%20%E5%95%8F%E9%A1%8C%26more')

    def test_short_or_missing_prose_is_left_alone_and_ambiguous_targets_fail(self):
        source = self.source().replace('<h2 id="s2"', '<h3 id="s2"').replace('問題 2</h2>', '問題 2</h3>')
        self.assertEqual(render_navigation(source), source)
        self.assertEqual(render_navigation('<article><p>No prose wrapper</p></article>'), '<article><p>No prose wrapper</p></article>')
        with self.assertRaises(ValueError):
            render_navigation(self.source('<div id="s1"></div>'))
        with self.assertRaises(ValueError):
            render_navigation(self.source(START))

    def test_committed_article_contents_match_current_authored_headings(self):
        root = Path(__file__).resolve().parents[2]
        for path in sorted((root / 'blog').glob('*.html')):
            with self.subTest(path=path.name):
                source = path.read_text(encoding='utf8')
                self.assertEqual(render_navigation(source), source)
                self.assertEqual(render_navigation(BLOCK.sub('', source)), source)


if __name__ == '__main__':
    unittest.main()
