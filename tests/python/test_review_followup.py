from copy import deepcopy
from pathlib import Path
import sys, unittest
from unittest.mock import patch
from bs4 import BeautifulSoup
from html import unescape
import json

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _check_home_schema as home
from _gen_llms_full_txt import _TextExtractor
from _gen_faqpage_jsonld import extract_faqs, has_manual_faqpage

class ReviewFollowup(unittest.TestCase):
    def test_author_school_is_allowed_but_public_employer_schema_is_rejected(self):
        arguments = ('index.html', home.WEBSITE_ID, home.DOMAIN + '/', home.WEBPAGE_ID,
                     home.DOMAIN + '/about', home.DOMAIN + '/about#profilepage')
        actual = home.jsonld_blocks('index.html')
        person = home.find_block(actual, 'Physician')
        self.assertIn('alumniOf', person)
        with patch.object(home, 'jsonld_blocks', return_value=actual):
            self.assertEqual(home.audit_home(*arguments), [])
        changed = deepcopy(actual)
        home.find_block(changed, 'Physician')['worksFor'] = {'@type':'MedicalOrganization','name':'Fixture employer'}
        with patch.object(home, 'jsonld_blocks', return_value=changed):
            self.assertTrue(any('D-08' in error for error in home.audit_home(*arguments)))

    def test_native_question_containers_preserve_export_paragraphs(self):
        texts = []
        for source in ['<div><div>原有問題？</div><div>原有答案與 100 µg 資料。</div></div>',
                       '<details open><summary>原有問題？</summary><div>原有答案與 100 µg 資料。</div></details>']:
            parser = _TextExtractor(); parser.feed(source); texts.append(parser.text())
        self.assertEqual(texts[0], texts[1])

    def test_automatic_faq_answers_match_existing_visible_questions(self):
        for slug in ['thyroid-eye-disease', 'toric-iol-astigmatism-cataract-review']:
            source = (ROOT / 'blog' / (slug + '.html')).read_text(encoding='utf-8')
            self.assertFalse(has_manual_faqpage(source))
            soup = BeautifulSoup(source, 'html.parser')
            script = soup.select_one('script[data-faq-auto]')
            schema = json.loads(script.string)
            expected = extract_faqs(source)
            actual = [{'q':row['name'],'a':row['acceptedAnswer']['text']} for row in schema['mainEntity']]
            self.assertEqual(actual, expected)
            self.assertGreater(len(actual), 0)
            self.assertTrue(all('open' in tag.attrs for tag in soup.select('details.myth-card')))

    def test_english_privacy_body_is_translated_and_cookie_example_is_text(self):
        source = (ROOT / 'en/privacy.html').read_text(encoding='utf-8')
        soup = BeautifulSoup(source, 'html.parser')
        prose = soup.select_one('article .prose')
        self.assertIsNone(prose.find('id'))
        self.assertIn('_ga_<ID>', prose.get_text())
        self.assertIn('SEARCH_LOG_ENABLED=1', prose.get_text())
        self.assertIn('1,000', prose.get_text())
        self.assertIn('does not delete data already sent', prose.get_text())
        self.assertNotRegex(prose.get_text(), r'[\u4e00-\u9fff]')

    def test_pediatric_trial_outcomes_and_faq_do_not_reintroduce_superseded_claims(self):
        # Owner-approved corrections: endpoints, denominators and case-report year
        # must survive translation and FAQ generation, not just the visible paragraph.
        for locale in ['blog', 'en/blog']:
            source=(ROOT / locale / 'pediatric-myopia-control.html').read_text(encoding='utf-8')
            soup=BeautifulSoup(source,'html.parser')
            visible=soup.get_text(' ',strip=True)
            self.assertNotRegex(visible,r'69\s*(?:至|to|[–-])\s*88|Many ophthalmologists now start|多數眼科醫師現在會從')
            self.assertIn('+0.13',visible); self.assertIn('+0.38',visible)
            self.assertIn('−0.20',visible); self.assertIn('−0.79',visible)
            self.assertIn('264',visible); self.assertIn('246',visible)
            self.assertIn('52%',visible); self.assertIn('62%',visible)
            self.assertIn('0.077%',visible); self.assertIn('0.139%',visible)
            self.assertIn('2023',visible); self.assertIn('10.1001/jamaophthalmol.2023.1548',source)
            # English mirrors intentionally omit the canonical-only FAQPage.
            # Check its visible translated answer separately from the ZH schema.
            if locale=='blog':
                faqs=extract_faqs(source)
                schema=json.loads(soup.select_one('script[data-faq-auto]').string)
                self.assertEqual([{'q':r['name'],'a':r['acceptedAnswer']['text']} for r in schema['mainEntity']],faqs)
            else:
                self.assertIn('not one combined efficacy rate',visible)

    def test_recurrence_comparisons_and_hzo_denominators_remain_explicit(self):
        for locale in ['blog','en/blog']:
            p=BeautifulSoup((ROOT / locale / 'pterygium-surgery-fixation-methods-2026-nma.html').read_text(encoding='utf-8'),'html.parser')
            comparisons=[row.get_text(' ',strip=True) for row in p.select('tr')]
            self.assertTrue(any('FG vs Vicryl' in r and '0.39' in r and '0.69' in r for r in comparisons))
            self.assertTrue(any('FG vs Nylon' in r and '0.38' in r and '0.82' in r for r in comparisons))
            self.assertTrue(any('0.52' in r and '0.96' in r for r in comparisons))
            h=(ROOT / locale / 'hzo-stromal-keratitis-zeds-lessons.html').read_text(encoding='utf-8')
            self.assertNotIn('3 個月最危險',h)
            self.assertNotIn('Highest relapse risk',h)
            text=BeautifulSoup(h,'html.parser').get_text(' ',strip=True)
            self.assertIn('18',text); self.assertIn('48',text); self.assertIn('11/105',text)
            if locale.startswith('en'):
                self.assertIn('not the recurrence rate',text)

    def test_selenium_formulation_and_references_are_not_crossed_with_cataract(self):
        for locale in ['blog','en/blog']:
            ted=(ROOT / locale / 'thyroid-eye-disease.html').read_text(encoding='utf-8')
            text=BeautifulSoup(ted,'html.parser').get_text(' ',strip=True)
            self.assertIn('91.2',text); self.assertIn('100',text)
            self.assertNotIn('CATCH',text); self.assertNotIn('H05.2',ted)
            self.assertIn('H06.2',ted)
            cataract=(ROOT / locale / 'cataract-comprehensive-guide.html').read_text(encoding='utf-8')
            self.assertIn('CD009493',cataract); self.assertIn('CD004567',cataract)
            self.assertNotIn('NEJMoa1012985',cataract)

    def test_tool_landing_describes_custom_six_questions_without_osdi_grading(self):
        for path in ['tools.html','en/tools.html']:
            soup=BeautifulSoup((ROOT/path).read_text(encoding='utf-8'),'html.parser')
            text=soup.get_text(' ',strip=True)
            self.assertNotIn('OSDI / DEQ-5 / SE',text)
            self.assertNotIn('5 clinical scales',text)
            self.assertIn('12',text)

    def test_hzo_conclusion_and_export_do_not_reintroduce_the_rejected_treatment_inference(self):
        for path in ['blog/hzo-stromal-keratitis-zeds-lessons.html',
                     'en/blog/hzo-stromal-keratitis-zeds-lessons.html', 'llms-full.txt']:
            text=(ROOT/path).read_text(encoding='utf-8')
            self.assertNotIn('口服抗病毒藥多半不必要',text)
            self.assertNotIn('Oral antiviral is rarely needed',text)
            self.assertNotIn('90% of SK relapses are controlled by steroid adjustment alone',text)
            self.assertNotIn('SK 復發 90% 可單靠調整類固醇處理',text)

    def test_custom_symptom_tool_schema_and_share_metadata_match_its_visible_contract(self):
        def objects(value):
            if isinstance(value,list):
                for item in value: yield from objects(item)
            elif isinstance(value,dict):
                yield value
                for item in value.values(): yield from objects(item)
        for path in ['tools.html','en/tools.html']:
            soup=BeautifulSoup((ROOT/path).read_text(encoding='utf-8'),'html.parser')
            schema=[item for tag in soup.select('script[type="application/ld+json"]')
                    for item in objects(json.loads(tag.string))]
            custom=next(item for item in schema if str(item.get('@id','')).endswith('/tools#osdi'))
            self.assertEqual(custom['@type'],'SoftwareApplication')
            self.assertNotIn('OSDI',custom['name'])
            self.assertNotRegex(custom['description'],r'0-100|13-22|23-32|≥33')
            listing=next(item for item in schema if item.get('@type')=='ItemList')
            self.assertNotIn('OSDI',listing['itemListElement'][0]['name'])
            self.assertTrue(listing['itemListElement'][0]['url'].endswith('/tools#osdi'))
            for selector in ['meta[name="description"]','meta[property="og:description"]',
                             'meta[name="twitter:description"]']:
                description=soup.select_one(selector)['content']
                self.assertNotIn('分級解讀',description)
                self.assertNotIn('tools: OSDI',description)
                self.assertTrue('六題' in description or 'six' in description)

    def test_selenium_faq_names_the_approved_formulation_and_elemental_equivalence(self):
        for locale in ['blog','en/blog']:
            soup=BeautifulSoup((ROOT/locale/'thyroid-eye-disease.html').read_text(encoding='utf-8'),'html.parser')
            answer=soup.select('details.myth-card')[3].get_text(' ',strip=True)
            self.assertIn('sodium selenite',answer)
            self.assertIn('91.2',answer)

    def test_floater_negative_diopter_operators_preserve_the_existing_threshold_meaning(self):
        for locale in ['blog','en/blog']:
            source=unescape((ROOT/locale/'floaters-retinal-detachment.html').read_text(encoding='utf-8'))
            self.assertNotIn('≥ -5.00 D',source)
            self.assertNotIn('≥ −5.00 D',source)
            self.assertNotIn('(>−5.00 D)',source)
            self.assertIn('≤ −5.00 D',source)
