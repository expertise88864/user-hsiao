from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _gen_llms_full_txt import _TextExtractor


def extract(source):
    parser = _TextExtractor()
    parser.feed(source)
    parser.close()
    return parser.text()


class LlmReaderHintTests(unittest.TestCase):
    def test_generated_hint_subtree_is_excluded_without_losing_table_or_prose(self):
        source = ('<p>作者正文</p><p class="note hs-table-hint">操作提示'
                  '<span>鍵盤<strong>指示</strong></span><br>補充</p>'
                  '<div class="hs-table-scroll"><table><tr><th>欄名</th>'
                  '<td>作者資料</td></tr></table></div><p>後續作者段落</p>'
                  '<p class="hs-table-hint-extra">保留其他類別</p>'
                  '<p>作者正文提及操作提示</p>')
        expected = extract(source.replace('<p class="note hs-table-hint">操作提示'
                                         '<span>鍵盤<strong>指示</strong></span><br>補充</p>', ''))
        self.assertEqual(extract(source), expected)
        self.assertIn('欄名', expected)
        self.assertIn('作者資料', expected)
        self.assertIn('後續作者段落', expected)
        self.assertIn('保留其他類別', expected)
        self.assertIn('作者正文提及操作提示', expected)

    def test_hint_in_skipped_tree_and_self_closing_hint_do_not_hide_later_prose(self):
        source = ('<svg><foreignObject><p class="hs-table-hint">隱藏提示</p></foreignObject></svg>'
                  '<p class="hs-table-hint"/><p>保留正文</p>')
        self.assertEqual(extract(source), '保留正文')


if __name__ == '__main__':
    unittest.main()
