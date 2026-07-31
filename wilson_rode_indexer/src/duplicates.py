"""Duplicate and near-duplicate detection.

Three independent methods, reported separately so a reviewer can see
*why* two documents were grouped:

1. **Exact binary** - identical SHA-256 over the file bytes. The strongest
   signal: the files are the same document, byte for byte.
2. **Normalized text** - identical SHA-256 over text that has been
   lower-cased, whitespace-collapsed, and stripped of Bates stamps. Catches
   the same document re-rendered by a different PDF producer.
3. **Near duplicate** - SimHash over word shingles, compared only within
   shared LSH bands.

Why banding matters
-------------------
A naive near-duplicate pass compares every document against every other:
50,000 documents would be 1.25 billion comparisons. Instead each 64-bit
SimHash is split into ``bands`` slices; two documents are only compared
when at least one slice matches exactly. Documents within a small Hamming
distance must share a slice by the pigeonhole principle, so recall stays
high while the comparison count drops by orders of magnitude.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Mapping, Sequence

from src.logging_setup import get_logger

LOG = get_logger("duplicates")

_WHITESPACE = re.compile(r"\s+")
_BATES_STAMP = re.compile(r"\b[A-Z]{4,}[\s_-]?\d{4,10}\b", re.IGNORECASE)
_PAGE_MARKER = re.compile(r"\bpage\s+\d+\s+of\s+\d+\b", re.IGNORECASE)
_NON_WORD = re.compile(r"[^\w\s]")


class DuplicateMethod(str, Enum):
    """How a duplicate group was established."""

    EXACT_BINARY = "exact_binary"
    NORMALIZED_TEXT = "normalized_text"
    NEAR_DUPLICATE = "near_duplicate"


class DuplicateRelation(str, Enum):
    """Refined description of the relationship between group members."""

    EXACT_BINARY = "Exact binary duplicate"
    SAME_TEXT_DIFFERENT_RENDERING = "Same text, different PDF rendering"
    CHAIN_CONTAINS_EARLIER = "Email chain containing an earlier email"
    DRAFT_AND_FINAL = "Draft and final"
    NEAR_DUPLICATE = "Near duplicate"
    POSSIBLE_DUPLICATE = "Possible duplicate"


@dataclass(frozen=True)
class DuplicateMember:
    """One document's membership in a duplicate group."""

    group_id: str
    method: str
    file_id: int
    is_primary: bool
    relation: str
    similarity: float | None = None


def normalize_text(
    text: str,
    *,
    lowercase: bool = True,
    collapse_whitespace: bool = True,
    strip_bates: bool = True,
    strip_digits: bool = False,
) -> str:
    """Normalise text so that cosmetic differences stop mattering.

    Bates stamps are removed by default: two copies of the same document
    produced at different Bates ranges are the same document for review
    purposes, and leaving the stamps in would defeat text-duplicate
    detection entirely.
    """
    result = text or ""
    if strip_bates:
        result = _BATES_STAMP.sub(" ", result)
        result = _PAGE_MARKER.sub(" ", result)
    if lowercase:
        result = result.lower()
    result = _NON_WORD.sub(" ", result)
    if strip_digits:
        result = re.sub(r"\d+", " ", result)
    if collapse_whitespace:
        result = _WHITESPACE.sub(" ", result)
    return result.strip()


def text_fingerprint(normalized: str) -> str:
    """SHA-256 of normalised text, used for text-duplicate grouping."""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _shingles(normalized: str, size: int) -> list[str]:
    """Build overlapping word shingles from normalised text."""
    words = normalized.split()
    if len(words) < size:
        return [" ".join(words)] if words else []
    return [" ".join(words[index : index + size]) for index in range(len(words) - size + 1)]


def simhash(normalized: str, *, bits: int = 64, shingle_words: int = 5) -> int:
    """Compute a SimHash fingerprint of normalised text.

    Each shingle contributes +1/-1 to every bit position according to its
    own hash; the sign of each accumulated position becomes that bit. Two
    documents that share most shingles therefore agree on most bits.

    Args:
        normalized: Text already passed through :func:`normalize_text`.
        bits: Fingerprint width (64 is standard and plenty here).
        shingle_words: Words per shingle. Larger values are stricter.

    Returns:
        The fingerprint as an integer. Returns 0 for empty input, which
        callers must treat as "no fingerprint" rather than a real value.
    """
    shingles = _shingles(normalized, shingle_words)
    if not shingles:
        return 0
    vector = [0] * bits
    for shingle in shingles:
        digest = int.from_bytes(
            hashlib.blake2b(shingle.encode("utf-8"), digest_size=(bits + 7) // 8).digest(),
            "big",
        )
        for position in range(bits):
            vector[position] += 1 if (digest >> position) & 1 else -1
    fingerprint = 0
    for position in range(bits):
        if vector[position] > 0:
            fingerprint |= 1 << position
    return fingerprint


def hamming_distance(left: int, right: int) -> int:
    """Number of differing bits between two fingerprints."""
    return bin(left ^ right).count("1")


def _bands(fingerprint: int, *, bits: int, bands: int) -> list[tuple[int, int]]:
    """Split a fingerprint into ``(band_index, band_value)`` pairs."""
    width = max(1, bits // bands)
    result: list[tuple[int, int]] = []
    for index in range(bands):
        shift = index * width
        mask = (1 << width) - 1
        result.append((index, (fingerprint >> shift) & mask))
    return result


def find_near_duplicates(
    fingerprints: Mapping[int, int],
    *,
    bits: int = 64,
    bands: int = 8,
    max_distance: int = 3,
    max_candidates_per_document: int = 200,
) -> list[tuple[int, int, int]]:
    """Find near-duplicate pairs using banded LSH over SimHash values.

    Args:
        fingerprints: ``file_id -> simhash``. Zero values are ignored.
        bits: Fingerprint width.
        bands: Number of LSH bands. More bands means higher recall and
            more candidate comparisons.
        max_distance: Maximum Hamming distance to accept as a match.
        max_candidates_per_document: Hard cap on comparisons per document,
            protecting against a pathological band with thousands of
            members (which happens with boilerplate-heavy documents).

    Returns:
        ``(file_id_a, file_id_b, distance)`` tuples with ``a < b``.
    """
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for file_id, fingerprint in fingerprints.items():
        if not fingerprint:
            continue
        for band in _bands(fingerprint, bits=bits, bands=bands):
            buckets[band].append(file_id)

    checked: set[tuple[int, int]] = set()
    comparisons: dict[int, int] = defaultdict(int)
    matches: list[tuple[int, int, int]] = []

    for members in buckets.values():
        if len(members) < 2:
            continue
        if len(members) > max_candidates_per_document:
            LOG.debug(
                "Oversized LSH bucket truncated",
                extra={"members": len(members), "cap": max_candidates_per_document},
            )
            members = members[:max_candidates_per_document]
        for index, left in enumerate(members):
            for right in members[index + 1 :]:
                pair = (left, right) if left < right else (right, left)
                if pair in checked:
                    continue
                if comparisons[pair[0]] >= max_candidates_per_document:
                    break
                checked.add(pair)
                comparisons[pair[0]] += 1
                distance = hamming_distance(fingerprints[pair[0]], fingerprints[pair[1]])
                if distance <= max_distance:
                    matches.append((pair[0], pair[1], distance))

    LOG.info(
        "Near-duplicate scan complete",
        extra={
            "fingerprints": len(fingerprints),
            "comparisons": len(checked),
            "matches": len(matches),
        },
    )
    return matches


def connected_components(pairs: Iterable[tuple[int, int, int]]) -> list[set[int]]:
    """Group matched pairs into connected components (union-find)."""
    parent: dict[int, int] = {}

    def find(node: int) -> int:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left, right, _distance in pairs:
        union(left, right)

    groups: dict[int, set[int]] = defaultdict(set)
    for node in parent:
        groups[find(node)].add(node)
    return [members for members in groups.values() if len(members) > 1]


def refine_relation(
    *,
    method: DuplicateMethod,
    left_chars: int,
    right_chars: int,
    left_embedded: int,
    right_embedded: int,
    left_type: str | None,
    right_type: str | None,
    left_title: str | None,
    right_title: str | None,
    distance: int | None = None,
) -> DuplicateRelation:
    """Refine a raw duplicate grouping into a descriptive relation.

    The refinement is heuristic and is presented to reviewers as such: it
    explains the likely reason two documents matched, not a certainty.
    """
    if method is DuplicateMethod.EXACT_BINARY:
        return DuplicateRelation.EXACT_BINARY
    if method is DuplicateMethod.NORMALIZED_TEXT:
        return DuplicateRelation.SAME_TEXT_DIFFERENT_RENDERING

    email_types = {"Email", "Email chain"}
    if (left_type in email_types or right_type in email_types) and (
        left_embedded != right_embedded
    ):
        return DuplicateRelation.CHAIN_CONTAINS_EARLIER

    for title in (left_title or "", right_title or ""):
        if re.search(r"\bdraft\b", title, re.IGNORECASE):
            return DuplicateRelation.DRAFT_AND_FINAL

    larger = max(left_chars, right_chars) or 1
    ratio = min(left_chars, right_chars) / larger
    if distance is not None and distance <= 1 and ratio > 0.9:
        return DuplicateRelation.NEAR_DUPLICATE
    if ratio < 0.6:
        return DuplicateRelation.POSSIBLE_DUPLICATE
    return DuplicateRelation.NEAR_DUPLICATE


def build_exact_binary_groups(
    rows: Sequence[Mapping[str, object]]
) -> list[DuplicateMember]:
    """Group files by SHA-256.

    Args:
        rows: Mappings with ``id``, ``sha256``, and ``rel_path`` keys.

    Returns:
        Members of every group of two or more byte-identical files. The
        lowest ``rel_path`` is designated primary so the choice is stable
        across runs.
    """
    by_hash: dict[str, list[Mapping[str, object]]] = defaultdict(list)
    for row in rows:
        digest = row.get("sha256")
        if digest:
            by_hash[str(digest)].append(row)

    members: list[DuplicateMember] = []
    for digest, group in by_hash.items():
        if len(group) < 2:
            continue
        ordered = sorted(group, key=lambda item: str(item.get("rel_path", "")))
        group_id = f"BIN-{digest[:16]}"
        for position, row in enumerate(ordered):
            members.append(
                DuplicateMember(
                    group_id=group_id,
                    method=DuplicateMethod.EXACT_BINARY.value,
                    file_id=int(row["id"]),  # type: ignore[arg-type]
                    is_primary=position == 0,
                    relation=DuplicateRelation.EXACT_BINARY.value,
                    similarity=1.0,
                )
            )
    return members


def build_text_groups(
    fingerprints: Mapping[int, str], *, order_key: Mapping[int, str] | None = None
) -> list[DuplicateMember]:
    """Group files by normalised-text fingerprint.

    Args:
        fingerprints: ``file_id -> normalized text SHA-256``.
        order_key: Optional ``file_id -> sort key`` used to pick a stable
            primary. Defaults to the numeric file id.

    Returns:
        Members of every text-identical group of two or more documents.
    """
    by_hash: dict[str, list[int]] = defaultdict(list)
    for file_id, digest in fingerprints.items():
        if digest:
            by_hash[digest].append(file_id)

    members: list[DuplicateMember] = []
    for digest, file_ids in by_hash.items():
        if len(file_ids) < 2:
            continue
        ordered = sorted(
            file_ids, key=lambda fid: (order_key or {}).get(fid, f"{fid:012d}")
        )
        group_id = f"TXT-{digest[:16]}"
        for position, file_id in enumerate(ordered):
            members.append(
                DuplicateMember(
                    group_id=group_id,
                    method=DuplicateMethod.NORMALIZED_TEXT.value,
                    file_id=file_id,
                    is_primary=position == 0,
                    relation=DuplicateRelation.SAME_TEXT_DIFFERENT_RENDERING.value,
                    similarity=1.0,
                )
            )
    return members


def build_near_duplicate_groups(
    pairs: Sequence[tuple[int, int, int]],
    *,
    bits: int = 64,
    order_key: Mapping[int, str] | None = None,
) -> list[DuplicateMember]:
    """Turn near-duplicate pairs into stable, labelled groups.

    Similarity is reported as ``1 - distance / bits`` so that a reviewer
    sees a comparable number rather than a raw Hamming distance.
    """
    best_distance: dict[int, int] = {}
    for left, right, distance in pairs:
        for node in (left, right):
            if node not in best_distance or distance < best_distance[node]:
                best_distance[node] = distance

    members: list[DuplicateMember] = []
    for index, component in enumerate(sorted(connected_components(pairs), key=min)):
        ordered = sorted(
            component, key=lambda fid: (order_key or {}).get(fid, f"{fid:012d}")
        )
        group_id = f"NEAR-{index + 1:06d}"
        for position, file_id in enumerate(ordered):
            distance = best_distance.get(file_id, bits)
            members.append(
                DuplicateMember(
                    group_id=group_id,
                    method=DuplicateMethod.NEAR_DUPLICATE.value,
                    file_id=file_id,
                    is_primary=position == 0,
                    relation=DuplicateRelation.NEAR_DUPLICATE.value,
                    similarity=round(1.0 - distance / bits, 4),
                )
            )
    return members


__all__ = [
    "DuplicateMember",
    "DuplicateMethod",
    "DuplicateRelation",
    "build_exact_binary_groups",
    "build_near_duplicate_groups",
    "build_text_groups",
    "connected_components",
    "find_near_duplicates",
    "hamming_distance",
    "normalize_text",
    "refine_relation",
    "simhash",
    "text_fingerprint",
]
