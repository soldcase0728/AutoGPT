"""Bates number parsing, normalisation, range arithmetic, and gap analysis.

Everything here is *derived*: Bates values are read from filenames or from
text observed on a page. They are not native production metadata, and the
provenance of every value is tracked with a :class:`BatesSource` and a
:class:`BatesConfidence`.

A note on gaps
--------------
A Bates "gap" computed from filenames alone is **preliminary**. Each PDF
in this production may span several Bates-stamped pages, so a numeric jump
between two consecutive filenames is frequently explained by the page count
of the earlier document rather than by a missing document. Filename-based
gap analysis (:func:`find_filename_gaps`) therefore reports candidates, and
:func:`find_range_gaps` - which uses observed begin/end ranges from Phase 3
- supersedes it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Sequence


class BatesSource(str, Enum):
    """Where a Bates value came from."""

    OBSERVED_ON_PAGE = "Observed on page"
    PARSED_FROM_FILENAME = "Parsed from filename"
    CALCULATED = "Calculated"
    INFERRED = "Inferred"
    UNKNOWN = "Unknown"


class BatesConfidence(str, Enum):
    """How much trust to place in a Bates value."""

    CONFIRMED = "Confirmed"
    PROBABLE = "Probable"
    POSSIBLE = "Possible"
    UNKNOWN = "Unknown"


@dataclass(frozen=True)
class ParsedBates:
    """A single Bates value together with its provenance."""

    raw: str | None
    number: int | None
    prefix: str
    digits: int
    source: BatesSource
    confidence: BatesConfidence
    compliant: bool = False
    notes: str = ""

    @property
    def normalized(self) -> str | None:
        """Zero-padded canonical form, e.g. ``WILSONRODE000123``."""
        if self.number is None:
            return None
        return f"{self.prefix}{self.number:0{self.digits}d}"


@dataclass(frozen=True)
class BatesRange:
    """An inclusive begin/end Bates range for one document."""

    begin: int
    end: int
    rel_path: str = ""

    def __post_init__(self) -> None:
        if self.end < self.begin:
            raise ValueError(f"Bates range end {self.end} precedes begin {self.begin}")

    @property
    def length(self) -> int:
        """Number of Bates numbers covered, inclusive."""
        return self.end - self.begin + 1

    def overlaps(self, other: "BatesRange") -> bool:
        """True when this range shares at least one number with ``other``."""
        return self.begin <= other.end and other.begin <= self.end


@dataclass(frozen=True)
class BatesGap:
    """A run of Bates numbers not covered by any document."""

    after: int
    before: int
    missing_count: int
    preliminary: bool
    basis: str

    @property
    def label(self) -> str:
        """Human-readable description of the missing run."""
        if self.missing_count == 1:
            return f"{self.after + 1}"
        return f"{self.after + 1}-{self.before - 1}"


def parse_filename_bates(
    filename: str,
    *,
    pattern: re.Pattern[str],
    prefix: str = "WILSONRODE",
    expected_digits: int = 6,
    compliant_pattern: re.Pattern[str] | None = None,
) -> ParsedBates:
    """Parse a Bates number out of a production filename.

    Args:
        filename: Base filename, e.g. ``"WILSONRODE000012-null.pdf"``.
        pattern: Compiled regex whose group 1 is the numeric portion.
        prefix: Canonical production prefix used when normalising.
        expected_digits: Expected zero-padded width.
        compliant_pattern: Optional regex the whole filename must match to
            be considered fully compliant with the naming convention.

    Returns:
        A :class:`ParsedBates`. ``number`` is None when no match is found;
        in that case the caller should treat the filename as malformed.

    Notes:
        Confidence is ``PROBABLE`` rather than ``CONFIRMED`` even on a
        clean match, because a filename is not the page itself. Only a
        Bates value read off the page earns ``CONFIRMED``.
    """
    match = pattern.search(filename)
    notes: list[str] = []

    if match is None:
        return ParsedBates(
            raw=None,
            number=None,
            prefix=prefix,
            digits=expected_digits,
            source=BatesSource.UNKNOWN,
            confidence=BatesConfidence.UNKNOWN,
            compliant=False,
            notes="No Bates pattern found in filename",
        )

    digits_text = match.group(1)
    try:
        number = int(digits_text)
    except ValueError:  # pragma: no cover - regex guarantees digits
        return ParsedBates(
            raw=match.group(0),
            number=None,
            prefix=prefix,
            digits=expected_digits,
            source=BatesSource.UNKNOWN,
            confidence=BatesConfidence.UNKNOWN,
            notes="Bates digits did not parse as an integer",
        )

    if len(digits_text) != expected_digits:
        notes.append(f"Numeric width {len(digits_text)} != expected {expected_digits}")

    compliant = True
    if compliant_pattern is not None:
        compliant = bool(compliant_pattern.match(filename))
        if not compliant:
            notes.append("Filename does not match the compliant-name pattern")

    return ParsedBates(
        raw=match.group(0),
        number=number,
        prefix=prefix,
        digits=expected_digits,
        source=BatesSource.PARSED_FROM_FILENAME,
        confidence=BatesConfidence.PROBABLE,
        compliant=compliant,
        notes="; ".join(notes),
    )


def parse_page_bates(
    text: str,
    *,
    pattern: re.Pattern[str],
    prefix: str = "WILSONRODE",
    expected_digits: int = 6,
) -> list[ParsedBates]:
    """Find every Bates stamp appearing in text extracted from a page.

    Args:
        text: Text extracted from a single page.
        pattern: Compiled regex whose group 1 is the numeric portion. It
            should tolerate the separators stamping tools insert.
        prefix: Canonical prefix for normalisation.
        expected_digits: Canonical zero-pad width.

    Returns:
        Parsed values in the order encountered, deduplicated by number.
        Confidence is ``CONFIRMED`` because the value was seen on the page.
    """
    found: list[ParsedBates] = []
    seen: set[int] = set()
    for match in pattern.finditer(text or ""):
        try:
            number = int(match.group(1))
        except (ValueError, IndexError):  # pragma: no cover - defensive
            continue
        if number in seen:
            continue
        seen.add(number)
        found.append(
            ParsedBates(
                raw=match.group(0).strip(),
                number=number,
                prefix=prefix,
                digits=expected_digits,
                source=BatesSource.OBSERVED_ON_PAGE,
                confidence=BatesConfidence.CONFIRMED,
                compliant=True,
            )
        )
    return found


def format_bates(number: int | None, *, prefix: str = "WILSONRODE", digits: int = 6) -> str | None:
    """Render a Bates integer in canonical zero-padded form."""
    if number is None:
        return None
    return f"{prefix}{number:0{digits}d}"


def resolve_document_range(
    *,
    observed: Sequence[int],
    filename_number: int | None,
    page_count: int | None,
) -> tuple[int | None, int | None, BatesSource, BatesConfidence, str]:
    """Determine a document's begin/end Bates range and its provenance.

    Resolution order, strongest evidence first:

    1. Bates values observed on the pages themselves. If observed values
       cover every page contiguously, the range is ``CONFIRMED``.
    2. A partial set of observed values, extended by page count -
       ``PROBABLE``, source ``CALCULATED``.
    3. The filename number plus page count - ``PROBABLE`` for the begin
       value, but the end is ``CALCULATED``.
    4. The filename number alone - ``POSSIBLE``.
    5. Nothing - ``UNKNOWN``.

    Args:
        observed: Bates numbers read off pages, any order.
        filename_number: Bates number parsed from the filename.
        page_count: Page count of the document, when known.

    Returns:
        ``(begin, end, source, confidence, reason)``.
    """
    unique = sorted({int(value) for value in observed})

    if unique:
        begin, end = unique[0], unique[-1]
        contiguous = len(unique) == (end - begin + 1)
        covers_pages = page_count is not None and len(unique) == page_count
        if contiguous and covers_pages:
            return (
                begin,
                end,
                BatesSource.OBSERVED_ON_PAGE,
                BatesConfidence.CONFIRMED,
                f"{len(unique)} contiguous Bates values observed across {page_count} page(s)",
            )
        if page_count and len(unique) < page_count:
            calculated_end = max(end, begin + page_count - 1)
            return (
                begin,
                calculated_end,
                BatesSource.CALCULATED,
                BatesConfidence.PROBABLE,
                (
                    f"{len(unique)} of {page_count} page(s) carried a readable Bates "
                    "stamp; end extended by page count"
                ),
            )
        return (
            begin,
            end,
            BatesSource.OBSERVED_ON_PAGE,
            BatesConfidence.PROBABLE,
            f"{len(unique)} Bates value(s) observed; coverage not contiguous",
        )

    if filename_number is not None:
        if page_count and page_count > 0:
            return (
                filename_number,
                filename_number + page_count - 1,
                BatesSource.CALCULATED,
                BatesConfidence.POSSIBLE,
                (
                    "No Bates stamp readable on any page; range calculated from the "
                    f"filename number and a {page_count}-page count"
                ),
            )
        return (
            filename_number,
            filename_number,
            BatesSource.PARSED_FROM_FILENAME,
            BatesConfidence.POSSIBLE,
            "No Bates stamp readable and no page count; filename number used as-is",
        )

    return (
        None,
        None,
        BatesSource.UNKNOWN,
        BatesConfidence.UNKNOWN,
        "No Bates value found in the filename or on any page",
    )


def find_filename_gaps(numbers: Iterable[int]) -> list[BatesGap]:
    """Find numeric jumps between consecutive filename Bates numbers.

    Every gap returned is marked ``preliminary=True``. Multi-page documents
    legitimately consume the intervening numbers, so these are candidates
    for review, not confirmed missing documents.
    """
    ordered = sorted({int(value) for value in numbers})
    gaps: list[BatesGap] = []
    for previous, current in zip(ordered, ordered[1:]):
        if current > previous + 1:
            gaps.append(
                BatesGap(
                    after=previous,
                    before=current,
                    missing_count=current - previous - 1,
                    preliminary=True,
                    basis=(
                        "Filename sequence only. Intervening numbers may be interior "
                        "pages of the preceding multi-page document."
                    ),
                )
            )
    return gaps


def find_range_gaps(ranges: Sequence[BatesRange]) -> tuple[list[BatesGap], list[tuple[BatesRange, BatesRange]]]:
    """Find gaps and overlaps across resolved begin/end Bates ranges.

    Args:
        ranges: Resolved document ranges. Order does not matter.

    Returns:
        ``(gaps, overlaps)`` where gaps are runs of numbers no document
        covers, and overlaps are pairs of ranges that share numbers. Gaps
        here are **not** preliminary: they account for page counts.
    """
    if not ranges:
        return [], []

    ordered = sorted(ranges, key=lambda item: (item.begin, item.end))
    gaps: list[BatesGap] = []
    overlaps: list[tuple[BatesRange, BatesRange]] = []

    highest = ordered[0].end
    highest_range = ordered[0]
    for current in ordered[1:]:
        if current.begin <= highest:
            overlaps.append((highest_range, current))
        elif current.begin > highest + 1:
            gaps.append(
                BatesGap(
                    after=highest,
                    before=current.begin,
                    missing_count=current.begin - highest - 1,
                    preliminary=False,
                    basis="Resolved begin/end ranges, page counts accounted for",
                )
            )
        if current.end > highest:
            highest = current.end
            highest_range = current
    return gaps, overlaps


__all__ = [
    "BatesConfidence",
    "BatesGap",
    "BatesRange",
    "BatesSource",
    "ParsedBates",
    "find_filename_gaps",
    "find_range_gaps",
    "format_bates",
    "parse_filename_bates",
    "parse_page_bates",
    "resolve_document_range",
]
