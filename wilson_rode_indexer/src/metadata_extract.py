"""Phase 3: deterministic derivation of review metadata from extracted text.

Every value produced here is **derived**. It is inferred by pattern
matching over text this tool extracted from the PDF; it is not native
metadata supplied by the producing party, and it is not a legal
conclusion. Each field carries a confidence label, and fields that cannot
be determined are left empty rather than guessed.

No language model is used. All parsing is regular expressions and
deterministic rules, so a result can always be traced to the rule that
produced it.

Email chains
------------
The hard problem is distinguishing the *current* message's header from the
headers of quoted prior messages inside the same chain. The approach is:

* Locate contiguous runs of ``Key: value`` header lines.
* Mark a run as quoted when it is preceded by a reply/forward separator
  (``-----Original Message-----``, ``Forwarded message``, ``On ... wrote:``)
  or when its lines are quote-prefixed with ``>``.
* The first non-quoted run is the top-level message. Every other run and
  every separator counts toward the embedded-message tally.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable, Mapping, Sequence

from dateutil import parser as date_parser

from src.logging_setup import get_logger

LOG = get_logger("metadata_extract")

MULTI_VALUE_DELIMITER = "; "

#: Confidence vocabulary shared by every derived field.
CONF_CONFIRMED = "Confirmed"
CONF_PROBABLE = "Probable"
CONF_POSSIBLE = "Possible"
CONF_UNKNOWN = "Unknown"

_HEADER_KEYS = {
    "from": "from",
    "sent": "sent",
    "date": "date",
    "to": "to",
    "cc": "cc",
    "c.c.": "cc",
    "bcc": "bcc",
    "b.c.c.": "bcc",
    "subject": "subject",
    "attachments": "attachments",
    "attachment": "attachments",
    "importance": "importance",
    "sent by": "from",
    "reply-to": "reply_to",
}

_HEADER_LINE = re.compile(
    r"^\s*>*\s*(?P<key>from|sent by|sent|date|to|cc|c\.c\.|bcc|b\.c\.c\.|subject|"
    r"attachments?|importance|reply-to)\s*:\s*(?P<value>.*)$",
    re.IGNORECASE,
)

_SEPARATORS = (
    re.compile(r"^\s*-{2,}\s*original message\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^\s*-{2,}\s*forwarded message\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^\s*_{5,}\s*$"),
    re.compile(r"^\s*begin forwarded message\s*:?\s*$", re.IGNORECASE),
    re.compile(r"^\s*on\b.{3,120}\bwrote\s*:\s*$", re.IGNORECASE),
    re.compile(r"^\s*>+\s*$"),
)

_EMAIL_ADDRESS = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

#: Recipient separators: semicolons (Outlook) and commas (most others).
_RECIPIENT_SPLIT = re.compile(r"[;,]\s*")

_DATE_PATTERNS = (
    # Outlook "Sent:" style, e.g. "Monday, March 4, 2019 10:12 AM"
    re.compile(
        r"\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s+"
        r"[a-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)?",
        re.IGNORECASE,
    ),
    re.compile(r"\b[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\b"),
    re.compile(r"\b\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\b"),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
)

_CASE_NUMBER = re.compile(
    r"\b(?:case|file|docket|cause|no\.?|number)\s*(?:no\.?|#|number)?\s*:?\s*"
    r"(\d{2,4}[-\s]?[A-Z]{0,4}[-\s]?\d{3,7}[-\s]?[A-Z]{0,4})\b",
    re.IGNORECASE,
)

# Court captions are frequently set in all capitals, so every pattern is
# case-insensitive and keys off the court-type phrase rather than casing.
_COURT_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"((?:united states|u\.?\s?s\.?)\s+(?:district|bankruptcy)\s+court"
        r"(?:\s+for\s+the\s+[a-z.\s]{3,45}?)?)(?:\n|$|,)",
        r"((?:in the\s+)?[a-z][a-z.\s]{2,45}?circuit court)(?:\s+for\s+[a-z.\s]{3,35})?",
        r"((?:michigan\s+|united states\s+)?court of appeals[a-z.\s]{0,30})(?:\n|$|,)",
        r"([a-z][a-z.\s]{2,45}?(?:district|probate|supreme)\s+court)(?:\n|$|,)",
    )
)

_INVOICE_NUMBER = re.compile(r"\binvoice\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9-]{3,20})", re.IGNORECASE)
_INVOICE_AMOUNT = re.compile(
    r"\b(?:total|amount|balance)\s+(?:due|owed|payable)?\s*:?\s*\$?\s*"
    r"([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)",
    re.IGNORECASE,
)
#: A filename token with no internal whitespace, e.g. ``Agreement.pdf``.
_ATTACHMENT_TOKEN = re.compile(
    r"\b([\w][\w\-()&,]{0,80}\.(?:pdf|docx?|xlsx?|xlsm|pptx?|msg|eml|jpe?g|png|tiff?|zip|csv|txt))\b",
    re.IGNORECASE,
)

#: Words immediately preceding a filename token that are part of the name.
#: Capitalised or numeric words qualify; ordinary lower-case prose does not,
#: which stops "Please see Commission Agreement.pdf" collapsing into one name.
_NAME_PREFIX_WORD = re.compile(r"([A-Z0-9][\w\-&,()]*)\s*$")

_FILING_PARTY = re.compile(
    r"\b(plaintiff|defendant|petitioner|respondent|appellant|appellee|"
    r"counter-?plaintiff|counter-?defendant|third-?party plaintiff|third-?party defendant)\b",
    re.IGNORECASE,
)


@dataclass
class HeaderBlock:
    """A contiguous run of ``Key: value`` email header lines."""

    start_line: int
    end_line: int
    fields: dict[str, str]
    quoted: bool

    def has_core_headers(self) -> bool:
        """True when the block looks like a real message header.

        Requires ``from`` plus at least one of ``to``/``subject``/date,
        which keeps ordinary prose containing "Subject:" from being
        mistaken for a message header.
        """
        if "from" not in self.fields:
            return False
        return bool({"to", "subject", "sent", "date"} & set(self.fields))


@dataclass
class EmailMetadata:
    """Derived email metadata for the top-level message of a document."""

    is_email: bool = False
    sender: str | None = None
    recipients_to: list[str] = field(default_factory=list)
    recipients_cc: list[str] = field(default_factory=list)
    recipients_bcc: list[str] = field(default_factory=list)
    subject: str | None = None
    sent_date: str | None = None
    attachment_names: list[str] = field(default_factory=list)
    embedded_message_count: int = 0
    earliest_message_date: str | None = None
    latest_message_date: str | None = None
    confidence: str = CONF_UNKNOWN
    notes: list[str] = field(default_factory=list)

    @property
    def to_joined(self) -> str | None:
        """Recipients joined with the multi-value delimiter."""
        return MULTI_VALUE_DELIMITER.join(self.recipients_to) or None

    @property
    def cc_joined(self) -> str | None:
        """CC recipients joined with the multi-value delimiter."""
        return MULTI_VALUE_DELIMITER.join(self.recipients_cc) or None

    @property
    def bcc_joined(self) -> str | None:
        """BCC recipients joined with the multi-value delimiter."""
        return MULTI_VALUE_DELIMITER.join(self.recipients_bcc) or None


@dataclass
class DocumentMetadata:
    """All derived metadata for one document, with per-field confidence."""

    document_date: str | None = None
    document_date_confidence: str = CONF_UNKNOWN
    email: EmailMetadata = field(default_factory=EmailMetadata)
    author: str | None = None
    title: str | None = None
    court: str | None = None
    case_number: str | None = None
    filing_date: str | None = None
    filing_party: str | None = None
    invoice_date: str | None = None
    vendor: str | None = None
    invoice_amount: str | None = None
    document_type: str = "Unknown"
    document_type_confidence: float = 0.0
    attachment_names: list[str] = field(default_factory=list)
    custodian: str | None = None
    custodian_source: str | None = None
    extraction_confidence: str = CONF_UNKNOWN
    manual_review: bool = False
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Email header parsing
# ---------------------------------------------------------------------------


def _is_separator(line: str) -> bool:
    """True when a line marks the start of a quoted prior message."""
    return any(pattern.match(line) for pattern in _SEPARATORS)


def find_header_blocks(text: str, *, max_lines: int = 4000) -> list[HeaderBlock]:
    """Locate every email-header block in a document's text.

    Args:
        text: Extracted document text.
        max_lines: Safety cap; chains longer than this are truncated for
            header scanning (the tail rarely holds the current header).

    Returns:
        Blocks in document order. ``quoted`` marks blocks that belong to a
        prior message inside a chain rather than to the current message.
    """
    lines = (text or "").splitlines()[:max_lines]
    blocks: list[HeaderBlock] = []
    seen_separator = False

    index = 0
    while index < len(lines):
        line = lines[index]
        if _is_separator(line):
            seen_separator = True
            index += 1
            continue

        match = _HEADER_LINE.match(line)
        if match is None:
            index += 1
            continue

        fields: dict[str, str] = {}
        quoted = seen_separator or line.lstrip().startswith(">")
        start = index
        last_key: str | None = None

        while index < len(lines):
            current = lines[index]
            header_match = _HEADER_LINE.match(current)
            if header_match:
                key = _HEADER_KEYS.get(header_match.group("key").strip().lower())
                if key is None:
                    break
                value = header_match.group("value").strip()
                fields[key] = f"{fields[key]} {value}".strip() if key in fields else value
                last_key = key
                index += 1
                continue

            # A wrapped continuation line: indented, not blank, and the
            # previous line was a header we can extend.
            if (
                last_key
                and current.strip()
                and (current.startswith((" ", "\t")) or current.lstrip().startswith(">"))
                and not _is_separator(current)
            ):
                fields[last_key] = f"{fields[last_key]} {current.strip()}".strip()
                index += 1
                continue
            break

        blocks.append(
            HeaderBlock(start_line=start, end_line=index - 1, fields=fields, quoted=quoted)
        )
        # Everything after the first block is potentially a quoted reply.
        seen_separator = True

    return blocks


def split_recipients(value: str | None) -> list[str]:
    """Split a recipient header into individual addressees.

    Handles Outlook semicolons and comma-separated lists. The hard case is
    ``Wilson, John <jwilson@example.com>``, where the comma separates a
    surname from a forename rather than two recipients. Fragments are
    therefore re-joined when a fragment carrying no address is immediately
    followed by one that does.

    Angle brackets are preserved, since ``Name <addr>`` is the form a
    reviewer expects to see in the workbook.
    """
    if not value:
        return []
    cleaned = value.replace("\r", " ").strip()
    if not cleaned:
        return []

    fragments = [part.strip(" \t;,") for part in _RECIPIENT_SPLIT.split(cleaned)]
    fragments = [part for part in fragments if part]

    merged: list[str] = []
    index = 0
    while index < len(fragments):
        current = fragments[index]
        has_address = "@" in current or "<" in current
        if (
            not has_address
            and index + 1 < len(fragments)
            and ("@" in fragments[index + 1] or "<" in fragments[index + 1])
        ):
            merged.append(f"{current}, {fragments[index + 1]}")
            index += 2
            continue
        merged.append(current)
        index += 1
    return merged


def parse_email_metadata(text: str) -> EmailMetadata:
    """Derive top-level message metadata and chain statistics.

    Args:
        text: Extracted document text.

    Returns:
        An :class:`EmailMetadata`. ``is_email`` is False when no block with
        core headers was found, in which case the remaining fields are
        empty.
    """
    metadata = EmailMetadata()
    blocks = find_header_blocks(text)
    if not blocks:
        return metadata

    real_blocks = [block for block in blocks if block.has_core_headers()]
    if not real_blocks:
        metadata.notes.append("Header-like lines found but no block carried core headers")
        return metadata

    primary = next((block for block in real_blocks if not block.quoted), real_blocks[0])
    metadata.is_email = True

    fields = primary.fields
    metadata.sender = (fields.get("from") or "").strip() or None
    metadata.recipients_to = split_recipients(fields.get("to"))
    metadata.recipients_cc = split_recipients(fields.get("cc"))
    metadata.recipients_bcc = split_recipients(fields.get("bcc"))
    metadata.subject = (fields.get("subject") or "").strip() or None

    sent_raw = fields.get("sent") or fields.get("date")
    parsed_sent = parse_date(sent_raw) if sent_raw else None
    metadata.sent_date = parsed_sent.isoformat() if parsed_sent else None

    if fields.get("attachments"):
        metadata.attachment_names = [
            name.strip()
            for name in _RECIPIENT_SPLIT.split(fields["attachments"])
            if name.strip()
        ]

    metadata.embedded_message_count = max(0, len(real_blocks) - 1)

    all_dates: list[date] = []
    for block in real_blocks:
        raw = block.fields.get("sent") or block.fields.get("date")
        parsed = parse_date(raw) if raw else None
        if parsed:
            all_dates.append(parsed)
    if all_dates:
        metadata.earliest_message_date = min(all_dates).isoformat()
        metadata.latest_message_date = max(all_dates).isoformat()

    # Confidence reflects how complete the primary header is.
    present = sum(
        1
        for value in (metadata.sender, metadata.to_joined, metadata.subject, metadata.sent_date)
        if value
    )
    if present >= 4:
        metadata.confidence = CONF_CONFIRMED
    elif present == 3:
        metadata.confidence = CONF_PROBABLE
    elif present == 2:
        metadata.confidence = CONF_POSSIBLE
    else:
        metadata.confidence = CONF_UNKNOWN

    if primary.quoted:
        metadata.notes.append(
            "Only quoted headers were found; the top-level header may be missing"
        )
        metadata.confidence = CONF_POSSIBLE

    return metadata


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------


def parse_date(
    value: str | None,
    *,
    earliest_year: int = 1970,
    latest_year: int | None = None,
) -> date | None:
    """Parse a date string conservatively.

    Fuzzy parsing is disabled first; only if a strict parse fails is a
    single regex-extracted candidate retried. Values outside a plausible
    year window are rejected rather than returned, because a wrong date in
    a review index is worse than a blank one.

    Args:
        value: Raw text that may contain a date.
        earliest_year: Reject dates before this year.
        latest_year: Reject dates after this year. Defaults to next year.

    Returns:
        A :class:`datetime.date`, or None when no confident parse exists.
    """
    if not value:
        return None
    latest_year = latest_year or (datetime.now().year + 1)
    candidate = value.strip()
    if not candidate:
        return None

    def _accept(parsed: datetime) -> date | None:
        if earliest_year <= parsed.year <= latest_year:
            return parsed.date()
        return None

    try:
        return _accept(date_parser.parse(candidate, fuzzy=False))
    except (ValueError, OverflowError, TypeError):
        pass

    for pattern in _DATE_PATTERNS:
        match = pattern.search(candidate)
        if not match:
            continue
        try:
            return _accept(date_parser.parse(match.group(0), fuzzy=False))
        except (ValueError, OverflowError, TypeError):
            continue
    return None


def find_dates(text: str, *, limit: int = 50) -> list[date]:
    """Collect plausible dates appearing in text, in document order."""
    found: list[date] = []
    seen: set[date] = set()
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(text or ""):
            parsed = parse_date(match.group(0))
            if parsed and parsed not in seen:
                seen.add(parsed)
                found.append(parsed)
                if len(found) >= limit:
                    return found
    return found


def derive_document_date(
    text: str, email: EmailMetadata
) -> tuple[str | None, str]:
    """Choose the document's apparent date and label the confidence.

    Preference order: the email's sent date (a header field, so
    ``Probable``), then the earliest plausible date found in the leading
    text (``Possible``). Returns ``(iso_date, confidence)``.
    """
    if email.sent_date:
        return email.sent_date, CONF_PROBABLE
    candidates = find_dates(text[:6000], limit=10)
    if candidates:
        return min(candidates).isoformat(), CONF_POSSIBLE
    return None, CONF_UNKNOWN


# ---------------------------------------------------------------------------
# Litigation / financial fields
# ---------------------------------------------------------------------------


def extract_court(text: str) -> str | None:
    """Find a court name in the caption area of a pleading."""
    head = (text or "")[:4000]
    for pattern in _COURT_PATTERNS:
        match = pattern.search(head)
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip(" .,").title()
    return None


def extract_case_number(text: str) -> str | None:
    """Find a docket or case number in the caption area."""
    match = _CASE_NUMBER.search((text or "")[:4000])
    if not match:
        return None
    return re.sub(r"\s+", "-", match.group(1).strip())


def extract_filing_party(text: str) -> str | None:
    """Identify the party role a pleading appears to be filed by."""
    head = (text or "")[:4000]
    match = re.search(
        r"\b(?:filed by|submitted by|on behalf of)\s+(?:the\s+)?([A-Za-z ,.'-]{3,60})",
        head,
        re.IGNORECASE,
    )
    if match:
        return match.group(1).strip(" .,")
    role = _FILING_PARTY.search(head)
    return role.group(1).title() if role else None


def extract_invoice_fields(text: str) -> tuple[str | None, str | None, str | None]:
    """Derive ``(invoice_date, vendor, amount)`` from an invoice-like document.

    The vendor heuristic takes the first substantial non-boilerplate line
    of the document, which on most invoices is the letterhead. It is a
    guess and is reported as such by the caller's confidence field.
    """
    head = (text or "")[:6000]

    invoice_date: str | None = None
    date_match = re.search(
        r"\b(?:invoice\s+date|date\s+of\s+invoice|statement\s+date)\s*:?\s*([^\n]{4,40})",
        head,
        re.IGNORECASE,
    )
    if date_match:
        parsed = parse_date(date_match.group(1))
        invoice_date = parsed.isoformat() if parsed else None
    if invoice_date is None:
        candidates = find_dates(head, limit=5)
        invoice_date = candidates[0].isoformat() if candidates else None

    vendor: str | None = None
    for line in head.splitlines():
        stripped = line.strip()
        if len(stripped) < 4 or len(stripped) > 70:
            continue
        if _EMAIL_ADDRESS.search(stripped) or stripped.lower().startswith(
            ("invoice", "statement", "page ", "bill to", "remit")
        ):
            continue
        if re.search(r"[A-Za-z]{3}", stripped):
            vendor = stripped
            break

    amount: str | None = None
    amounts = _INVOICE_AMOUNT.findall(head)
    if amounts:
        try:
            largest = max(amounts, key=lambda value: float(value.replace(",", "")))
            amount = f"${largest}"
        except ValueError:  # pragma: no cover - regex constrains the format
            amount = f"${amounts[-1]}"

    return invoice_date, vendor, amount


def extract_attachment_names(text: str, *, limit: int = 25) -> list[str]:
    """List filenames referenced in the text (likely attachments).

    Only names with a document-like extension are returned, deduplicated
    and capped. A referenced name is evidence of a possible family
    relationship; it never establishes one on its own.
    """
    body = text or ""
    names: list[str] = []
    seen: set[str] = set()

    for match in _ATTACHMENT_TOKEN.finditer(body):
        name = match.group(1).strip()
        # Walk backwards over up to three capitalised or numeric words so
        # that "Commission Agreement.pdf" survives intact while the prose
        # in front of it ("Please see") is left out.
        start = match.start(1)
        for _ in range(3):
            prefix = _NAME_PREFIX_WORD.search(body[max(0, start - 60) : start])
            if prefix is None:
                break
            name = f"{prefix.group(1)} {name}"
            start = max(0, start - 60) + prefix.start(1)

        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
        if len(names) >= limit:
            break
    return names


def extract_title(text: str, email: EmailMetadata) -> str | None:
    """Derive a document title.

    Uses the email subject when present; otherwise the first substantial
    line, which is the caption or heading on most pleadings and letters.
    """
    if email.subject:
        return email.subject
    for line in (text or "").splitlines():
        stripped = line.strip()
        if 6 <= len(stripped) <= 140 and re.search(r"[A-Za-z]{4}", stripped):
            if _HEADER_LINE.match(stripped):
                continue
            return re.sub(r"\s+", " ", stripped)
    return None


def extract_author(text: str, email: EmailMetadata) -> str | None:
    """Derive an author, preferring an email sender over a signature block."""
    if email.sender:
        return email.sender
    match = re.search(
        r"\b(?:very truly yours|sincerely|regards|respectfully submitted)\s*,?\s*\n+"
        r"\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})",
        text or "",
        re.IGNORECASE,
    )
    return match.group(1).strip() if match else None


# ---------------------------------------------------------------------------
# Document-type classification
# ---------------------------------------------------------------------------

#: Display labels for the config's classification keys.
TYPE_LABELS = {
    "EMAIL": "Email",
    "EMAIL_CHAIN": "Email chain",
    "EMAIL_ATTACHMENT": "Email attachment",
    "COURT_PLEADING": "Court pleading",
    "COURT_ORDER": "Court order",
    "TRANSCRIPT": "Transcript",
    "DEPOSITION": "Deposition",
    "CONTRACT": "Contract or agreement",
    "ATTORNEY_NOTES": "Attorney notes",
    "MEMORANDUM": "Memorandum",
    "LETTER": "Letter",
    "INVOICE": "Invoice",
    "FINANCIAL_RECORD": "Financial record",
    "EXPERT_REPORT": "Expert report",
    "EXPERT_EXHIBIT": "Expert exhibit",
    "SPREADSHEET_RENDERING": "Spreadsheet rendering",
    "PRESENTATION_RENDERING": "Presentation rendering",
    "PHOTOGRAPH_OR_IMAGE": "Photograph or image",
    "BLANK_OR_SEPARATOR": "Blank or separator",
    "UNKNOWN": "Unknown",
}


def classify_document(
    text: str,
    *,
    rules: Mapping[str, Any],
    email: EmailMetadata | None = None,
    is_blank: bool = False,
    min_confidence: float = 0.25,
) -> tuple[str, float, str]:
    """Score a document against the configured type cues.

    Args:
        text: Extracted text (the first several thousand characters carry
            almost all of the signal).
        rules: ``classification.types`` from config.yaml.
        email: Parsed email metadata, used to promote EMAIL/EMAIL_CHAIN.
        is_blank: True when every page was blank or Bates-only.
        min_confidence: Below this share of total score, the result is
            reported as Unknown rather than guessed.

    Returns:
        ``(label, confidence, reason)`` where confidence is 0-1.
    """
    if is_blank:
        return TYPE_LABELS["BLANK_OR_SEPARATOR"], 0.9, "Every examined page was blank or Bates-only"

    body = (text or "")[:20000].lower()
    if not body.strip():
        return TYPE_LABELS["UNKNOWN"], 0.0, "No extractable text to classify"

    scores: dict[str, float] = {}
    hits: dict[str, list[str]] = {}
    for type_key, spec in rules.items():
        if not isinstance(spec, Mapping):
            continue
        weight = float(spec.get("weight", 1.0))
        matched: list[str] = []
        score = 0.0
        for pattern_source in spec.get("patterns", []):
            try:
                pattern = re.compile(str(pattern_source), re.IGNORECASE | re.MULTILINE)
            except re.error:
                LOG.warning(
                    "Skipping invalid classification pattern",
                    extra={"type": type_key, "pattern": str(pattern_source)},
                )
                continue
            count = len(pattern.findall(body))
            if count:
                # Diminishing returns: repeated hits of one cue should not
                # outvote several distinct cues.
                score += weight * (1.0 + min(count - 1, 4) * 0.25)
                matched.append(str(pattern_source))
        if score:
            scores[type_key] = score
            hits[type_key] = matched

    if email is not None and email.is_email:
        scores["EMAIL"] = scores.get("EMAIL", 0.0) + 3.0
        hits.setdefault("EMAIL", []).append("parsed email header block")
        if email.embedded_message_count > 0:
            scores["EMAIL_CHAIN"] = scores.get("EMAIL_CHAIN", 0.0) + 3.0
            hits.setdefault("EMAIL_CHAIN", []).append(
                f"{email.embedded_message_count} embedded prior message(s)"
            )

    if not scores:
        return TYPE_LABELS["UNKNOWN"], 0.0, "No classification cue matched"

    total = sum(scores.values())
    winner = max(scores, key=lambda key: scores[key])
    confidence = scores[winner] / total if total else 0.0

    if confidence < min_confidence:
        runners = sorted(scores, key=lambda key: scores[key], reverse=True)[:3]
        return (
            TYPE_LABELS["UNKNOWN"],
            round(confidence, 3),
            "Ambiguous; competing cues for " + ", ".join(TYPE_LABELS.get(k, k) for k in runners),
        )

    reason = f"Matched {len(hits.get(winner, []))} cue(s) for {TYPE_LABELS.get(winner, winner)}"
    return TYPE_LABELS.get(winner, winner), round(confidence, 3), reason


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------


def derive_metadata(
    text: str,
    *,
    classification_rules: Mapping[str, Any],
    min_type_confidence: float = 0.25,
    is_blank: bool = False,
    searchable_status: str = "Unknown",
) -> DocumentMetadata:
    """Derive the full metadata record for one document.

    Args:
        text: Extracted document text. Only read here; never emitted.
        classification_rules: ``classification.types`` from config.
        min_type_confidence: Threshold below which type is "Unknown".
        is_blank: True when the document had no non-blank pages.
        searchable_status: Document-level searchability, used to set the
            overall extraction confidence.

    Returns:
        A populated :class:`DocumentMetadata`. Every uncertain field is
        either empty or carries an explicit confidence of ``Possible`` or
        ``Unknown``.
    """
    metadata = DocumentMetadata()
    body = text or ""

    metadata.email = parse_email_metadata(body)
    metadata.document_date, metadata.document_date_confidence = derive_document_date(
        body, metadata.email
    )
    metadata.author = extract_author(body, metadata.email)
    metadata.title = extract_title(body, metadata.email)
    metadata.court = extract_court(body)
    metadata.case_number = extract_case_number(body)
    metadata.filing_party = extract_filing_party(body)

    metadata.document_type, metadata.document_type_confidence, type_reason = classify_document(
        body,
        rules=classification_rules,
        email=metadata.email,
        is_blank=is_blank,
        min_confidence=min_type_confidence,
    )
    metadata.notes.append(type_reason)

    if metadata.court or metadata.case_number:
        filing = find_dates(body[:4000], limit=5)
        metadata.filing_date = filing[0].isoformat() if filing else None

    if metadata.document_type in {TYPE_LABELS["INVOICE"], TYPE_LABELS["FINANCIAL_RECORD"]}:
        metadata.invoice_date, metadata.vendor, metadata.invoice_amount = extract_invoice_fields(
            body
        )

    referenced = extract_attachment_names(body)
    metadata.attachment_names = list(
        dict.fromkeys([*metadata.email.attachment_names, *referenced])
    )

    # Custodian is only ever populated when the production actually shows
    # one. This tool does not infer custody from folder names, because a
    # synced Drive path is not evidence of who held the document.
    metadata.custodian = None
    metadata.custodian_source = "Not shown in the production"

    metadata.extraction_confidence = _extraction_confidence(
        searchable_status=searchable_status,
        text_length=len(body),
        email=metadata.email,
        type_confidence=metadata.document_type_confidence,
    )
    metadata.manual_review = _needs_manual_review(metadata, searchable_status)
    return metadata


def _extraction_confidence(
    *, searchable_status: str, text_length: int, email: EmailMetadata, type_confidence: float
) -> str:
    """Grade how much to trust this document's derived fields overall."""
    if searchable_status == "No searchable text" or text_length < 50:
        return CONF_UNKNOWN
    if searchable_status == "Fully searchable" and type_confidence >= 0.5:
        return CONF_CONFIRMED if email.confidence == CONF_CONFIRMED else CONF_PROBABLE
    if searchable_status == "Partially searchable":
        return CONF_POSSIBLE
    return CONF_PROBABLE if type_confidence >= 0.35 else CONF_POSSIBLE


def _needs_manual_review(metadata: DocumentMetadata, searchable_status: str) -> bool:
    """Flag documents a human should look at before relying on the row."""
    if metadata.extraction_confidence in {CONF_UNKNOWN, CONF_POSSIBLE}:
        return True
    if metadata.document_type == TYPE_LABELS["UNKNOWN"]:
        return True
    if searchable_status != "Fully searchable":
        return True
    if metadata.email.is_email and metadata.email.confidence in {CONF_UNKNOWN, CONF_POSSIBLE}:
        return True
    return False


__all__ = [
    "CONF_CONFIRMED",
    "CONF_POSSIBLE",
    "CONF_PROBABLE",
    "CONF_UNKNOWN",
    "DocumentMetadata",
    "EmailMetadata",
    "HeaderBlock",
    "MULTI_VALUE_DELIMITER",
    "TYPE_LABELS",
    "classify_document",
    "derive_document_date",
    "derive_metadata",
    "extract_attachment_names",
    "extract_author",
    "extract_case_number",
    "extract_court",
    "extract_filing_party",
    "extract_invoice_fields",
    "extract_title",
    "find_dates",
    "find_header_blocks",
    "parse_date",
    "parse_email_metadata",
    "split_recipients",
]
