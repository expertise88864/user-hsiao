from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _extract_critical_css as critical


class SummaryCriticalCss(unittest.TestCase):
    def test_actual_summary_rules_keep_both_local_faces_for_first_paint(self):
        result = critical.build_critical_css((ROOT / 'assets/app.css').read_text(encoding='utf-8'))
        self.assertEqual(result.count('@font-face{'), 2)
        self.assertIn('local("Liberation Sans")', result)
        self.assertIn('local("Liberation Sans Bold")', result)
        self.assertIn('main > section > .max-w-3xl > .tldr{font-family:Inter,"Hsiao Summary Fallback"', result)
        self.assertIn('size-adjust:108.17083353799302%', result)
        self.assertIn('ascent-override:93.29464184356908%', result)

    def test_unrelated_or_remote_fonts_are_not_inlined(self):
        for body in [
            'font-family:"Other";src:local("Arial");',
            'font-family:"Hsiao Summary Fallback";src:url("remote.woff2");',
            'font-family:"Hsiao Summary Fallback";src:local("Arial"),url("remote.woff2");',
            'font-family:"Hsiao Summary Fallback";src:local("Arial");src:url("remote.woff2");',
            'font-family:"Hsiao Summary Fallback";font-family:"Other";src:local("Arial");',
            'font-family:"Hsiao Summary Fallback";',
        ]:
            with self.subTest(body=body):
                self.assertEqual(critical.build_critical_css('@font-face{' + body + '}'), '')

    def test_media_and_supports_keep_their_conditions(self):
        result = critical.build_critical_css(
            '@media (min-width:640px){main .tldr{padding:1px}.noncritical{color:red}}'
            '@supports (font-size-adjust:ic-width 1){main h1{font-size-adjust:ic-width 1}}')
        self.assertIn('@media (min-width:640px){main .tldr{padding:1px}}', result)
        self.assertIn('@supports (font-size-adjust:ic-width 1){main h1{font-size-adjust:ic-width 1}}', result)
        self.assertNotIn('.noncritical', result)

    def test_regeneration_updates_one_inline_block_and_reaches_fixed_point(self):
        source = '<head><link rel="stylesheet" href="/assets/app.css?v=1"><style data-critical-css>old</style></head>'
        updated, changed = critical.patch_html(source, '@font-face{font-family:"Hsiao Summary Fallback"}')
        self.assertTrue(changed)
        self.assertEqual(updated.count('data-critical-css'), 1)
        self.assertEqual(critical.patch_html(updated, '@font-face{font-family:"Hsiao Summary Fallback"}'), (updated, False))
        self.assertIn('href="/assets/app.css?v=1"', updated)


if __name__ == '__main__':
    unittest.main()
