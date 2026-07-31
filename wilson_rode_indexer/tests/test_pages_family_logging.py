"""Tests for page-condition classification, family inference, and log safety."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from src.document_family import (
    FamilyCandidate,
    FamilyConfidence,
    infer_families,
    name_similarity,
    summarise_for_document,
)
from src.logging_setup import DocumentTextGuard, JsonLineFormatter
from src.pdf_extract import (
    BlankSubtype,
    PageCondition,
    classify_page,
    extract_document,
    thresholds_from_config,
)

THRESHOLDS = {
    "min_chars_searchable": 100,
    "max_chars_apparent_blank": 12,
    "max_chars_bates_only": 40,
    "min_chars_uncertain": 25,
    "image_coverage_image_only": 0.10,
    "image_coverage_blank": 0.01,
}


class TestPageClassification:
    """Each condition must be reachable and correctly distinguished."""

    def test_searchable_page(self) -> None:
        condition, subtype, _ = classify_page(
            char_count=800, image_count=0, image_coverage=0.0,
            bates_found=True, text_without_bates_chars=780, thresholds=THRESHOLDS,
        )
        assert condition is PageCondition.SEARCHABLE
        assert subtype is None

    def test_image_only_page_needs_ocr(self) -> None:
        condition, _, _ = classify_page(
            char_count=0, image_count=1, image_coverage=0.85,
            bates_found=False, text_without_bates_chars=0, thresholds=THRESHOLDS,
        )
        assert condition is PageCondition.OCR_REQUIRED

    def test_bates_only_page_over_an_image_is_image_only(self) -> None:
        condition, _, _ = classify_page(
            char_count=16, image_count=1, image_coverage=0.9,
            bates_found=True, text_without_bates_chars=0, thresholds=THRESHOLDS,
        )
        assert condition is PageCondition.IMAGE_ONLY

    def test_bates_stamp_only_on_an_empty_page(self) -> None:
        condition, subtype, _ = classify_page(
            char_count=16, image_count=0, image_coverage=0.0,
            bates_found=True, text_without_bates_chars=0, thresholds=THRESHOLDS,
        )
        assert condition is PageCondition.BATES_ONLY
        assert subtype is BlankSubtype.BATES_STAMP_ONLY

    def test_truly_blank_candidate(self) -> None:
        condition, subtype, _ = classify_page(
            char_count=0, image_count=0, image_coverage=0.0,
            bates_found=False, text_without_bates_chars=0, thresholds=THRESHOLDS,
        )
        assert condition is PageCondition.APPARENT_BLANK
        assert subtype is BlankSubtype.TRULY_BLANK_CANDIDATE

    def test_possible_separator_when_a_few_marks_remain(self) -> None:
        condition, subtype, _ = classify_page(
            char_count=5, image_count=1, image_coverage=0.0,
            bates_found=False, text_without_bates_chars=5, thresholds=THRESHOLDS,
        )
        assert subtype in {BlankSubtype.POSSIBLE_SEPARATOR, BlankSubtype.UNCERTAIN}

    def test_failed_export_candidate(self) -> None:
        condition, subtype, _ = classify_page(
            char_count=20, image_count=0, image_coverage=0.0,
            bates_found=False, text_without_bates_chars=20, thresholds=THRESHOLDS,
        )
        assert condition is PageCondition.UNCERTAIN
        assert subtype is BlankSubtype.POSSIBLE_FAILED_EXPORT

    def test_ocr_completed_recorded_separately(self) -> None:
        condition, _, _ = classify_page(
            char_count=500, image_count=1, image_coverage=0.9,
            bates_found=False, text_without_bates_chars=500,
            thresholds=THRESHOLDS, ocr_done=True,
        )
        assert condition is PageCondition.OCR_COMPLETED

    def test_thresholds_load_from_config(self, config) -> None:
        loaded = thresholds_from_config(config)
        assert set(loaded) == set(THRESHOLDS)


class TestExtraction:
    """End-to-end extraction over synthetic PDFs."""

    def test_extracts_pages_and_observes_bates(self, config, source_tree: Path) -> None:
        payload = extract_document(
            str(source_tree / "WILSONRODE000002-null.pdf"),
            "WILSONRODE000002-null.pdf",
            thresholds=THRESHOLDS,
            bates_page_pattern=str(config.get("bates.page_regex")),
            bates_prefix="WILSONRODE",
            bates_digits=6,
        )
        assert payload["page_count"] == 2
        assert payload["observed_bates"] == [2, 3]
        assert payload["total_chars"] > 0

    def test_blank_page_recognised(self, config, source_tree: Path) -> None:
        payload = extract_document(
            str(source_tree / "WILSONRODE000004-null.pdf"),
            "WILSONRODE000004-null.pdf",
            thresholds=THRESHOLDS,
            bates_page_pattern=str(config.get("bates.page_regex")),
            bates_prefix="WILSONRODE",
            bates_digits=6,
        )
        assert payload["pages"][0]["condition"] in {"Bates-only page", "Apparent blank"}

    def test_encrypted_document_reports_an_error_not_a_crash(
        self, config, source_tree: Path
    ) -> None:
        payload = extract_document(
            str(source_tree / "WILSONRODE000020-null.pdf"),
            "WILSONRODE000020-null.pdf",
            thresholds=THRESHOLDS,
            bates_page_pattern=str(config.get("bates.page_regex")),
            bates_prefix="WILSONRODE",
            bates_digits=6,
        )
        assert payload["status"] == "error"
        assert "Password-protected" in payload["error_message"]

    def test_summary_never_carries_text(self, config, source_tree: Path) -> None:
        payload = extract_document(
            str(source_tree / "WILSONRODE000001-null.pdf"),
            "WILSONRODE000001-null.pdf",
            thresholds=THRESHOLDS,
            bates_page_pattern=str(config.get("bates.page_regex")),
            bates_prefix="WILSONRODE",
            bates_digits=6,
        )
        from src.pdf_extract import DocumentExtraction

        extraction = DocumentExtraction(rel_path="x", text=payload["text"])
        assert "text" not in extraction.summary()


class TestFamilyInference:
    """Parent/attachment inference and its confidence labelling."""

    @staticmethod
    def build() -> list[FamilyCandidate]:
        return [
            FamilyCandidate(
                file_id=1, rel_path="a.pdf", filename="WILSONRODE000001-null.pdf",
                begin_bates=1, end_bates=1, document_type="Email",
                title="Dagenais Issue Follow Up", subject="Dagenais Issue Follow Up",
                document_date="2019-03-04",
                attachment_names=("Commission Agreement.pdf",), page_count=1,
            ),
            FamilyCandidate(
                file_id=2, rel_path="b.pdf", filename="WILSONRODE000002-null.pdf",
                begin_bates=2, end_bates=3, document_type="Contract or agreement",
                title="Commission Agreement", subject=None,
                document_date="2019-03-04", attachment_names=(), page_count=2,
            ),
            FamilyCandidate(
                file_id=3, rel_path="z.pdf", filename="WILSONRODE009000-null.pdf",
                begin_bates=9000, end_bates=9000, document_type="Invoice",
                title="Invoice", subject=None, document_date="2021-01-01",
                attachment_names=(), page_count=1,
            ),
        ]

    def test_adjacent_named_attachment_is_probable(self) -> None:
        relationships = infer_families(self.build(), config={"max_bates_span": 50})
        assert len(relationships) == 1
        link = relationships[0]
        assert link.parent_file_id == 1
        assert link.child_file_id == 2
        assert link.confidence == FamilyConfidence.PROBABLE.value

    def test_reason_declares_the_inference(self) -> None:
        relationships = infer_families(self.build(), config={"max_bates_span": 50})
        assert relationships[0].reason.startswith("INFERRED (not native family metadata)")
        assert "immediately after" in relationships[0].reason

    def test_distant_document_is_not_linked(self) -> None:
        relationships = infer_families(self.build(), config={"max_bates_span": 50})
        assert all(link.child_file_id != 3 for link in relationships)

    def test_emails_are_not_treated_as_attachments(self) -> None:
        candidates = self.build()
        candidates[1] = FamilyCandidate(
            file_id=2, rel_path="b.pdf", filename="WILSONRODE000002-null.pdf",
            begin_bates=2, end_bates=2, document_type="Email", title="RE: something",
            subject="RE: something", document_date="2019-03-04",
            attachment_names=(), page_count=1,
        )
        assert infer_families(candidates, config={"max_bates_span": 50}) == []

    def test_no_bates_yields_no_inference(self) -> None:
        candidates = [
            FamilyCandidate(
                file_id=1, rel_path="a.pdf", filename="a.pdf", begin_bates=None,
                end_bates=None, document_type="Email", title=None, subject=None,
                document_date=None,
            )
        ]
        assert infer_families(candidates, config={}) == []

    def test_summary_reports_weakest_confidence(self) -> None:
        relationships = infer_families(self.build(), config={"max_bates_span": 50})
        summary = summarise_for_document(relationships)
        assert summary[1]["attachment_bates"] == "WILSONRODE000002"
        assert summary[2]["parent_bates"] == "WILSONRODE000001"

    def test_name_similarity_ignores_extension_and_punctuation(self) -> None:
        assert name_similarity("Commission Agreement.pdf", "commission_agreement") > 90
        assert name_similarity("Commission Agreement.pdf", "unrelated invoice") < 60


class TestLoggingSafety:
    """The logging layer must fail closed on document text."""

    @staticmethod
    def record(**extra: object) -> logging.LogRecord:
        record = logging.LogRecord("t", logging.INFO, __file__, 1, "message", (), None)
        for key, value in extra.items():
            setattr(record, key, value)
        return record

    @pytest.mark.parametrize(
        "key",
        ["document_text", "page_text", "extracted_text", "email_body", "excerpt", "snippet"],
    )
    def test_guard_drops_text_bearing_records(self, key: str) -> None:
        assert DocumentTextGuard().filter(self.record(**{key: "confidential"})) is False

    def test_guard_drops_explicitly_marked_records(self) -> None:
        assert DocumentTextGuard().filter(self.record(contains_document_text=True)) is False

    def test_guard_allows_structural_records(self) -> None:
        assert DocumentTextGuard().filter(self.record(rel_path="a.pdf", pages=3)) is True

    def test_formatter_emits_json_with_extras(self) -> None:
        import json

        line = JsonLineFormatter().format(self.record(rel_path="a.pdf", pages=3))
        payload = json.loads(line)
        assert payload["rel_path"] == "a.pdf"
        assert payload["pages"] == 3
        assert payload["message"] == "message"

    def test_setup_logging_attaches_the_guard(self, tmp_path: Path) -> None:
        from src.logging_setup import setup_logging

        setup_logging(tmp_path / "logs", run_name="test")
        root = logging.getLogger()
        assert root.handlers
        for handler in root.handlers:
            assert any(isinstance(f, DocumentTextGuard) for f in handler.filters)
        for handler in list(root.handlers):
            root.removeHandler(handler)
            handler.close()
