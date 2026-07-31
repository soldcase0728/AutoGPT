"""Tests for email-header parsing, date parsing, and classification."""

from __future__ import annotations

from datetime import date

import pytest

from src.metadata_extract import (
    CONF_CONFIRMED,
    TYPE_LABELS,
    classify_document,
    extract_attachment_names,
    extract_case_number,
    extract_court,
    extract_invoice_fields,
    find_header_blocks,
    parse_date,
    parse_email_metadata,
    split_recipients,
)

OUTLOOK_EMAIL = """From: John J. Wilson <jwilson@example.com>
Sent: Monday, March 4, 2019 10:12 AM
To: Patrick Rode <prode@example.com>; Alice Smith <asmith@example.com>
Cc: Records Dept <records@example.com>
Subject: Dagenais Issue Follow Up
Attachments: Commission Agreement.pdf; Exhibit 37.xlsx

Pat, please review before we discuss.
"""

EMAIL_CHAIN = """From: Patrick Rode <prode@example.com>
Sent: Tuesday, March 5, 2019 8:00 AM
To: John J. Wilson <jwilson@example.com>
Subject: RE: Dagenais Issue Follow Up

Reviewed and understood.

-----Original Message-----
From: John J. Wilson <jwilson@example.com>
Sent: Monday, March 4, 2019 10:12 AM
To: Patrick Rode <prode@example.com>
Subject: Dagenais Issue Follow Up

Pat, please review.
"""


class TestHeaderBlocks:
    """Locating and qualifying header runs."""

    def test_single_block_found(self) -> None:
        blocks = find_header_blocks(OUTLOOK_EMAIL)
        assert len(blocks) == 1
        assert blocks[0].has_core_headers()
        assert blocks[0].quoted is False

    def test_chain_yields_two_blocks_second_quoted(self) -> None:
        blocks = [b for b in find_header_blocks(EMAIL_CHAIN) if b.has_core_headers()]
        assert len(blocks) == 2
        assert blocks[0].quoted is False
        assert blocks[1].quoted is True

    def test_prose_mentioning_subject_is_not_a_header(self) -> None:
        blocks = find_header_blocks("The subject: of this letter is unrelated.\n")
        assert all(not block.has_core_headers() for block in blocks)


class TestEmailMetadata:
    """Top-level message extraction, not quoted prior messages."""

    def test_extracts_all_core_fields(self) -> None:
        metadata = parse_email_metadata(OUTLOOK_EMAIL)
        assert metadata.is_email is True
        assert "jwilson@example.com" in (metadata.sender or "")
        assert len(metadata.recipients_to) == 2
        assert metadata.recipients_cc == ["Records Dept <records@example.com>"]
        assert metadata.subject == "Dagenais Issue Follow Up"
        assert metadata.sent_date == "2019-03-04"
        assert metadata.confidence == CONF_CONFIRMED

    def test_attachments_header_parsed(self) -> None:
        metadata = parse_email_metadata(OUTLOOK_EMAIL)
        assert "Commission Agreement.pdf" in metadata.attachment_names
        assert "Exhibit 37.xlsx" in metadata.attachment_names

    def test_chain_uses_top_level_not_quoted_header(self) -> None:
        metadata = parse_email_metadata(EMAIL_CHAIN)
        # The current message is Rode's reply, not Wilson's original.
        assert "prode@example.com" in (metadata.sender or "")
        assert metadata.subject == "RE: Dagenais Issue Follow Up"
        assert metadata.sent_date == "2019-03-05"

    def test_chain_counts_embedded_messages_and_date_span(self) -> None:
        metadata = parse_email_metadata(EMAIL_CHAIN)
        assert metadata.embedded_message_count == 1
        assert metadata.earliest_message_date == "2019-03-04"
        assert metadata.latest_message_date == "2019-03-05"

    def test_non_email_returns_not_an_email(self) -> None:
        metadata = parse_email_metadata("A contract with no headers whatsoever.")
        assert metadata.is_email is False
        assert metadata.sender is None


class TestRecipientSplitting:
    """Multiple recipients are preserved as delimited values."""

    def test_semicolon_delimited(self) -> None:
        assert split_recipients("a@x.com; b@y.com") == ["a@x.com", "b@y.com"]

    def test_display_names_not_split_on_internal_commas(self) -> None:
        parsed = split_recipients("Wilson, John <jwilson@example.com>; b@y.com")
        assert "jwilson@example.com" in parsed[0]
        assert len(parsed) == 2

    def test_empty_is_empty_list(self) -> None:
        assert split_recipients(None) == []
        assert split_recipients("   ") == []


class TestDateParsing:
    """Conservative date parsing; a wrong date is worse than a blank one."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Monday, March 4, 2019 10:12 AM", date(2019, 3, 4)),
            ("March 4, 2019", date(2019, 3, 4)),
            ("2019-03-04", date(2019, 3, 4)),
            ("4 March 2019", date(2019, 3, 4)),
        ],
    )
    def test_common_formats(self, raw: str, expected: date) -> None:
        assert parse_date(raw) == expected

    def test_rejects_implausible_year(self) -> None:
        assert parse_date("1801-01-01") is None

    def test_rejects_garbage(self) -> None:
        assert parse_date("not a date at all") is None
        assert parse_date("") is None
        assert parse_date(None) is None


class TestLitigationFields:
    """Court, case number, and invoice extraction."""

    def test_court_extracted_from_caption(self) -> None:
        text = "STATE OF MICHIGAN\nIN THE OAKLAND COUNTY CIRCUIT COURT\nCase No. 19-123456-CB"
        assert "Circuit Court" in (extract_court(text) or "")

    def test_case_number_extracted(self) -> None:
        text = "IN THE CIRCUIT COURT\nCase No. 19-123456-CB\nPlaintiff,"
        assert extract_case_number(text) == "19-123456-CB"

    def test_invoice_fields(self) -> None:
        text = (
            "Rode Law PLLC\nInvoice\nInvoice Date: March 31, 2019\n"
            "For professional services rendered\nAmount Due: $12,500.00\n"
        )
        invoice_date, vendor, amount = extract_invoice_fields(text)
        assert invoice_date == "2019-03-31"
        assert vendor == "Rode Law PLLC"
        assert amount == "$12,500.00"

    def test_attachment_names_from_body(self) -> None:
        names = extract_attachment_names("Please see Commission Agreement.pdf and notes.docx")
        assert "Commission Agreement.pdf" in names
        assert "notes.docx" in names


class TestClassification:
    """Deterministic keyword classification with confidence."""

    RULES = {
        "EMAIL": {"weight": 1.0, "patterns": [r"^\s*from:\s", r"^\s*subject:\s"]},
        "CONTRACT": {
            "weight": 1.0,
            "patterns": [r"\bthis agreement\b", r"\bwhereas\b", r"\bnow, therefore\b"],
        },
        "INVOICE": {"weight": 1.1, "patterns": [r"\binvoice\b", r"\bamount due\b"]},
    }

    def test_email_wins_when_headers_parsed(self) -> None:
        email = parse_email_metadata(OUTLOOK_EMAIL)
        label, confidence, _ = classify_document(
            OUTLOOK_EMAIL, rules=self.RULES, email=email
        )
        assert label == TYPE_LABELS["EMAIL"]
        assert confidence > 0.3

    def test_contract_detected(self) -> None:
        text = "This Agreement is made. WHEREAS the parties agree. NOW, THEREFORE."
        label, confidence, _ = classify_document(text, rules=self.RULES)
        assert label == TYPE_LABELS["CONTRACT"]
        assert confidence > 0.5

    def test_blank_short_circuits(self) -> None:
        label, confidence, reason = classify_document("", rules=self.RULES, is_blank=True)
        assert label == TYPE_LABELS["BLANK_OR_SEPARATOR"]
        assert "blank" in reason.lower()

    def test_no_text_is_unknown_not_guessed(self) -> None:
        label, confidence, _ = classify_document("   ", rules=self.RULES)
        assert label == TYPE_LABELS["UNKNOWN"]
        assert confidence == 0.0

    def test_no_cue_match_is_unknown(self) -> None:
        label, _, _ = classify_document("aaa bbb ccc ddd", rules=self.RULES)
        assert label == TYPE_LABELS["UNKNOWN"]
