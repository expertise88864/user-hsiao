from pathlib import Path
import sys
import tempfile
import unittest

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _article_reading_meta import BLOCK, END, START, catalog_metadata, reading_minutes, render_reading_meta
from _gen_en_pages import _swap_inner_to_english
from _gen_faqpage_jsonld import extract_faqs
from _gen_llms_full_txt import article_body


class ReadingMetaTests(unittest.TestCase):
    def source(self, hero=True, lead=True):
        title = '<h1 data-zh="作者標題" data-en="Author title">作者標題</h1>'
        summary = '<p class="tldr" data-zh="作者摘要 &amp; 原文" data-en="Author summary &amp; original text">作者摘要 &amp; 原文</p>' if lead else ''
        prose = '<div id="proseZh"><p data-zh="' + '眼' * 1050 + '" data-en="English sentence.">' + '眼' * 1050 + '</p><!-- ignored Chinese comment -->' + '<script type="application/json">{"label":"diagram"}</script></div>'
        content = '<section>' + title + summary + '</section><article>' + prose + '</article>' if hero else '<article>' + title + summary + prose + '</article>'
        return '<html><head><meta name="robots" content="index,follow"></head><body>' + content + '</body></html>'

    def test_catalog_preserves_real_numeric_values_without_reading_strings_or_comments_as_fields(self):
        rows = catalog_metadata(r'''DN.ARTICLES = [{slug:'one',title:'Before }; ]; minutes:999',date:'2026-01-01',minutes:7.5}, {slug:'two',minutes:'999',updated:'2026-02-01'}, {slug:'three', /* minutes:123 */ minutes:0}];''')
        self.assertEqual(rows['one']['minutes'], 7.5)
        self.assertNotIn('minutes', rows['two'])
        self.assertNotIn('minutes', rows['three'])
        for source in ['DN.ARTICLES = [', 'DN.ARTICLES = [];', "DN.ARTICLES = [{slug:'one'}, {slug:'one'}];"]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                catalog_metadata(source)

    def test_preserves_all_authored_bytes_and_is_a_fixed_point_with_both_hero_structures(self):
        for hero in [True, False]:
            for lead in [True, False]:
                source = self.source(hero=hero, lead=lead)
                metadata = {'date': '2026-01-01', 'updated': '2026-02-01', 'minutes': 7.5}
                result = render_reading_meta(source, metadata)
                self.assertEqual(BLOCK.sub('', result), source)
                self.assertEqual(render_reading_meta(result, metadata), result)
                soup = BeautifulSoup(result, 'html.parser')
                bar = soup.find(id='hs-reading-meta')
                target = soup.select_one('.tldr') if lead else soup.h1
                self.assertIs(target.find_next_sibling(), bar)
                self.assertIn('閱讀約 7.5 分鐘', bar.text)
                self.assertIn('最後更新 2026-02-01', bar.text)
                self.assertNotIn('審閱', bar.text)
                self.assertEqual(extract_faqs(result), extract_faqs(source))
                with tempfile.TemporaryDirectory() as tmp:
                    original = Path(tmp) / 'original.html'
                    generated = Path(tmp) / 'generated.html'
                    original.write_text(source, encoding='utf8')
                    generated.write_text(result, encoding='utf8')
                    self.assertEqual(article_body(generated), article_body(original))
                english = BeautifulSoup(_swap_inner_to_english(result), 'html.parser')
                self.assertIn('7.5 min read', english.find(id='hs-reading-meta').text)
                self.assertIn('Last updated · 2026-02-01', english.find(id='hs-reading-meta').text)

    def test_missing_precomputed_time_uses_the_existing_fallback_per_language(self):
        source = self.source()
        result = render_reading_meta(source, {'date': '2026-01-01'})
        soup = BeautifulSoup(result, 'html.parser')
        labels = soup.select_one('#hs-reading-meta span[data-zh]')
        self.assertEqual(labels['data-zh'], '閱讀約 3 分鐘')
        self.assertEqual(labels['data-en'], '2 min read')
        # JS Math.round rounds positive x.5 upward; Python round would not.
        self.assertEqual(reading_minutes(BeautifulSoup('<div>' + '眼' * 875 + '</div>', 'html.parser').div), 3)

    def test_cms_stripped_helper_is_rebuilt_from_new_body_and_date(self):
        source = self.source()
        first = render_reading_meta(source, {'date': '2026-01-01'})
        stripped = BLOCK.sub(START + END, first).replace('眼' * 1050, '眼' * 2800)
        final = render_reading_meta(stripped, {'updated': '2026-03-01'})
        self.assertEqual(BLOCK.sub('', final), BLOCK.sub('', stripped))
        self.assertIn('閱讀約 8 分鐘', final)
        self.assertIn('最後更新 2026-03-01', final)
        self.assertNotIn('最後更新 2026-01-01', final)
        self.assertEqual(render_reading_meta(final, {'updated': '2026-03-01'}), final)

    def test_separate_english_body_provides_the_english_estimate(self):
        source = ('<html><head><meta name="robots" content="index,follow"></head><body>'
                  '<section><h1>Author title</h1><p>Author summary</p></section><article>'
                  '<div id="proseZh"><p>' + '眼' * 3500 + '</p></div>'
                  '<div id="proseEn" style="display:none"><p>' + 'Word. ' * 800 + '</p></div>'
                  '</article></body></html>')
        result = render_reading_meta(source, {'date': '2026-01-01'})
        label = BeautifulSoup(result, 'html.parser').select_one('#hs-reading-meta span[data-en$="min read"]')
        self.assertEqual(label['data-zh'], '閱讀約 10 分鐘')
        self.assertEqual(label['data-en'], '4 min read')
        self.assertEqual(BLOCK.sub('', result), source)
        self.assertEqual(render_reading_meta(result, {'date': '2026-01-01'}), result)

    def test_drafts_noindex_and_non_articles_have_no_generated_claims_and_ambiguous_helpers_fail(self):
        source = self.source()
        self.assertEqual(render_reading_meta(source, None), source)
        noindex = source.replace('index,follow', 'noindex,follow')
        self.assertEqual(render_reading_meta(noindex, {'date': '2026-01-01'}), noindex)
        self.assertEqual(render_reading_meta('<body><h1>Index</h1></body>', {}), '<body><h1>Index</h1></body>')
        for extra in [START, END, '<div id="hs-reading-meta">unmarked helper</div>']:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                render_reading_meta(source.replace('</body>', extra + '</body>'), {})
        result = render_reading_meta(source, {'updated': '<unsafe "date">'})
        self.assertEqual(BeautifulSoup(result, 'html.parser').select_one('#hs-reading-meta span[data-en^="Last updated"]')['data-zh'], '最後更新 <unsafe "date">')
        self.assertNotIn('<unsafe', result)

    def test_all_committed_articles_are_regenerable_and_body_bytes_match_the_unmarked_source(self):
        catalog = catalog_metadata((ROOT / 'blog/blog-shared.js').read_text(encoding='utf8'))
        count = 0
        for path in sorted((ROOT / 'blog').glob('*.html')):
            with self.subTest(path=path.name):
                source = path.read_bytes().decode('utf8')
                self.assertEqual(render_reading_meta(source, catalog.get(path.stem)), source)
                if START in source:
                    count += 1
                    self.assertEqual(len(BeautifulSoup(source, 'html.parser').select('#hs-reading-meta')), 1)
                    self.assertEqual(render_reading_meta(BLOCK.sub('', source), catalog.get(path.stem)), source)
        self.assertGreater(count, 0)


if __name__ == '__main__':
    unittest.main()
