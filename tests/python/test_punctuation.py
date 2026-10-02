import unittest

from halfwidth_to_fullwidth import convert


class TerminalPunctuationTests(unittest.TestCase):
    def test_bilingual_attributes_and_visible_copy_agree(self):
        for quote in ('"', "'"):
            for half, full in (('?', '？'), ('!', '！')):
                with self.subTest(quote=quote, punctuation=half):
                    source = (f'<span data-zh={quote}中文問句{half}{quote} '
                              f'data-en={quote}English question{half}{quote}>'
                              f'中文問句{half}</span>')
                    expected = (f'<span data-zh={quote}中文問句{full}{quote} '
                                f'data-en={quote}English question{half}{quote}>'
                                f'中文問句{full}</span>')
                    self.assertEqual(convert(source), (expected, 2))
                    self.assertEqual(convert(expected), (expected, 0))

    def test_english_and_protected_technical_values_remain_exact(self):
        source = '''<style>.example::after { content: "中文!"; }</style>
<script>const message = "中文?";</script>
<script type="application/ld+json">{"name":"中文?"}</script>
<a href="/中文?query=1" src='/中文!' class="中文?" id='中文!'
 style="--caption:'中文?'" onclick='alert("中文!")'
 onload="中文?" onerror='中文!' data-tag="中文?" data-test='中文!'
 data-en="English question?">English question? English warning!</a>'''
        self.assertEqual(convert(source), (source, 0))

    def test_existing_body_boundaries_still_normalize(self):
        for suffix in (' ', '\n', '<br>', ''):
            with self.subTest(suffix=suffix):
                self.assertEqual(convert('中文?' + suffix), ('中文？' + suffix, 1))
                self.assertEqual(convert('中文!' + suffix), ('中文！' + suffix, 1))

    def test_unlisted_technical_quote_boundaries_are_not_display_copy(self):
        source = '''<input pattern="中文?" onfocus="fn('中文?')"
 action='/中文?' formaction="/中文!" poster='/中文?'
 srcdoc="中文?" data-other='中文!' title="中文?">'''
        self.assertEqual(convert(source), (source, 0))

    def test_bilingual_values_with_opposite_quotes_and_newlines(self):
        source = '''<p data-zh="他問'哪個'\n中文?" data-en='English "question"?'>中文？</p>'''
        expected = '''<p data-zh="他問'哪個'\n中文？" data-en='English "question"?'>中文？</p>'''
        self.assertEqual(convert(source), (expected, 1))
        self.assertEqual(convert(expected), (expected, 0))

    def test_apparent_bilingual_markup_in_technical_attributes_is_not_copy(self):
        source = '''<input onfocus="fn(` data-zh='中文?'`)"
 srcdoc="<p data-zh='中文?'></p>" pattern="data-zh='中文?'">
<!-- <span data-zh="中文?"></span> -->'''
        self.assertEqual(convert(source), (source, 0))


if __name__ == '__main__':
    unittest.main()
