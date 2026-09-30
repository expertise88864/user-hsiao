import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('telemetry_injector', ROOT / '_inject_speed_insights.py')
injector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(injector)


class TelemetryBootstrapTests(unittest.TestCase):
    def test_replaces_legacy_collectors_and_preserves_article_and_unrelated_script(self):
        unrelated = '<script>window.otherFeature=true;</script>'
        body = '<body><p data-zh="乾眼" data-en="Dry eye">乾眼</p></body>'
        source = ('<head><link href="/assets/app.css?v=20260673">' + unrelated +
                  '<script>gtag("config", "G-0ZKDQP9DNH");</script>' +
                  '<script async src="https://www.googletagmanager.com/gtag/js?id=G-0ZKDQP9DNH"></script>' +
                  '<script defer src="/_vercel/speed-insights/script.js"></script>\n</head>' + body)
        result, changed = injector.inject(source)
        self.assertTrue(changed)
        self.assertIn(unrelated, result)
        self.assertTrue(result.endswith(body))
        self.assertNotIn('gtag(', result)
        self.assertNotIn('/_vercel/speed-insights/script.js', result)
        self.assertEqual(result.count('/assets/telemetry.js?v=20260673'), 1)
        self.assertEqual(injector.inject(result), (result, False))
        # FAQ generation appends an inert script after this tag; normalization
        # must leave the tag in place without accumulating blank lines.
        faq = '<script type="application/ld+json">{"@type":"FAQPage"}</script>'
        with_faq = result.replace('</head>', faq + '</head>')
        self.assertEqual(injector.inject(with_faq), (with_faq, False))

    def test_current_article_without_ga4_gets_bootstrap_and_private_page_stays_untouched(self):
        source = '<head></head><body><script src="/blog/blog-shared.min.js?v=20260673"></script></body>'
        result, changed = injector.inject(source)
        self.assertTrue(changed)
        self.assertIn('/assets/telemetry.js?v=20260673', result)
        self.assertEqual(injector.inject(result), (result, False))
        private = '<head></head><body>Private admin login</body>'
        self.assertEqual(injector.inject(private), (private, False))
        malformed = '<body><script>gtag("config", "G-0ZKDQP9DNH")</script></body>'
        self.assertEqual(injector.inject(malformed), (malformed, False))

    def test_both_new_article_templates_use_shared_bootstrap(self):
        for path in ('api/admin/_new.js', 'new-article.py'):
            source = (ROOT / path).read_text(encoding='utf8')
            self.assertIn('/assets/telemetry.js', source, path)
            self.assertNotIn('googletagmanager.com/gtag/js', source, path)
            self.assertNotIn('/_vercel/speed-insights/script.js', source, path)


if __name__ == '__main__':
    unittest.main()
