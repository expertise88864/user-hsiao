"""Every public page must carry the homepage header and footer verbatim.

Owner decision 2026-10-17: index.html is the single source of truth for the
site chrome; _gen_site_chrome.py copies it onto every other page and the
English generator mirrors it into /en/. These tests fail on any drift.
Later that day the owner removed 量表 (/tools) from the header and the mobile
menu (「刪除頁首 右上角 量表」); the /tools page itself stays.
"""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('site_chrome', ROOT / '_gen_site_chrome.py')
chrome = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chrome)

HEADER_RE = re.compile(r'<header\b[^>]*>.*?</header>', re.S)
FOOTER_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
DISCLAIMER_ZH = ('本網站內容僅作為一般醫學教育與資訊參考，不構成個別醫療建議，亦不能取代面對面的問診、檢查與處方。'
                 '任何用藥、停藥、調整劑量或就醫決定，請以您的主治醫師判斷為準。')
DISCLAIMER_EN = ("This website is for general medical education and information only. It is not individual medical "
                 "advice and cannot replace an in-person consultation, examination or prescription. For any decision "
                 "to start, stop or adjust a medication, or to seek care, follow your treating physician's judgement.")


def read(path):
    return Path(path).read_text(encoding='utf-8').replace('\r\n', '\n')


def chrome_of(path):
    text = read(path)
    headers, footers = HEADER_RE.findall(text), FOOTER_RE.findall(text)
    return headers, footers


class HomepageChrome(unittest.TestCase):
    def setUp(self):
        self.header, self.footer = chrome.home_chrome(ROOT)

    def test_homepage_chrome_carries_the_owner_requested_content(self):
        for href, label in (('/blog', '衛教文章'), ('/exam', '眼科專科醫師考試'), ('/about', '關於我')):
            self.assertRegex(self.header, rf'<a href="{href}" [^>]*data-zh="{label}"[^>]*>{label}</a>')
        self.assertNotIn('/tools', self.header)
        self.assertNotIn('量表', self.header)
        self.assertIn('aria-label="搜尋"', self.header)
        self.assertIn('id="langToggle"', self.header)
        self.assertIn('class="mag-foot-disclaimer"', self.footer)
        self.assertIn(f'data-zh="{DISCLAIMER_ZH}"', self.footer)
        self.assertIn(f'data-en="{DISCLAIMER_EN}"', self.footer)
        self.assertIn(f'>{DISCLAIMER_ZH}</p>', self.footer)
        self.assertNotIn('本站不接受業配', self.footer)
        self.assertNotIn('No sponsorship', self.footer)

    def test_mobile_menu_has_no_tools_link(self):
        source = read(ROOT / 'blog' / 'blog-shared.js')
        start = source.index('DN.injectMobileMenu = function')
        menu = source[start:source.index('DN.injectFooterYear', start)]
        for href in ('/blog/', '/exam', '/about'):
            self.assertIn(f'<a href="{href}"', menu)
        self.assertNotIn('/tools', menu)
        self.assertNotIn('量表', menu)
        self.assertTrue((ROOT / 'tools.html').exists(), 'only the header link goes; the page stays')

    def test_no_page_header_links_to_tools(self):
        for path in [*chrome.pages(ROOT), ROOT / 'index.html', *sorted((ROOT / 'en').glob('**/*.html'))]:
            headers, _ = chrome_of(path)
            with self.subTest(page=path.relative_to(ROOT).as_posix()):
                self.assertTrue(headers)
                self.assertFalse(any('/tools' in h or '量表' in h for h in headers))

    def test_every_page_uses_the_homepage_header_and_footer(self):
        pages = chrome.pages(ROOT)
        self.assertGreater(len(pages), 200)
        for path in pages:
            rel = path.relative_to(ROOT).as_posix()
            headers, footers = chrome_of(path)
            with self.subTest(page=rel):
                self.assertEqual(headers, [self.header])
                self.assertEqual(footers, [self.footer])

    def test_english_pages_use_the_english_homepage_chrome(self):
        en_header, en_footer = (found[0] for found in chrome_of(ROOT / 'en' / 'index.html'))
        pages = sorted((ROOT / 'en').glob('**/*.html'))
        self.assertGreater(len(pages), 20)
        for path in pages:
            rel = path.relative_to(ROOT).as_posix()
            headers, footers = chrome_of(path)
            with self.subTest(page=rel):
                self.assertEqual(headers, [en_header])
                self.assertEqual(footers, [en_footer])

    def test_new_article_templates_start_with_the_homepage_chrome(self):
        for rel in ('api/admin/_new.js', 'new-article.py'):
            text = read(ROOT / rel)
            with self.subTest(template=rel):
                self.assertEqual(HEADER_RE.findall(text), [self.header])
                self.assertEqual(FOOTER_RE.findall(text), [self.footer])

    def test_generator_is_idempotent_and_adds_a_missing_footer(self):
        page = '<body>\n<header class="old">x</header>\n<main>m</main>\n</body>\n'
        once = chrome.apply(page, self.header, self.footer)
        self.assertEqual(chrome.apply(once, self.header, self.footer), once)
        self.assertEqual(HEADER_RE.findall(once), [self.header])
        self.assertEqual(FOOTER_RE.findall(once), [self.footer])
        self.assertLess(once.index('</main>'), once.index('<footer'))
        crlf = page.replace('\n', '\r\n')
        self.assertEqual(chrome.apply(crlf, self.header, self.footer), once.replace('\n', '\r\n'))
        with self.assertRaises(ValueError):
            chrome.apply('<main>no header</main>', self.header, self.footer)


if __name__ == '__main__':
    unittest.main()
