import unittest
from bs4 import BeautifulSoup
from _gen_blog_filter import render, BLOCK, PLACEHOLDER, START, END


def article(tag='兒童近視', en='Pediatric myopia', cat='rx'):
    return (f'<a class="article-list-item" href="/blog/test">'
            f'<span class="chip cat-{cat}">衛教</span>'
            f'<span class="chip tag" data-zh="{tag}" data-en="{en}">{tag}</span>'
            '<h3>作者原文 &amp; Q&amp;A</h3></a>')


class BlogFilterTests(unittest.TestCase):
    def test_english_mirror_localizes_only_filter_placeholder(self):
        from _gen_en_pages import _swap_inner_to_english
        author = '<input id="author" placeholder="Author keeps this" data-zh-placeholder="ZH" data-en-placeholder="EN">'
        source = '<html><body>' + author + PLACEHOLDER + article() * 4 + '</body></html>'
        doc = BeautifulSoup(_swap_inner_to_english(render(source, 'x{}')), 'html.parser')
        self.assertEqual(doc.select_one('#hs-blog-search')['placeholder'], 'Type to search…')
        self.assertEqual(doc.select_one('#author')['placeholder'], 'Author keeps this')

    def test_generated_helper_is_fixed_point_and_preserves_every_other_byte(self):
        source = '<main>' + PLACEHOLDER + ''.join(article() for _ in range(4)) + '</main>'
        result = render(source, '.hs-blog-filter{margin:0}')
        self.assertEqual(BLOCK.sub(PLACEHOLDER, result), source)
        self.assertEqual(render(result, '.hs-blog-filter{margin:0}'), result)
        doc = BeautifulSoup(result, 'html.parser')
        self.assertEqual(doc.select_one('[data-tag="兒童近視"] .count').text, '4')
        self.assertTrue(all(c.has_attr('disabled') for c in doc.select('#hs-blog-filter button, #hs-blog-filter input')))
        self.assertEqual(doc.select_one('label')['for'], doc.select_one('input')['id'])

    def test_existing_english_tag_aliases_group_without_changing_cards(self):
        source = PLACEHOLDER + article(en='Myopia') + article() * 3
        result = render(source, 'x{}')
        self.assertEqual(BLOCK.sub(PLACEHOLDER, result), source)
        doc = BeautifulSoup(result, 'html.parser')
        self.assertEqual(len(doc.select('[data-tag="兒童近視"]')), 1)
        self.assertEqual(doc.select_one('[data-tag] span')['data-en'], 'Myopia')

    def test_tags_escape_text_and_attribute_content(self):
        source = PLACEHOLDER + article('Q&amp;A &lt;img&gt;', 'R&amp;D &quot;quoted&quot;') * 4
        doc = BeautifulSoup(render(source, 'x{}'), 'html.parser')
        button = doc.select_one('[data-tag]')
        self.assertEqual(button['data-tag'], 'Q&A <img>')
        self.assertEqual(button.select_one('span')['data-en'], 'R&D "quoted"')
        self.assertEqual(button.select_one('span').text, 'Q&A <img>')
        self.assertFalse(button.select('img'))

    def test_ambiguous_helpers_unknown_categories_and_missing_labels_fail(self):
        good = PLACEHOLDER + article() * 4
        for source in [good + START, good + END, good + PLACEHOLDER,
                       END + good + START,
                       START + good + END,
                       good.replace('cat-rx', 'cat-unknown'),
                       good.replace('data-en="Pediatric myopia"', 'data-en=""'),
                       good.replace('class="article-list-item"', 'class="article-list-item" id="hs-blog-filter"', 1)]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                render(source, 'x{}')
        with self.assertRaises(ValueError):
            render(good, '</style><script>')

    def test_small_lists_keep_native_article_navigation(self):
        source = PLACEHOLDER + article()
        self.assertEqual(render(source, 'x{}'), source)
