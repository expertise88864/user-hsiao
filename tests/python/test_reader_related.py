import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _gen_related import score


class ReaderRelated(unittest.TestCase):
    def test_same_disease_beats_newer_same_format(self):
        source = dict(slug='glaucoma-comprehensive-guide', tag='青光眼', cat='alert')
        treatment = dict(slug='glaucoma-treatment-selection', tag='青光眼', cat='rx', date='2026-01-01')
        unrelated = dict(slug='lacrimal-gland-tumor', tag='淚腺腫瘤', cat='alert', date='2026-12-31')
        self.assertGreater(score(source, treatment)[0], score(source, unrelated)[0])

    def test_clinical_cluster_beats_format_and_scoring_has_no_random_state(self):
        source = dict(slug='pediatric-myopia-control', tag='兒童近視', cat='myth')
        research = dict(slug='monitoring-myopia-ser-vs-axial-length', tag='眼軸', cat='research')
        other = dict(slug='dry-eye-myths', tag='乾眼症', cat='myth')
        first = score(source, research)
        self.assertGreater(first[0], score(source, other)[0])
        for _ in range(100): score(source, other)
        self.assertEqual(first, score(source, research))
