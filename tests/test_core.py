"""Offline tests for parsing, scoring, abstracts, and duplicate merging."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from paperatlas.normalize import dedup_records, record_from_work
from paperatlas.parse import parse_query
from paperatlas.score import RELEVANCE_WEIGHTS, score_relevance
from paperatlas.textutil import reconstruct_abstract, tokenize

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class ParseTests(unittest.TestCase):
    def test_cases(self):
        cases = json.loads((FIXTURES / "parse_cases.json").read_text(encoding="utf-8"))
        for case in cases:
            parsed = parse_query(case["q"])
            self.assertEqual(parsed["kind"], case["kind"], case["q"])
            self.assertEqual(parsed["value"], case["value"], case["q"])


class ScoreTests(unittest.TestCase):
    def test_weights_match_fixture(self):
        weights = json.loads((FIXTURES / "weights.json").read_text(encoding="utf-8"))
        self.assertEqual(weights, RELEVANCE_WEIGHTS)

    def test_components(self):
        center = {
            "id": "S",
            "title": "attention is all you need",
            "abstract": None,
            "referenced_works": ["A", "B", "C", "D"],
            "topic_ids": ["T1", "T2"],
            "related_works": [],
        }
        paper = {
            "id": "P",
            "title": "attention is all you need for speech",
            "abstract": None,
            "referenced_works": ["A", "B", "E"],
            "topic_ids": ["T1"],
            "related_works": ["P"],
        }
        scored = score_relevance(paper, center, coco_score=0.25, coco_available=True)
        self.assertEqual(scored["parts"]["direct"], 0)
        self.assertEqual(scored["parts"]["coupling"], 0.4)
        self.assertEqual(scored["parts"]["topic"], 0.5)
        self.assertEqual(scored["parts"]["related"], 0)
        self.assertAlmostEqual(scored["parts"]["cocitation"], 0.25)
        text = scored["parts"]["text"]
        self.assertGreater(text, 0.8)
        expected = (
            0.30 * 0
            + 0.26 * 0.4
            + 0.16 * 0.25
            + 0.14 * 0.5
            + 0.10 * text
            + 0.04 * 0
        )
        self.assertAlmostEqual(scored["score"], round(min(1, expected), 4), places=4)

    def test_seed_is_one(self):
        paper = {"id": "S", "title": "x", "referenced_works": [], "topic_ids": [], "related_works": []}
        scored = score_relevance(paper, paper, coco_score=0, coco_available=True)
        self.assertEqual(scored["score"], 1)


class TextTests(unittest.TestCase):
    def test_inverted_abstract(self):
        text = reconstruct_abstract({"hello": [0], "world": [1], "again": [2]})
        self.assertEqual(text, "hello world again")

    def test_title_is_weighted(self):
        counts = tokenize("attention model", None)
        self.assertEqual(counts["attention"], 2)
        self.assertNotIn("is", tokenize("attention is all you need", None))


class DedupTests(unittest.TestCase):
    def test_preprint_and_conference_merge(self):
        arxiv = record_from_work(
            {
                "id": "https://openalex.org/W1",
                "display_name": "BERT: Pre-training of Deep Bidirectional Transformers",
                "publication_year": 2018,
                "type": "preprint",
                "cited_by_count": 80000,
                "doi": "https://doi.org/10.48550/arxiv.1810.04805",
                "ids": {"arxiv": "1810.04805"},
                "open_access": {"oa_url": "https://arxiv.org/pdf/1810.04805"},
                "primary_location": {
                    "landing_page_url": "https://arxiv.org/abs/1810.04805",
                    "pdf_url": "https://arxiv.org/pdf/1810.04805",
                    "source": {"display_name": "arXiv (Cornell University)", "type": "repository"},
                },
                "topics": [{"id": "https://openalex.org/T1", "display_name": "NLP"}],
                "authorships": [{"author": {"display_name": "Jacob Devlin"}}],
                "referenced_works": ["https://openalex.org/W9"],
                "related_works": [],
            },
            2026,
        )
        conference = record_from_work(
            {
                "id": "https://openalex.org/W2",
                "display_name": "BERT: Pre-training of Deep Bidirectional Transformers",
                "publication_year": 2019,
                "type": "article",
                "cited_by_count": 100000,
                "doi": "https://doi.org/10.18653/v1/n19-1423",
                "primary_location": {
                    "is_published": True,
                    "source": {
                        "display_name": "Conference of the North American Chapter (NAACL)",
                        "type": "conference",
                    },
                },
                "topics": [],
                "authorships": [
                    {"author": {"display_name": "Jacob Devlin"}},
                    {"author": {"display_name": "Ming-Wei Chang"}},
                ],
                "referenced_works": ["https://openalex.org/W9", "https://openalex.org/W8"],
                "related_works": [],
            },
            2026,
        )
        arxiv["origin_tags"] = ["citing"]
        conference["origin_tags"] = ["citing"]
        merged = dedup_records([arxiv, conference], {"S"}, 2026)
        self.assertEqual(len(merged), 1)
        record = merged[0]
        self.assertEqual(record["id"], "W2")
        self.assertEqual(record["cited_by_count"], 100000)
        self.assertEqual(record["venue_short"], "NAACL")
        self.assertEqual(record["arxiv_id"], "1810.04805")
        self.assertIn("W9", record["referenced_works"])
        self.assertIn("W8", record["referenced_works"])
        self.assertEqual(record["author_string"], "Jacob Devlin, Ming-Wei Chang")


if __name__ == "__main__":
    unittest.main()
