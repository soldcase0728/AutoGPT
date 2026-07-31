"""Tests for Bates parsing, range resolution, and gap analysis."""

from __future__ import annotations

import re

import pytest

from src.bates import (
    BatesConfidence,
    BatesRange,
    BatesSource,
    find_filename_gaps,
    find_range_gaps,
    format_bates,
    parse_filename_bates,
    parse_page_bates,
    resolve_document_range,
)

FILENAME_PATTERN = re.compile(r"WILSONRODE(\d+)", re.IGNORECASE)
COMPLIANT_PATTERN = re.compile(r"^WILSONRODE\d{6}-null\.pdf$")
PAGE_PATTERN = re.compile(r"WILSON\s*[-_ ]?\s*RODE\s*[-_ ]?\s*(\d{4,10})", re.IGNORECASE)


class TestFilenameParsing:
    """Bates values parsed from production filenames."""

    def test_parses_canonical_name(self) -> None:
        parsed = parse_filename_bates(
            "WILSONRODE000012-null.pdf",
            pattern=FILENAME_PATTERN,
            compliant_pattern=COMPLIANT_PATTERN,
        )
        assert parsed.number == 12
        assert parsed.normalized == "WILSONRODE000012"
        assert parsed.compliant is True
        assert parsed.source is BatesSource.PARSED_FROM_FILENAME
        # A filename is never as strong as a stamp read off the page.
        assert parsed.confidence is BatesConfidence.PROBABLE

    def test_parses_high_bates_number(self) -> None:
        parsed = parse_filename_bates("WILSONRODE063725-null.pdf", pattern=FILENAME_PATTERN)
        assert parsed.number == 63725
        assert parsed.normalized == "WILSONRODE063725"

    def test_missing_bates_is_reported_not_invented(self) -> None:
        parsed = parse_filename_bates("scan_0012.pdf", pattern=FILENAME_PATTERN)
        assert parsed.number is None
        assert parsed.normalized is None
        assert parsed.confidence is BatesConfidence.UNKNOWN
        assert "No Bates pattern" in parsed.notes

    def test_non_standard_width_is_flagged_but_parsed(self) -> None:
        parsed = parse_filename_bates(
            "WILSONRODE1234-null.pdf",
            pattern=FILENAME_PATTERN,
            compliant_pattern=COMPLIANT_PATTERN,
        )
        assert parsed.number == 1234
        assert parsed.compliant is False
        assert "Numeric width 4" in parsed.notes

    def test_case_insensitive_match(self) -> None:
        parsed = parse_filename_bates("wilsonrode000007-null.pdf", pattern=FILENAME_PATTERN)
        assert parsed.number == 7

    @pytest.mark.parametrize(
        "filename",
        ["WILSONRODE000001-null.pdf.pdf", "copy of WILSONRODE000001-null.pdf"],
    )
    def test_noncompliant_variants_flagged(self, filename: str) -> None:
        parsed = parse_filename_bates(
            filename, pattern=FILENAME_PATTERN, compliant_pattern=COMPLIANT_PATTERN
        )
        assert parsed.number == 1
        assert parsed.compliant is False


class TestPageParsing:
    """Bates stamps read from page text."""

    def test_finds_stamp_on_page(self) -> None:
        found = parse_page_bates("some text\nWILSONRODE000123\n", pattern=PAGE_PATTERN)
        assert [item.number for item in found] == [123]
        assert found[0].confidence is BatesConfidence.CONFIRMED
        assert found[0].source is BatesSource.OBSERVED_ON_PAGE

    def test_tolerates_separators_inserted_by_stampers(self) -> None:
        found = parse_page_bates("WILSON-RODE 000456", pattern=PAGE_PATTERN)
        assert [item.number for item in found] == [456]

    def test_deduplicates_repeated_stamps(self) -> None:
        found = parse_page_bates(
            "WILSONRODE000001 header\nfooter WILSONRODE000001", pattern=PAGE_PATTERN
        )
        assert len(found) == 1

    def test_no_stamp_returns_empty(self) -> None:
        assert parse_page_bates("no stamp here", pattern=PAGE_PATTERN) == []


class TestRangeResolution:
    """Provenance-aware begin/end range resolution."""

    def test_full_page_coverage_is_confirmed(self) -> None:
        begin, end, source, confidence, _ = resolve_document_range(
            observed=[10, 11, 12], filename_number=10, page_count=3
        )
        assert (begin, end) == (10, 12)
        assert source is BatesSource.OBSERVED_ON_PAGE
        assert confidence is BatesConfidence.CONFIRMED

    def test_partial_observation_extends_by_page_count(self) -> None:
        begin, end, source, confidence, reason = resolve_document_range(
            observed=[10], filename_number=10, page_count=3
        )
        assert (begin, end) == (10, 12)
        assert source is BatesSource.CALCULATED
        assert confidence is BatesConfidence.PROBABLE
        assert "1 of 3" in reason

    def test_filename_only_is_possible_not_probable(self) -> None:
        begin, end, source, confidence, _ = resolve_document_range(
            observed=[], filename_number=50, page_count=2
        )
        assert (begin, end) == (50, 51)
        assert source is BatesSource.CALCULATED
        assert confidence is BatesConfidence.POSSIBLE

    def test_nothing_known_stays_unknown(self) -> None:
        begin, end, source, confidence, _ = resolve_document_range(
            observed=[], filename_number=None, page_count=None
        )
        assert begin is None and end is None
        assert source is BatesSource.UNKNOWN
        assert confidence is BatesConfidence.UNKNOWN


class TestGaps:
    """Gap detection at both the filename and range levels."""

    def test_filename_gaps_are_marked_preliminary(self) -> None:
        gaps = find_filename_gaps([1, 2, 5, 6])
        assert len(gaps) == 1
        assert gaps[0].missing_count == 2
        assert gaps[0].preliminary is True
        assert "multi-page" in gaps[0].basis

    def test_no_gap_when_contiguous(self) -> None:
        assert find_filename_gaps([1, 2, 3]) == []

    def test_range_gaps_account_for_page_counts(self) -> None:
        # A 4-page document at 1 covers 1-4, so there is no real gap to 5.
        gaps, overlaps = find_range_gaps(
            [BatesRange(1, 4, "a.pdf"), BatesRange(5, 5, "b.pdf")]
        )
        assert gaps == []
        assert overlaps == []

    def test_range_gaps_found_when_real(self) -> None:
        gaps, _ = find_range_gaps([BatesRange(1, 2, "a.pdf"), BatesRange(10, 10, "b.pdf")])
        assert len(gaps) == 1
        assert gaps[0].missing_count == 7
        assert gaps[0].preliminary is False

    def test_overlaps_detected(self) -> None:
        _, overlaps = find_range_gaps([BatesRange(1, 5, "a.pdf"), BatesRange(3, 8, "b.pdf")])
        assert len(overlaps) == 1

    def test_invalid_range_rejected(self) -> None:
        with pytest.raises(ValueError):
            BatesRange(10, 5)


def test_format_bates_pads() -> None:
    assert format_bates(7) == "WILSONRODE000007"
    assert format_bates(None) is None
