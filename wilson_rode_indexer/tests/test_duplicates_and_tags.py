"""Tests for duplicate detection, issue tagging, and priority scoring."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
import yaml

from src.duplicates import (
    DuplicateMethod,
    build_exact_binary_groups,
    build_near_duplicate_groups,
    build_text_groups,
    connected_components,
    find_near_duplicates,
    hamming_distance,
    normalize_text,
    simhash,
    text_fingerprint,
)
from src.issue_tags import compile_terms, score_document, tag_document

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class TestNormalization:
    """Normalisation must erase cosmetic differences, not substance."""

    def test_strips_bates_stamps(self) -> None:
        left = normalize_text("WILSONRODE000001 The quick brown fox")
        right = normalize_text("WILSONRODE000999 The quick brown fox")
        assert left == right

    def test_collapses_whitespace_and_case(self) -> None:
        assert normalize_text("Hello   WORLD\n\nthere") == "hello world there"

    def test_different_substance_stays_different(self) -> None:
        assert normalize_text("alpha text") != normalize_text("beta text")


class TestHashing:
    """Exact-duplicate hashing."""

    def test_identical_text_same_fingerprint(self) -> None:
        assert text_fingerprint(normalize_text("A B C")) == text_fingerprint(
            normalize_text("a   b\nc")
        )

    def test_binary_groups_require_two_members(self) -> None:
        digest = hashlib.sha256(b"same").hexdigest()
        rows = [
            {"id": 1, "sha256": digest, "rel_path": "b.pdf"},
            {"id": 2, "sha256": digest, "rel_path": "a.pdf"},
            {"id": 3, "sha256": hashlib.sha256(b"other").hexdigest(), "rel_path": "c.pdf"},
        ]
        members = build_exact_binary_groups(rows)
        assert len(members) == 2
        assert {m.file_id for m in members} == {1, 2}
        # Primary selection is stable: lowest rel_path wins.
        primary = next(m for m in members if m.is_primary)
        assert primary.file_id == 2

    def test_binary_group_ignores_missing_hash(self) -> None:
        rows = [
            {"id": 1, "sha256": None, "rel_path": "a.pdf"},
            {"id": 2, "sha256": None, "rel_path": "b.pdf"},
        ]
        assert build_exact_binary_groups(rows) == []

    def test_text_groups(self) -> None:
        members = build_text_groups({1: "aaa", 2: "aaa", 3: "bbb"})
        assert {m.file_id for m in members} == {1, 2}
        assert all(m.method == DuplicateMethod.NORMALIZED_TEXT.value for m in members)


class TestSimHash:
    """Near-duplicate fingerprints and banded search."""

    BASE = " ".join(f"word{index}" for index in range(300))

    def test_identical_text_zero_distance(self) -> None:
        left = simhash(normalize_text(self.BASE))
        right = simhash(normalize_text(self.BASE))
        assert hamming_distance(left, right) == 0

    def test_small_edit_stays_close(self) -> None:
        modified = self.BASE + " one extra trailing phrase here"
        distance = hamming_distance(
            simhash(normalize_text(self.BASE)), simhash(normalize_text(modified))
        )
        assert distance <= 6

    def test_unrelated_text_is_far(self) -> None:
        other = " ".join(f"alpha{index}" for index in range(300))
        distance = hamming_distance(
            simhash(normalize_text(self.BASE)), simhash(normalize_text(other))
        )
        assert distance > 10

    def test_empty_text_has_no_fingerprint(self) -> None:
        assert simhash("") == 0

    def test_banded_search_finds_the_pair(self) -> None:
        fingerprints = {
            1: simhash(normalize_text(self.BASE)),
            2: simhash(normalize_text(self.BASE + " tiny tail")),
            3: simhash(normalize_text(" ".join(f"zzz{i}" for i in range(300)))),
        }
        pairs = find_near_duplicates(fingerprints, max_distance=8)
        matched = {tuple(sorted(pair[:2])) for pair in pairs}
        assert (1, 2) in matched
        assert (1, 3) not in matched

    def test_banded_search_scales_without_quadratic_comparison(self) -> None:
        # 400 mutually distinct documents. A quadratic pass would be 79,800
        # comparisons; banding must return promptly and find no matches,
        # because none of these documents resemble one another.
        fingerprints = {
            index: simhash(
                normalize_text(" ".join(f"doc{index}word{word}" for word in range(80)))
            )
            for index in range(400)
        }
        pairs = find_near_duplicates(fingerprints, max_distance=3)
        assert pairs == []

    def test_true_near_duplicates_still_found_at_scale(self) -> None:
        fingerprints = {
            index: simhash(
                normalize_text(" ".join(f"doc{index}word{word}" for word in range(80)))
            )
            for index in range(100)
        }
        # A near-copy of document 7 with one extra trailing phrase.
        fingerprints[999] = simhash(
            normalize_text(
                " ".join(f"doc7word{word}" for word in range(80)) + " trailing phrase"
            )
        )
        pairs = find_near_duplicates(fingerprints, max_distance=6)
        assert {tuple(sorted(pair[:2])) for pair in pairs} == {(7, 999)}

    def test_connected_components_merge_chains(self) -> None:
        groups = connected_components([(1, 2, 1), (2, 3, 1), (5, 6, 2)])
        assert {frozenset(group) for group in groups} == {
            frozenset({1, 2, 3}),
            frozenset({5, 6}),
        }

    def test_near_duplicate_groups_report_similarity(self) -> None:
        members = build_near_duplicate_groups([(1, 2, 2)], bits=64)
        assert len(members) == 2
        # Reported to 4 decimal places so the workbook column stays readable.
        assert members[0].similarity == pytest.approx(1 - 2 / 64, abs=1e-4)


class TestIssueTagging:
    """Screening tags: over-inclusive by design, never a legal conclusion."""

    TERMS = {
        "STATUTE_OF_FRAUDS": ["statute of frauds", "one year", "Dumas"],
        "JOHN_WILSON": ["John Wilson", "reviewed and understood"],
        "BANKRUPTCY": ["502(b)(7)", "Chapter 11"],
    }

    def test_matches_are_case_insensitive(self) -> None:
        compiled = compile_terms(self.TERMS)
        result = tag_document("The STATUTE OF FRAUDS applies here.", compiled)
        assert result.tags == ["STATUTE_OF_FRAUDS"]

    def test_counts_multiple_hits(self) -> None:
        compiled = compile_terms(self.TERMS)
        result = tag_document("one year and one year again", compiled)
        assert result.counts["STATUTE_OF_FRAUDS"] == 2

    def test_regex_metacharacters_in_terms_are_literal(self) -> None:
        compiled = compile_terms(self.TERMS)
        result = tag_document("see section 502(b)(7) of the code", compiled)
        assert "BANKRUPTCY" in result.tags

    def test_word_boundaries_prevent_substring_matches(self) -> None:
        compiled = compile_terms({"T": ["at will"]})
        assert tag_document("that willow tree", compiled).tags == []
        assert tag_document("employment at will", compiled).tags == ["T"]

    def test_locator_carries_no_document_text_by_default(self) -> None:
        compiled = compile_terms(self.TERMS)
        result = tag_document("John Wilson wrote a confidential passage", compiled)
        assert result.hits
        for hit in result.hits:
            assert "confidential" not in hit.locator
            assert hit.locator.startswith("offset") or hit.locator.startswith("page")

    def test_page_numbers_resolved_when_pages_supplied(self) -> None:
        compiled = compile_terms(self.TERMS)
        pages = ["nothing here", "the statute of frauds appears on page two"]
        result = tag_document("\n".join(pages), compiled, page_texts=pages)
        assert result.hits[0].page_number == 2

    def test_hits_are_capped_but_counts_are_not(self) -> None:
        compiled = compile_terms({"T": ["alpha", "beta", "gamma"]})
        result = tag_document("alpha beta gamma " * 5, compiled, max_hits_per_tag=2)
        assert len(result.hits) == 2
        assert result.counts["T"] == 15

    def test_empty_text_yields_no_tags(self) -> None:
        assert tag_document("", compile_terms(self.TERMS)).tags == []

    def test_shipped_config_terms_all_compile(self) -> None:
        config = yaml.safe_load((PROJECT_ROOT / "config.yaml").read_text(encoding="utf-8"))
        compiled = compile_terms(config["issue_tags"]["terms"])
        assert set(compiled) >= {
            "STATUTE_OF_FRAUDS",
            "PLEADING_AND_WAIVER",
            "JOHN_WILSON",
            "PATRICK_RODE",
            "EXPERT_FAILURE",
            "DAMAGES",
            "CLIENT_FILE",
            "INSURANCE",
            "APPEAL",
            "BANKRUPTCY",
        }


class TestPriorityScoring:
    """Scores must be additive, explainable, and reproducible."""

    CONFIG = {
        "tag_points": {"STATUTE_OF_FRAUDS": 12, "JOHN_WILSON": 8, "DAMAGES": 6},
        "multi_tag_bonus": {"threshold": 3, "points": 8},
        "participant_points": {"john_wilson": 10},
        "participant_patterns": {"john_wilson": [r"john\s+j?\.?\s*wilson"]},
        "unique_content_points": 5,
        "duplicate_penalty": -8,
        "key_event_dates": ["2019-03-04"],
        "key_event_window_days": 14,
        "key_event_points": 6,
        "manual_review_points": 3,
    }

    def test_tag_points_accumulate_with_explanation(self) -> None:
        result = score_document(
            tags=["STATUTE_OF_FRAUDS", "DAMAGES"], config=self.CONFIG, is_unique=True
        )
        assert result.score == 12 + 6 + 5
        assert "STATUTE_OF_FRAUDS +12" in result.explanation
        assert "not part of any duplicate group +5" in result.explanation

    def test_multi_tag_bonus_applies_at_threshold(self) -> None:
        result = score_document(
            tags=["STATUTE_OF_FRAUDS", "JOHN_WILSON", "DAMAGES"],
            config=self.CONFIG,
            is_unique=False,
        )
        assert result.score == 12 + 8 + 6 + 8
        assert "3 distinct tags" in result.explanation

    def test_participation_in_header_scores_separately(self) -> None:
        result = score_document(
            tags=[], config=self.CONFIG, email_from="John J. Wilson <j@x.com>", is_unique=False
        )
        assert result.score == 10
        assert "john_wilson in an email header" in result.explanation

    def test_body_mention_alone_does_not_score_participation(self) -> None:
        result = score_document(tags=[], config=self.CONFIG, email_from=None, is_unique=False)
        assert result.score == 0

    def test_duplicate_secondary_is_penalised(self) -> None:
        result = score_document(
            tags=[], config=self.CONFIG, is_duplicate_secondary=True, is_unique=False
        )
        assert result.score == -8
        assert "secondary copy" in result.explanation

    def test_key_event_proximity(self) -> None:
        result = score_document(
            tags=[], config=self.CONFIG, document_date="2019-03-10", is_unique=False
        )
        assert result.score == 6
        assert "key event" in result.explanation

    def test_date_outside_window_does_not_score(self) -> None:
        result = score_document(
            tags=[], config=self.CONFIG, document_date="2020-01-01", is_unique=False
        )
        assert result.score == 0

    def test_no_factors_explains_itself(self) -> None:
        result = score_document(tags=[], config=self.CONFIG, is_unique=False)
        assert result.explanation == "No scoring factors matched"
