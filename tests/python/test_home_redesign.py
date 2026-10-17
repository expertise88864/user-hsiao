"""Owner requests 2026-10-17 (homepage redesign round).

1. 「刪除頁首 右上角 量表」 — covered by test_site_chrome.py.
2. 「刪除所有文章內 首頁 關於我..等頁面的醫療免責聲明」 — the footer on every page
   carries the disclaimer; no page body repeats a disclaimer block. Article
   notes that carry red-flag, medication-safety, conflict-of-interest or
   study-limitation sentences stay, without a 免責聲明 label.
3. 「刪除首頁 閱讀進度」 — no reading-progress widget on the homepage.
4. 「支持作者的欄位 刪除emoji」 — monochrome SVG icon, no emoji.
5. Homepage like chendermatologist.com: one 「快速查找眼科主題」 hub (search box
   with live count, 全部主題 + category chips, topic group cards) generated
   from the article cards, then the 最新文章 bento grid with the pinned exam
   card first, then pill links. No 熱門推薦 section (owner follow-up).
"""
import re
import unittest
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup

import _gen_blog_filter as gen

ROOT = Path(__file__).resolve().parents[2]
FOOTER_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
FOOTER_DISCLAIMER = '本網站內容僅作為一般醫學教育與資訊參考，不構成個別醫療建議'
# Generic disclaimer boilerplate that must not appear in a page body any more.
BOILERPLATE = ('免責聲明', '醫療免責', '非個別醫療建議', '本網站內容僅作為', '本站所有內容僅作為',
               '不能取代個別醫療建議', '僅供認識疾病用', '本站不從事醫療廣告', '本文不推薦任何特定',
               '僅作為一般教育用途', '本網站不保證結果',
               'Disclaimer', 'Medical disclaimer', 'not individual medical advice',
               'not individualized medical advice', 'for general education only')
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿⬀-⯿️]')


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def body_without_footer(html):
    body = html.split('<body', 1)[1]
    body = FOOTER_RE.sub('', body)
    return re.sub(r'<(script|style)\b.*?</\1>', '', body, flags=re.S)


def public_pages():
    pages = ['index.html', 'about.html', 'tools.html', 'notes.html', 'blog/index.html', 'blog/topics.html',
             'exam/index.html', *[p.relative_to(ROOT).as_posix() for p in sorted((ROOT / 'blog').glob('*.html'))]]
    pages += ['en/' + p for p in pages if (ROOT / 'en' / p).exists()]
    return sorted(set(pages))


class DisclaimerTests(unittest.TestCase):
    def test_no_disclaimer_block_in_any_page_body(self):
        pages = public_pages()
        self.assertGreater(len(pages), 50)
        for rel in pages:
            html = read(rel)
            body = body_without_footer(html)
            with self.subTest(page=rel):
                for phrase in BOILERPLATE:
                    self.assertNotIn(phrase, body)
                self.assertNotRegex(body, r'class="[^"]*\bdisclaimer(?:-box)?\b')
                footer = FOOTER_RE.findall(html)
                self.assertEqual(len(footer), 1)
                self.assertIn('class="mag-foot-disclaimer"', footer[0])

    def test_footer_still_carries_the_disclaimer(self):
        self.assertIn(FOOTER_DISCLAIMER, FOOTER_RE.search(read('index.html')).group(0))

    def test_kept_article_notes_are_specific_not_boilerplate(self):
        notes = {}
        for path in sorted((ROOT / 'blog').glob('*.html')):
            for note in BeautifulSoup(path.read_text(encoding='utf-8'), 'html.parser').select('.hs-article-note'):
                notes[path.stem] = note
        # Red-flag and medication-safety sentences survive the clean-up.
        self.assertIn('急性閉角型發作', notes['glaucoma-comprehensive-guide'].get_text())
        self.assertIn('視神經病變', notes['thyroid-eye-disease'].get_text())
        self.assertIn('撥打 119', notes['ophthalmic-trauma-overlooked-burden'].get_text())
        self.assertIn('請勿自行停藥', notes['refractory-noninfectious-uveitis-biologics-rubi-trial'].get_text())
        for slug, note in notes.items():
            with self.subTest(slug=slug):
                self.assertTrue(note.get('data-zh') and note.get('data-en'))
                self.assertFalse(EMOJI.search(note.get_text()))
        self.assertNotIn('.disclaimer', read('assets/article.css'))

    def test_article_runtime_injects_no_disclaimer(self):
        js = read('blog/blog-shared.js')
        self.assertNotIn('ARTICLE_DISCLAIMER', js)
        start = js.index('DN.injectAuthorBio = function')
        bio = js[start:js.index('};', start)]
        self.assertNotIn('data-zh', bio)
        self.assertIn("textContent = ''", bio)


class ReadProgressTests(unittest.TestCase):
    def test_homepage_has_no_reading_progress_widget(self):
        for rel in ('index.html', 'en/index.html'):
            body = re.sub(r'<!--.*?-->', '', body_without_footer(read(rel)), flags=re.S)
            with self.subTest(page=rel):
                self.assertNotIn('hs-read-progress', body)
                self.assertNotIn('閱讀進度', body)
                self.assertNotIn('Reading progress', body)
        js = read('blog/blog-shared.js')
        self.assertNotIn('injectReadProgress', js)
        self.assertNotIn('hs-read-progress', js)

    def test_article_reading_progress_bar_stays(self):
        self.assertIn('DN.addReadingProgress = function', read('blog/blog-shared.js'))


class SupportSectionTests(unittest.TestCase):
    def test_homepage_support_section_has_no_emoji(self):
        for rel in ('index.html', 'en/index.html'):
            section = BeautifulSoup(read(rel), 'html.parser').select_one('#hs-support-section')
            with self.subTest(page=rel):
                self.assertIsNotNone(section)
                self.assertFalse(EMOJI.search(str(section)))
                icon = section.select_one('.support-icon svg')
                self.assertIsNotNone(icon)
                self.assertEqual(icon.get('stroke'), 'currentColor')
                self.assertTrue(section.select_one('a.hs-kofi-btn[href^="https://ko-fi.com/"]'))

    def test_article_support_card_has_no_emoji(self):
        js = read('blog/blog-shared.js')
        start = js.index('DN.injectArticleSupport = function')
        support = js[start:js.index('// ---------- share toolbar', start)]
        self.assertFalse(EMOJI.search(support))
        self.assertIn('DN.SUPPORT_ICON', support)
        self.assertFalse(EMOJI.search(js[js.index('DN.SUPPORT_ICON ='):js.index('DN.SUPPORT_ICON =') + 600]))
        self.assertNotIn('_kofiButtonHTML', js)


class HomepageHubTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read('index.html')
        cls.doc = BeautifulSoup(cls.source, 'html.parser')
        cls.cards = cls.doc.select('#hs-article-list .article-list-item')

    def test_hub_is_generated_and_a_fixed_point(self):
        text = self.source.replace('\r\n', '\n')
        self.assertEqual(gen.render_home_hub(text), text)
        with self.assertRaises(ValueError):
            gen.render_home_hub(text.replace(gen.HOME_START, '', 1))

    def test_order_hero_hub_articles_faq(self):
        main = str(self.doc.select_one('main'))
        marks = ['class="mag-hero"', 'id="hs-hub"', 'id="articles"', 'class="action-row"', 'class="home-faq', 'id="hs-support-section"']
        at = [main.index(m) for m in marks]
        self.assertEqual(at, sorted(at))
        heads = [h.name for h in self.doc.select('main h1, main h2, main h3')]
        self.assertEqual(heads[0], 'h1')
        for prev, cur in zip(heads, heads[1:]):
            self.assertLessEqual(int(cur[1]) - int(prev[1]), 1, heads)

    def test_one_search_box_with_live_status(self):
        hub = self.doc.select_one('#hs-hub')
        fields = hub.select('input')
        self.assertEqual([f['id'] for f in fields], ['hs-search-input'])
        field = fields[0]
        self.assertEqual(field['aria-describedby'], 'hs-hub-status')
        self.assertTrue(field.get('data-en-aria-label') and field.get('data-en-placeholder'))
        status = hub.select_one('#hs-hub-status')
        self.assertEqual((status['role'], status['aria-live']), ('status', 'polite'))
        self.assertEqual(status.get_text(), f'最新 {gen.HOME_CAP} 篇・共 {len(self.cards)} 篇文章')
        form = hub.select_one('form#hs-hub-search')
        self.assertEqual((form['action'], form['method'], form['role']), ('/blog', 'get', 'search'))
        # The old second find-articles UI is gone.
        for old in ('qf-', 'quick-find', 'id="qf-all-btn"', '全部文章</button>'):
            self.assertNotIn(old, str(self.doc.select_one('main')))

    def test_chip_counts_match_the_article_cards(self):
        hub = self.doc.select_one('#hs-hub')
        everything = hub.select_one('[data-hub-all]')
        self.assertEqual(everything['aria-pressed'], 'true')
        self.assertEqual(everything.select_one('.hub-n').get_text(), str(len(self.cards)))
        cats = Counter(next(c[4:] for c in card.select_one('.chip[class*="cat-"]')['class'] if c.startswith('cat-'))
                       for card in self.cards)
        for chip in hub.select('[data-hub-cat]'):
            self.assertEqual(int(chip.select_one('.hub-n').get_text()), cats[chip['data-hub-cat']])
        topics = Counter(card.select_one('.chip.tag')['data-zh'] for card in self.cards)
        chips = hub.select('[data-hub-topic]')
        self.assertEqual(sorted(c['data-hub-topic'] for c in chips), sorted(topics))
        for chip in chips:
            self.assertEqual(int(chip.select_one('.hub-n').get_text()), topics[chip['data-hub-topic']])
        for chip in hub.select('.hub-chip'):
            self.assertEqual(chip.get('type'), 'button')
            self.assertIn(chip['aria-pressed'], ('true', 'false'))
            for span in chip.select('[data-zh]'):
                self.assertTrue(span.get('data-en'))

    def test_topic_group_cards(self):
        cards = self.doc.select('#hs-hub .hub-card')
        titles = [c.h3.get_text() for c in cards]
        for group in ('青光眼', '白內障', '視網膜與黃斑部', '角膜與乾眼', '兒童眼科與近視', '眼整形與眼眶', '葡萄膜炎'):
            self.assertIn(group, titles)
        for card in cards:
            self.assertEqual(card['aria-labelledby'], card.h3['id'])
            self.assertTrue(card.select('[data-hub-topic]'))
            self.assertTrue(card.h3.get('data-en'))

    def test_unknown_topics_land_in_other_topics(self):
        text = self.source.replace('\r\n', '\n').replace('<span class="chip tag" data-zh="眼外傷" data-en="Eye trauma">', '<span class="chip tag" data-zh="新主題" data-en="New topic">', 1)
        doc = BeautifulSoup(gen.render_home_hub(text), 'html.parser')
        self.assertNotIn('data-hub-topic="眼外傷"', str(doc.select_one('#hs-hub')))
        other = [c for c in doc.select('#hs-hub .hub-card') if c.h3.get_text() == '其他主題']
        self.assertEqual(len(other), 1)
        self.assertTrue(other[0].select_one('[data-hub-topic="新主題"]'))

    def test_pinned_card_first_with_icon_then_articles(self):
        items = self.doc.select_one('#hs-article-list').find_all(recursive=False)
        self.assertIn('hs-pin-card', items[0]['class'])
        icon = items[0].select_one('.al-icon svg')
        self.assertIsNotNone(icon)
        self.assertEqual(items[0].select_one('.al-icon')['aria-hidden'], 'true')
        self.assertTrue(all('article-list-item' in i['class'] for i in items[1:]))
        dates = [i.time.get_text() for i in items[1:]]
        self.assertEqual(dates, sorted(dates, reverse=True), 'static order = newest first (feature card without JS)')
        for item in items:
            self.assertEqual(item.select_one('.al-arrow')['aria-hidden'], 'true')

    def test_grid_css_caps_five_and_makes_the_newest_the_feature_card(self):
        css = self.source
        self.assertIn('#hs-article-list:not(.is-filtered) > .article-list-item:nth-of-type(n+7)', css)
        self.assertIn('#hs-article-list:not(.is-filtered) > .hs-pin-card + .article-list-item{ grid-row:span 2;', css)
        self.assertIn('grid-template-columns:1.3fr 1fr', css)
        js = read('blog/blog-shared.js')
        self.assertIn('DN.HOME_CAP = 5;', js)
        self.assertEqual(gen.HOME_CAP, 5)
        self.assertIn("safeCall('bindHomeHub'", js)
        self.assertNotIn('DN.bindHomeSearch', js)

    def test_pill_links_point_to_existing_pages_and_no_popular_section(self):
        pills = self.doc.select('#articles .action-row a')
        self.assertEqual([a['href'] for a in pills], ['/blog', '/blog/topics', '/notes'])
        for a in pills:
            self.assertTrue(a.get('data-en'))
        main = str(self.doc.select_one('main'))
        self.assertNotIn('熱門推薦', re.sub(r'<!--.*?-->', '', main, flags=re.S))
        for mount in ('hs-popular-list', 'hs-recent-list', 'dn-spotlight'):
            self.assertNotIn(f'id="{mount}"', main)

    def test_english_mirror(self):
        doc = BeautifulSoup(read('en/index.html'), 'html.parser')
        hub = doc.select_one('#hs-hub')
        self.assertEqual(hub.select_one('#hs-hub-title').get_text(), 'Find articles by topic')
        self.assertEqual(hub.select_one('#hs-hub-status').get_text(), f'Latest {gen.HOME_CAP} of {len(self.cards)} articles')
        self.assertEqual(hub.select_one('form')['action'], '/en/blog')
        self.assertFalse(re.search(r'[一-鿿]', hub.get_text()))


if __name__ == '__main__':
    unittest.main()
