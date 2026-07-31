"""Issue tagging and transparent priority scoring.

Issue tags are a **screening tool**. A tag means a configured term
appeared in text extracted from the document. It is not a legal
conclusion, an admission, a privilege determination, or evidence of
anything. Terms are broad on purpose - over-inclusive screening is the
point, because a reviewer can discard a false positive far more cheaply
than they can find a document nobody surfaced.

Privacy note
------------
Hit records store a *structural locator* (page number and character
offset) rather than surrounding text, unless ``issue_tags.context_chars``
is explicitly raised above zero in config.yaml. The default of zero keeps
confidential passages out of the workbooks entirely.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from src.logging_setup import get_logger

LOG = get_logger("issue_tags")


@dataclass(frozen=True)
class TagHit:
    """One matching term within one document."""

    tag: str
    term: str
    page_number: int | None
    hit_count: int
    locator: str


@dataclass
class TagResult:
    """All tag hits for a document, plus a per-tag summary."""

    hits: list[TagHit] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def tags(self) -> list[str]:
        """Distinct tags present, sorted for stable output."""
        return sorted(self.counts)

    @property
    def joined(self) -> str:
        """Tags rendered for a spreadsheet cell."""
        return "; ".join(self.tags)


def compile_terms(terms_config: Mapping[str, Sequence[str]]) -> dict[str, list[tuple[str, re.Pattern[str]]]]:
    """Compile the configured tag dictionary into regexes.

    Each term becomes a word-boundary, case-insensitive pattern. Terms
    containing regex metacharacters (``502(b)(7)``) are escaped, and
    boundaries are only applied where they are meaningful, so a term that
    starts or ends with punctuation still matches.

    Args:
        terms_config: ``issue_tags.terms`` from config.yaml.

    Returns:
        ``tag -> [(term, compiled_pattern), ...]``.
    """
    compiled: dict[str, list[tuple[str, re.Pattern[str]]]] = {}
    for tag, terms in (terms_config or {}).items():
        entries: list[tuple[str, re.Pattern[str]]] = []
        for term in terms or []:
            text = str(term).strip()
            if not text:
                continue
            escaped = re.escape(text)
            prefix = r"\b" if text[0].isalnum() else ""
            suffix = r"\b" if text[-1].isalnum() else ""
            try:
                entries.append((text, re.compile(f"{prefix}{escaped}{suffix}", re.IGNORECASE)))
            except re.error:  # pragma: no cover - escaping makes this unreachable
                LOG.warning("Skipping uncompilable issue term", extra={"tag": tag, "term": text})
        if entries:
            compiled[str(tag)] = entries
    return compiled


def _page_index(page_texts: Sequence[str]) -> list[tuple[int, int, int]]:
    """Build ``(page_number, start_offset, end_offset)`` for joined text."""
    index: list[tuple[int, int, int]] = []
    offset = 0
    for number, text in enumerate(page_texts, start=1):
        length = len(text)
        index.append((number, offset, offset + length))
        offset += length + 1  # the newline used to join pages
    return index


def _locate_page(offset: int, index: Sequence[tuple[int, int, int]]) -> int | None:
    """Map a character offset in the joined text back to a page number."""
    for number, start, end in index:
        if start <= offset < end:
            return number
    return index[-1][0] if index else None


def tag_document(
    text: str,
    compiled_terms: Mapping[str, Sequence[tuple[str, re.Pattern[str]]]],
    *,
    page_texts: Sequence[str] | None = None,
    max_hits_per_tag: int = 25,
    context_chars: int = 0,
) -> TagResult:
    """Apply the issue-tag dictionary to a document's extracted text.

    Args:
        text: The document's extracted text.
        compiled_terms: Output of :func:`compile_terms`.
        page_texts: Optional per-page text, enabling page-accurate hit
            locations. When omitted, hits carry offsets but no page.
        max_hits_per_tag: Cap on stored hit records per tag, per document.
        context_chars: Characters of surrounding text to retain. **Leave
            at 0** unless a privileged reviewer has decided that excerpt
            text may appear in the workbooks.

    Returns:
        A :class:`TagResult`. ``counts`` holds total matches per tag even
        when the stored hit records were capped.
    """
    body = text or ""
    result = TagResult()
    if not body.strip():
        return result

    index = _page_index(page_texts) if page_texts else []
    stored: dict[str, int] = defaultdict(int)

    for tag, entries in compiled_terms.items():
        total = 0
        for term, pattern in entries:
            matches = list(pattern.finditer(body))
            if not matches:
                continue
            total += len(matches)
            if stored[tag] >= max_hits_per_tag:
                continue
            offset = matches[0].start()
            page = _locate_page(offset, index) if index else None
            if context_chars > 0:
                start = max(0, offset - context_chars // 2)
                locator = body[start : offset + context_chars // 2].replace("\n", " ").strip()
            else:
                locator = f"page {page}, offset {offset}" if page else f"offset {offset}"
            result.hits.append(
                TagHit(
                    tag=tag,
                    term=term,
                    page_number=page,
                    hit_count=len(matches),
                    locator=locator,
                )
            )
            stored[tag] += 1
        if total:
            result.counts[tag] = total

    return result


# ---------------------------------------------------------------------------
# Priority scoring
# ---------------------------------------------------------------------------


@dataclass
class PriorityResult:
    """A priority score together with the reasons that produced it."""

    score: float
    components: list[str] = field(default_factory=list)

    @property
    def explanation(self) -> str:
        """Auditable one-line explanation for the workbook."""
        if not self.components:
            return "No scoring factors matched"
        return "; ".join(self.components)


def _participant_hit(patterns: Sequence[str], *fields: str | None) -> bool:
    """True when any pattern matches any supplied header field."""
    haystack = " ".join(value for value in fields if value)
    if not haystack:
        return False
    for source in patterns:
        try:
            if re.search(str(source), haystack, re.IGNORECASE):
                return True
        except re.error:  # pragma: no cover - config authoring error
            continue
    return False


def score_document(
    *,
    tags: Sequence[str],
    config: Mapping[str, Any],
    email_from: str | None = None,
    email_to: str | None = None,
    email_cc: str | None = None,
    document_date: str | None = None,
    is_duplicate_secondary: bool = False,
    is_unique: bool = True,
    manual_review: bool = False,
) -> PriorityResult:
    """Compute a transparent, additive priority score.

    Every component that fires appends a human-readable line to the
    explanation, so a reviewer can always see exactly why a document rose
    or fell in the queue.

    A high score means "review this early". **It does not indicate
    malpractice, liability, or any legal conclusion**, and the reports say
    so alongside the column.

    Args:
        tags: Issue tags present on the document.
        config: The ``priority`` section of config.yaml.
        email_from: Top-level message sender, if any.
        email_to: Top-level recipients, if any.
        email_cc: Top-level CC recipients, if any.
        document_date: ISO date used for key-event proximity.
        is_duplicate_secondary: True when this is a non-primary member of
            an exact-duplicate group.
        is_unique: True when the document belongs to no duplicate group.
        manual_review: True when the document is flagged for manual review.

    Returns:
        A :class:`PriorityResult`.
    """
    from datetime import date as date_type

    score = 0.0
    components: list[str] = []

    tag_points: Mapping[str, Any] = config.get("tag_points", {}) or {}
    for tag in sorted(set(tags)):
        points = float(tag_points.get(tag, 0) or 0)
        if points:
            score += points
            components.append(f"{tag} +{points:g}")

    multi = config.get("multi_tag_bonus", {}) or {}
    threshold = int(multi.get("threshold", 0) or 0)
    if threshold and len(set(tags)) >= threshold:
        bonus = float(multi.get("points", 0) or 0)
        score += bonus
        components.append(f"{len(set(tags))} distinct tags (>= {threshold}) +{bonus:g}")

    participant_points: Mapping[str, Any] = config.get("participant_points", {}) or {}
    participant_patterns: Mapping[str, Any] = config.get("participant_patterns", {}) or {}
    for key, points_value in participant_points.items():
        patterns = participant_patterns.get(key) or []
        if _participant_hit(patterns, email_from, email_to, email_cc):
            points = float(points_value or 0)
            score += points
            components.append(f"{key} in an email header +{points:g}")

    if is_duplicate_secondary:
        penalty = float(config.get("duplicate_penalty", 0) or 0)
        score += penalty
        components.append(f"secondary copy of an exact duplicate {penalty:+g}")
    elif is_unique:
        points = float(config.get("unique_content_points", 0) or 0)
        if points:
            score += points
            components.append(f"not part of any duplicate group +{points:g}")

    event_dates = config.get("key_event_dates") or []
    window = int(config.get("key_event_window_days", 0) or 0)
    if event_dates and window and document_date:
        try:
            doc_date = date_type.fromisoformat(document_date)
        except ValueError:
            doc_date = None
        if doc_date is not None:
            for raw_event in event_dates:
                try:
                    event = date_type.fromisoformat(str(raw_event))
                except ValueError:
                    continue
                delta = abs((doc_date - event).days)
                if delta <= window:
                    points = float(config.get("key_event_points", 0) or 0)
                    score += points
                    components.append(
                        f"within {delta}d of key event {event.isoformat()} +{points:g}"
                    )
                    break

    if manual_review:
        points = float(config.get("manual_review_points", 0) or 0)
        if points:
            score += points
            components.append(f"flagged for manual review +{points:g}")

    return PriorityResult(score=round(score, 2), components=components)


__all__ = [
    "PriorityResult",
    "TagHit",
    "TagResult",
    "compile_terms",
    "score_document",
    "tag_document",
]
