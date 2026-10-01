from pathlib import Path
import sys
import unittest
import json
import subprocess
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _gen_diagram_readers import wrap_diagrams
from _gen_en_pages import _swap_inner_to_english
from _gen_faqpage_jsonld import extract_faqs
from _gen_llms_full_txt import _TextExtractor


class DiagramReaders(unittest.TestCase):
    def source(self, svg):
        return ('<head><link rel="stylesheet" href="/assets/article.css?v=20260689"></head>'
                '<body><article><figure>' + svg + '<figcaption>作者原有圖說。</figcaption></figure></article></body>')

    def test_preserves_raw_svg_and_ids_through_repeated_generation(self):
        svg = '<svg viewBox="0 0 600 300" aria-labelledby="real-title">\r\n<title id="real-title">原標題</title><text x="4">保留 12.5% &amp; 引文</text></svg>'
        result = wrap_diagrams(self.source(svg))
        self.assertIn(svg, result)
        self.assertEqual(result.count('id="real-title"'), 1)
        self.assertEqual(wrap_diagrams(result), result)
        soup = BeautifulSoup(result, 'html.parser')
        self.assertEqual(soup.select_one('.hs-diagram-scroll')['role'], 'group')
        self.assertIsNotNone(soup.find(id=soup.select_one('.hs-diagram-scroll')['aria-describedby']))

    def test_inserting_new_diagram_keeps_existing_control_ids(self):
        first = '<svg viewBox="0 0 600 300"><text>原圖</text></svg>'
        result = wrap_diagrams(self.source(first))
        second = '<svg viewBox="0 0 720 300"><text>新增圖</text></svg>'
        result = wrap_diagrams(result.replace('<figure>', '<figure>' + second, 1))
        soup = BeautifulSoup(result, 'html.parser')
        self.assertEqual(len(soup.select('.hs-diagram-mode')), 2)
        ids = [el['id'] for el in soup.select('[id]')]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn('id="hs-diagram-mode-1"', result)
        self.assertEqual(wrap_diagrams(result), result)

    def test_changed_viewbox_refreshes_floor_without_changing_authored_svg(self):
        svg = '<svg viewBox="0 0 600 300"><text>原資料</text></svg>'
        result = wrap_diagrams(self.source(svg)).replace('viewBox="0 0 600 300"', 'viewBox="0 0 1200 300"')
        result = wrap_diagrams(result)
        self.assertIn('viewBox="0 0 1200 300"', result)
        self.assertIn('--hs-diagram-width:1280px', result)
        self.assertEqual(wrap_diagrams(result), result)

    def test_controls_do_not_turn_into_medical_faqs(self):
        controls = '<details class="hs-diagram-mode"><summary>如何放大圖表？</summary><p>這只是介面操作說明，不能被當成作者的醫療問題與答案。</p></details>'
        medical = '<details><summary>什麼是青光眼？</summary><p>作者原有的醫療回答內容，保留完整限制與參考來源，不增加新的醫療結論。</p></details>'
        self.assertEqual(extract_faqs('<article>' + controls + medical + '</article>'), extract_faqs('<article>' + medical + '</article>'))

    def test_english_controls_preserve_untranslated_svg_language(self):
        svg = '<svg viewBox="0 0 600 300"><text>作者原有中文图表内容</text></svg>'
        result = wrap_diagrams(self.source(svg))
        result = result.replace('<figure>', '<figure lang="zh-Hant">')
        soup = BeautifulSoup(_swap_inner_to_english(result), 'html.parser')
        self.assertEqual(soup.select_one('.hs-diagram-mode')['lang'], 'en')
        self.assertEqual(soup.summary.get_text(), 'Enlarge diagram')
        self.assertEqual(soup.svg.find_parent(attrs={'lang': True})['lang'], 'zh-Hant')
        self.assertEqual(soup.svg.text, '作者原有中文图表内容')

    def test_icons_and_script_strings_are_not_diagrams(self):
        source = self.source('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg><script>var example = "<svg><text>not a diagram</text></svg>";</script>')
        self.assertEqual(wrap_diagrams(source), source)

    def test_reading_controls_do_not_become_search_or_llm_article_prose(self):
        body = ('<h1>作者標題</h1><details class="hs-diagram-mode"><summary>放大圖表</summary>'
                '<p>介面操作提示內容需要排除，不能加入每篇文章的搜尋摘要及正文。</p></details>'
                '<p>作者正文保留診療限制與參考文獻。這裡代表本來存在的文章內容，不能因為排除操作提示而一起消失。</p>')
        parser = _TextExtractor()
        parser.feed(body)
        self.assertNotIn('介面操作提示', parser.text())
        self.assertIn('作者正文', parser.text())
        code = 'import sys,json;from _gen_search_index import extract_visible;print(json.dumps(extract_visible(sys.stdin.read()),ensure_ascii=False))'
        process = subprocess.run([sys.executable, '-X', 'utf8', '-c', code], input=body,
                                 capture_output=True, text=True, encoding='utf8', check=True)
        visible = json.loads(process.stdout)
        self.assertNotIn('介面操作提示', json.dumps(visible, ensure_ascii=False))
        self.assertIn('作者正文', json.dumps(visible, ensure_ascii=False))

    def test_invalid_diagram_geometry_fails_instead_of_dropping_content(self):
        for box in ('', '0 0 nan 300', '0 0 0 300', '0 0 600 -1'):
            with self.subTest(box=box), self.assertRaises(ValueError):
                wrap_diagrams(self.source(f'<svg viewBox="{box}"><text>必須保留</text></svg>'))


if __name__ == '__main__':
    unittest.main()
