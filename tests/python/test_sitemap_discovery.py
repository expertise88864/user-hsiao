import os
import runpy
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
NS = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9', 'x': 'http://www.w3.org/1999/xhtml'}


class SitemapDiscoveryTests(unittest.TestCase):
    def test_static_generator_submits_anatomy_tool_without_nonexistent_english_mirror(self):
        previous = Path.cwd()
        try:
            os.chdir(ROOT)
            generator = runpy.run_path(str(ROOT / '_gen_feeds.py'))
            xml = ET.fromstring(generator['build_sitemap']())
        finally:
            os.chdir(previous)
        url = 'https://hsiao.chendermatologist.com/tools/eye-3d'
        entries = [entry for entry in xml.findall('s:url', NS) if entry.findtext('s:loc', namespaces=NS) == url]
        self.assertEqual(len(entries), 1)
        alternates = {a.attrib['hreflang']: a.attrib['href'] for a in entries[0].findall('x:link', NS)}
        self.assertEqual(alternates, {'x-default': url, 'zh-Hant-TW': url})
        self.assertNotIn('https://hsiao.chendermatologist.com/en/tools/eye-3d', [entry.findtext('s:loc', namespaces=NS) for entry in xml.findall('s:url', NS)])


if __name__ == '__main__':
    unittest.main()
