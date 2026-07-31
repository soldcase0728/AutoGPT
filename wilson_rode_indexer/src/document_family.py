"""Inference of parent-email / attachment relationships.

Every relationship produced here is an **inference**, never native family
metadata. A conventional e-discovery production ships parent/child
relationships in a load file; this production does not, so relationships
must be reconstructed from observable signals:

* **Bates adjacency** - an attachment normally follows its parent email
  immediately in the Bates sequence.
* **Attachment names** - an email's ``Attachments:`` header or a filename
  referenced in its body, fuzzy-matched against candidate documents.
* **Dates** - a candidate whose apparent date is at or near the email's.
* **Subjects** - a candidate whose title echoes the email's subject.

Signals are combined into a confidence label, and the reason string always
records which signals fired so a reviewer can audit the call.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any, Mapping, Sequence

from rapidfuzz import fuzz

from src.logging_setup import get_logger

LOG = get_logger("document_family")


class RelationshipType(str, Enum):
    """Kind of inferred relationship."""

    PARENT_EMAIL_TO_ATTACHMENT = "Parent email to attachment"
    ATTACHMENT_TO_PARENT_EMAIL = "Attachment to parent email"
    SEQUENTIAL_CONTINUATION = "Sequential continuation of the same document"


class FamilyConfidence(str, Enum):
    """Confidence in an inferred relationship."""

    CONFIRMED = "Confirmed"
    PROBABLE = "Probable"
    POSSIBLE = "Possible"
    UNKNOWN = "Unknown"


@dataclass
class FamilyCandidate:
    """The document facts family inference needs.

    Deliberately narrow: this module never sees document text, only the
    already-derived structural and metadata fields.
    """

    file_id: int
    rel_path: str
    filename: str
    begin_bates: int | None
    end_bates: int | None
    document_type: str | None
    title: str | None
    subject: str | None
    document_date: str | None
    attachment_names: Sequence[str] = field(default_factory=tuple)
    page_count: int | None = None

    @property
    def is_email(self) -> bool:
        """True when the derived type is an email or email chain."""
        return (self.document_type or "").lower().startswith("email")


@dataclass(frozen=True)
class FamilyRelationship:
    """One inferred parent/child link, with its supporting reasons."""

    parent_file_id: int
    child_file_id: int
    parent_bates: str | None
    child_bates: str | None
    relationship_type: str
    confidence: str
    reason: str


def _parse_iso(value: str | None) -> date | None:
    """Parse an ISO date string, returning None on anything unusable."""
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _normalise_name(value: str) -> str:
    """Strip extension and punctuation so names compare meaningfully."""
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", value or "")
    return re.sub(r"[^a-z0-9]+", " ", stem.lower()).strip()


def name_similarity(reference: str, candidate: str) -> float:
    """Fuzzy similarity (0-100) between two filenames or titles."""
    left, right = _normalise_name(reference), _normalise_name(candidate)
    if not left or not right:
        return 0.0
    return float(max(fuzz.token_set_ratio(left, right), fuzz.partial_ratio(left, right)))


def infer_families(
    candidates: Sequence[FamilyCandidate],
    *,
    config: Mapping[str, Any],
    bates_prefix: str = "WILSONRODE",
    bates_digits: int = 6,
) -> list[FamilyRelationship]:
    """Infer parent/child relationships across the production.

    The scan is linear in Bates order: for each email, only the documents
    within ``family.max_bates_span`` numbers after it are considered. That
    keeps the pass O(n * k) rather than O(n^2).

    Args:
        candidates: Every document with resolved Bates and metadata.
        config: The ``family`` section of config.yaml.
        bates_prefix: Prefix used to render Bates values in the output.
        bates_digits: Zero-pad width for rendered Bates values.

    Returns:
        Inferred relationships. **These are inferences, not native family
        metadata**, and every report that displays them says so.
    """
    max_span = int(config.get("max_bates_span", 50))
    adjacency = int(config.get("adjacency_tolerance", 1))
    filename_threshold = float(config.get("filename_match_threshold", 82))
    subject_threshold = float(config.get("subject_match_threshold", 88))
    max_date_delta = int(config.get("max_date_delta_days", 2))

    ordered = sorted(
        (item for item in candidates if item.begin_bates is not None),
        key=lambda item: (item.begin_bates or 0, item.rel_path),
    )
    if not ordered:
        LOG.info("No documents carried a resolved Bates value; family inference skipped")
        return []

    def render(value: int | None) -> str | None:
        return None if value is None else f"{bates_prefix}{value:0{bates_digits}d}"

    relationships: list[FamilyRelationship] = []
    seen: set[tuple[int, int, str]] = set()

    for index, parent in enumerate(ordered):
        if not parent.is_email:
            continue
        parent_end = parent.end_bates if parent.end_bates is not None else parent.begin_bates
        parent_date = _parse_iso(parent.document_date)

        for child in ordered[index + 1 :]:
            child_begin = child.begin_bates or 0
            if parent_end is None or child_begin > parent_end + max_span:
                break
            if child.file_id == parent.file_id or child.is_email:
                continue

            signals: list[str] = []
            weight = 0

            if child_begin <= (parent_end or 0) + adjacency:
                signals.append(
                    f"child begins at {render(child_begin)}, immediately after the "
                    f"email's last Bates {render(parent_end)}"
                )
                weight += 2

            best_name_score = 0.0
            best_name = ""
            for attachment in parent.attachment_names or ():
                score = max(
                    name_similarity(attachment, child.filename),
                    name_similarity(attachment, child.title or ""),
                )
                if score > best_name_score:
                    best_name_score, best_name = score, attachment
            if best_name_score >= filename_threshold:
                signals.append(
                    f"email references an attachment matching this document "
                    f"('{best_name}', similarity {best_name_score:.0f})"
                )
                weight += 3

            child_date = _parse_iso(child.document_date)
            if parent_date and child_date:
                delta = abs((child_date - parent_date).days)
                if delta <= max_date_delta:
                    signals.append(f"apparent dates agree within {delta} day(s)")
                    weight += 1

            if parent.subject and child.title:
                subject_score = name_similarity(parent.subject, child.title)
                if subject_score >= subject_threshold:
                    signals.append(
                        f"child title echoes the email subject (similarity {subject_score:.0f})"
                    )
                    weight += 2

            if weight == 0:
                continue

            confidence = (
                FamilyConfidence.PROBABLE
                if weight >= 5
                else FamilyConfidence.POSSIBLE
                if weight >= 2
                else FamilyConfidence.UNKNOWN
            )
            key = (parent.file_id, child.file_id, RelationshipType.PARENT_EMAIL_TO_ATTACHMENT.value)
            if key in seen:
                continue
            seen.add(key)

            relationships.append(
                FamilyRelationship(
                    parent_file_id=parent.file_id,
                    child_file_id=child.file_id,
                    parent_bates=render(parent.begin_bates),
                    child_bates=render(child.begin_bates),
                    relationship_type=RelationshipType.PARENT_EMAIL_TO_ATTACHMENT.value,
                    confidence=confidence.value,
                    reason=(
                        "INFERRED (not native family metadata): " + "; ".join(signals)
                    ),
                )
            )

    LOG.info(
        "Family inference complete",
        extra={"documents": len(ordered), "relationships": len(relationships)},
    )
    return relationships


def summarise_for_document(
    relationships: Sequence[FamilyRelationship],
) -> dict[int, dict[str, str]]:
    """Collapse relationships into per-document parent/attachment columns.

    Returns:
        ``file_id -> {"parent_bates", "attachment_bates", "family_confidence"}``
        suitable for the master index. Confidence reported per document is
        the weakest of its relationships, so the column never overstates.
    """
    parents: dict[int, list[str]] = {}
    children: dict[int, list[str]] = {}
    confidences: dict[int, list[str]] = {}
    ranking = {
        FamilyConfidence.CONFIRMED.value: 3,
        FamilyConfidence.PROBABLE.value: 2,
        FamilyConfidence.POSSIBLE.value: 1,
        FamilyConfidence.UNKNOWN.value: 0,
    }

    for relationship in relationships:
        children.setdefault(relationship.parent_file_id, []).append(
            relationship.child_bates or ""
        )
        parents.setdefault(relationship.child_file_id, []).append(
            relationship.parent_bates or ""
        )
        for file_id in (relationship.parent_file_id, relationship.child_file_id):
            confidences.setdefault(file_id, []).append(relationship.confidence)

    summary: dict[int, dict[str, str]] = {}
    for file_id in set(parents) | set(children):
        levels = confidences.get(file_id, [])
        weakest = min(levels, key=lambda value: ranking.get(value, 0)) if levels else ""
        summary[file_id] = {
            "parent_bates": "; ".join(sorted({v for v in parents.get(file_id, []) if v})),
            "attachment_bates": "; ".join(sorted({v for v in children.get(file_id, []) if v})),
            "family_confidence": weakest,
        }
    return summary


__all__ = [
    "FamilyCandidate",
    "FamilyConfidence",
    "FamilyRelationship",
    "RelationshipType",
    "infer_families",
    "name_similarity",
    "summarise_for_document",
]
