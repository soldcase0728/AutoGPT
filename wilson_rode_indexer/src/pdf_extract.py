"""Phase 2: per-page text extraction and page-condition classification.

The pipeline for each page is:

1. Attempt native text extraction (PyMuPDF, falling back to pypdf).
2. Measure characters, words, image count, and approximate image coverage.
3. Look for a Bates stamp in the extracted text - the authoritative
   source, in contrast to the filename.
4. Classify the page condition and, for blank-ish pages, a sub-type.
5. Decide whether OCR is warranted.

OCR, when it runs, is performed by local OCRmyPDF/Tesseract into a **cache
copy** inside the derived-index folder. The source PDF is opened read-only
and never written, annotated, or replaced.

Nothing in this module prints, logs, or returns page text to the terminal.
Text flows only into the FTS5 store via :meth:`Database.store_text`.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Sequence

from src import bates as bates_mod
from src.config import Config
from src.database import STATUS_DONE, STATUS_ERROR, Database, utcnow
from src.logging_setup import get_logger
from src.version import APP_VERSION

LOG = get_logger("pdf_extract")


class PageCondition(str, Enum):
    """Assessment of what a single page contains."""

    SEARCHABLE = "Searchable"
    IMAGE_ONLY = "Image-only"
    OCR_REQUIRED = "OCR required"
    OCR_COMPLETED = "OCR completed"
    APPARENT_BLANK = "Apparent blank"
    BATES_ONLY = "Bates-only page"
    CORRUPT = "Corrupt"
    UNCERTAIN = "Uncertain"


class BlankSubtype(str, Enum):
    """Refinement for blank or Bates-only pages."""

    TRULY_BLANK_CANDIDATE = "Truly blank candidate"
    BATES_STAMP_ONLY = "Bates stamp only"
    POSSIBLE_SEPARATOR = "Possible separator page"
    POSSIBLE_FAILED_EXPORT = "Possible failed export"
    UNCERTAIN = "Uncertain"


class OcrStatus(str, Enum):
    """OCR lifecycle for a page or document."""

    NOT_REQUIRED = "not_required"
    REQUIRED = "required"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    UNAVAILABLE = "unavailable"


@dataclass
class PageResult:
    """Structural findings for one page. Carries no document text."""

    page_number: int
    char_count: int = 0
    word_count: int = 0
    has_text_layer: bool = False
    is_image_only: bool = False
    is_blank_candidate: bool = False
    image_count: int = 0
    image_coverage: float = 0.0
    bates_observed: str | None = None
    bates_observed_num: int | None = None
    condition: str = PageCondition.UNCERTAIN.value
    blank_subtype: str | None = None
    ocr_status: str = OcrStatus.NOT_REQUIRED.value
    notes: str | None = None


@dataclass
class DocumentExtraction:
    """Aggregate extraction result for one PDF.

    ``text`` is populated for in-process use only (FTS storage, tagging,
    duplicate fingerprints). It is never serialised into a report or log.
    """

    rel_path: str
    page_count: int = 0
    pages: list[PageResult] = field(default_factory=list)
    text: str = ""
    total_chars: int = 0
    searchable_pages: int = 0
    image_only_pages: int = 0
    blank_pages: int = 0
    bates_only_pages: int = 0
    ocr_required_pages: int = 0
    ocr_completed_pages: int = 0
    corrupt_pages: int = 0
    observed_bates: list[int] = field(default_factory=list)
    status: str = STATUS_DONE
    error_message: str | None = None
    ocr_status: str = OcrStatus.NOT_REQUIRED.value
    ocr_cache_path: str | None = None

    def summary(self) -> dict[str, Any]:
        """Structural summary safe to log or store as audit detail."""
        payload = asdict(self)
        payload.pop("text", None)
        payload["pages"] = len(self.pages)
        return payload

    @property
    def searchable_status(self) -> str:
        """Document-level searchability label."""
        if self.page_count == 0:
            return "Unknown"
        if self.searchable_pages == self.page_count:
            return "Fully searchable"
        if self.searchable_pages == 0:
            return "No searchable text"
        return "Partially searchable"


def _extract_page_text_pymupdf(page: Any) -> str:
    """Extract text from a PyMuPDF page, tolerating malformed content."""
    try:
        return page.get_text("text") or ""
    except Exception:  # noqa: BLE001 - a bad page must not kill the document
        return ""


def _page_image_metrics(page: Any) -> tuple[int, float]:
    """Return ``(image_count, approximate_area_coverage)`` for a page.

    Coverage is the union-free sum of image bounding-box areas divided by
    the page area, clamped to 1.0. Overlapping images therefore inflate the
    estimate slightly; that is acceptable because the value is used only as
    a threshold for "does this page carry ink".
    """
    try:
        rect = page.rect
        page_area = float(rect.width) * float(rect.height)
        if page_area <= 0:
            return 0, 0.0
        images = page.get_images(full=True)
        if not images:
            return 0, 0.0
        covered = 0.0
        for image in images:
            xref = image[0]
            try:
                for bbox in page.get_image_rects(xref):
                    covered += float(bbox.width) * float(bbox.height)
            except Exception:  # noqa: BLE001 - some xrefs are not placeable
                continue
        return len(images), min(1.0, covered / page_area)
    except Exception:  # noqa: BLE001 - defensive
        return 0, 0.0


def classify_page(
    *,
    char_count: int,
    image_count: int,
    image_coverage: float,
    bates_found: bool,
    text_without_bates_chars: int,
    thresholds: dict[str, float],
    ocr_done: bool = False,
) -> tuple[PageCondition, BlankSubtype | None, str]:
    """Classify a page's condition from its structural measurements.

    Args:
        char_count: Characters of extracted text on the page.
        image_count: Number of embedded images.
        image_coverage: Fraction of page area covered by images (0-1).
        bates_found: Whether a Bates stamp was matched in the text.
        text_without_bates_chars: Character count after removing matched
            Bates stamps - distinguishes "Bates only" from "has content".
        thresholds: Values from ``extraction`` in config.yaml.
        ocr_done: True when OCR has already been applied to this page.

    Returns:
        ``(condition, blank_subtype, reason)``. ``blank_subtype`` is None
        for pages that are not blank-ish.
    """
    min_searchable = int(thresholds["min_chars_searchable"])
    max_blank = int(thresholds["max_chars_apparent_blank"])
    max_bates_only = int(thresholds["max_chars_bates_only"])
    min_uncertain = int(thresholds["min_chars_uncertain"])
    coverage_image_only = float(thresholds["image_coverage_image_only"])
    coverage_blank = float(thresholds["image_coverage_blank"])

    if ocr_done and char_count >= min_searchable:
        return (
            PageCondition.OCR_COMPLETED,
            None,
            f"OCR produced {char_count} characters",
        )

    if char_count >= min_searchable:
        return (
            PageCondition.SEARCHABLE,
            None,
            f"{char_count} characters extracted natively",
        )

    # Bates stamp present but essentially nothing else.
    if bates_found and text_without_bates_chars <= max_bates_only:
        if image_coverage >= coverage_image_only:
            return (
                PageCondition.IMAGE_ONLY,
                None,
                (
                    "Only a Bates stamp is machine-readable, but "
                    f"{image_coverage:.0%} of the page is image content"
                ),
            )
        subtype = (
            BlankSubtype.BATES_STAMP_ONLY
            if image_coverage < coverage_blank
            else BlankSubtype.POSSIBLE_SEPARATOR
        )
        return (
            PageCondition.BATES_ONLY,
            subtype,
            f"Bates stamp only; {text_without_bates_chars} other characters",
        )

    # Image-bearing page with little or no text: a genuine OCR candidate.
    if image_coverage >= coverage_image_only or image_count > 0:
        if image_coverage >= coverage_image_only:
            return (
                PageCondition.OCR_REQUIRED,
                None,
                (
                    f"{char_count} characters of text against {image_coverage:.0%} "
                    "image coverage"
                ),
            )
        return (
            PageCondition.UNCERTAIN,
            BlankSubtype.UNCERTAIN,
            (
                f"{image_count} small image(s), {image_coverage:.1%} coverage, "
                f"{char_count} characters - too little signal to classify"
            ),
        )

    # No meaningful text and no meaningful images.
    if char_count <= max_blank and image_coverage < coverage_blank:
        subtype = (
            BlankSubtype.TRULY_BLANK_CANDIDATE
            if char_count == 0 and image_count == 0
            else BlankSubtype.POSSIBLE_SEPARATOR
        )
        return (
            PageCondition.APPARENT_BLANK,
            subtype,
            f"{char_count} characters, {image_count} image(s), no image coverage",
        )

    if char_count < min_uncertain:
        return (
            PageCondition.UNCERTAIN,
            BlankSubtype.POSSIBLE_FAILED_EXPORT,
            (
                f"{char_count} characters and no image content - a header or footer "
                "fragment, or an export that lost its body"
            ),
        )

    return (
        PageCondition.UNCERTAIN,
        None,
        f"{char_count} characters: below the searchable threshold of {min_searchable}",
    )


def extract_document(
    abs_path: str,
    rel_path: str,
    *,
    thresholds: dict[str, float],
    bates_page_pattern: str,
    bates_prefix: str,
    bates_digits: int,
    max_pages: int = 0,
    max_indexed_chars: int = 0,
) -> dict[str, Any]:
    """Extract per-page structure and text from one PDF.

    Runs inside a worker process, so it takes and returns plain data.

    Args:
        abs_path: Absolute path to the PDF (opened read-only).
        rel_path: Source-relative path used as the document identity.
        thresholds: ``extraction`` config values.
        bates_page_pattern: Regex source for on-page Bates detection.
        bates_prefix: Canonical Bates prefix.
        bates_digits: Canonical zero-pad width.
        max_pages: Hard cap on pages examined; 0 means no cap.
        max_indexed_chars: Cap on characters retained for FTS; 0 = no cap.

    Returns:
        A :class:`DocumentExtraction` as a dict. The ``text`` key is for
        in-process consumption only.
    """
    import fitz

    pattern = re.compile(bates_page_pattern, re.IGNORECASE)
    result = DocumentExtraction(rel_path=rel_path)
    document = None
    text_parts: list[str] = []

    try:
        document = fitz.open(abs_path)
        if document.needs_pass:
            result.status = STATUS_ERROR
            result.error_message = "Password-protected; cannot extract text"
            return _as_payload(result)

        result.page_count = int(document.page_count)
        page_limit = result.page_count if max_pages <= 0 else min(result.page_count, max_pages)

        for index in range(page_limit):
            page_result = PageResult(page_number=index + 1)
            try:
                page = document.load_page(index)
            except Exception as exc:  # noqa: BLE001
                page_result.condition = PageCondition.CORRUPT.value
                page_result.notes = f"Page load failed: {type(exc).__name__}"
                result.corrupt_pages += 1
                result.pages.append(page_result)
                continue

            text = _extract_page_text_pymupdf(page)
            image_count, coverage = _page_image_metrics(page)

            stamps = bates_mod.parse_page_bates(
                text, pattern=pattern, prefix=bates_prefix, expected_digits=bates_digits
            )
            residual = pattern.sub(" ", text)
            residual_chars = len(residual.strip())

            page_result.char_count = len(text.strip())
            page_result.word_count = len(text.split())
            page_result.image_count = image_count
            page_result.image_coverage = round(coverage, 4)
            page_result.has_text_layer = page_result.char_count >= int(
                thresholds["min_chars_searchable"]
            )
            if stamps:
                page_result.bates_observed = stamps[0].normalized
                page_result.bates_observed_num = stamps[0].number
                result.observed_bates.extend(
                    stamp.number for stamp in stamps if stamp.number is not None
                )

            condition, subtype, reason = classify_page(
                char_count=page_result.char_count,
                image_count=image_count,
                image_coverage=coverage,
                bates_found=bool(stamps),
                text_without_bates_chars=residual_chars,
                thresholds=thresholds,
            )
            page_result.condition = condition.value
            page_result.blank_subtype = subtype.value if subtype else None
            page_result.notes = reason
            page_result.is_image_only = condition is PageCondition.IMAGE_ONLY
            page_result.is_blank_candidate = condition in {
                PageCondition.APPARENT_BLANK,
                PageCondition.BATES_ONLY,
            }
            if condition is PageCondition.OCR_REQUIRED:
                page_result.ocr_status = OcrStatus.REQUIRED.value
                result.ocr_required_pages += 1
            if condition is PageCondition.SEARCHABLE:
                result.searchable_pages += 1
            elif condition is PageCondition.IMAGE_ONLY:
                result.image_only_pages += 1
            elif condition is PageCondition.APPARENT_BLANK:
                result.blank_pages += 1
            elif condition is PageCondition.BATES_ONLY:
                result.bates_only_pages += 1

            if text:
                text_parts.append(text)
            result.pages.append(page_result)

        if page_limit < result.page_count:
            LOG.warning(
                "Page cap reached; remaining pages not examined",
                extra={
                    "rel_path": rel_path,
                    "examined": page_limit,
                    "total": result.page_count,
                },
            )

        combined = "\n".join(text_parts)
        if max_indexed_chars > 0:
            combined = combined[:max_indexed_chars]
        result.text = combined
        result.total_chars = len(combined)
        result.status = STATUS_DONE
        if result.ocr_required_pages:
            result.ocr_status = OcrStatus.REQUIRED.value

    except Exception as exc:  # noqa: BLE001 - record and continue the run
        result.status = STATUS_ERROR
        result.error_message = f"{type(exc).__name__}: {exc}"[:500]
    finally:
        if document is not None:
            try:
                document.close()
            except Exception:  # pragma: no cover
                pass

    return _as_payload(result)


def _as_payload(result: DocumentExtraction) -> dict[str, Any]:
    """Render a :class:`DocumentExtraction` as a picklable dict."""
    payload = asdict(result)
    payload["pages"] = [asdict(page) if not isinstance(page, dict) else page for page in result.pages]
    return payload


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------


def ocr_available() -> tuple[bool, str]:
    """Check whether local OCRmyPDF and Tesseract are installed.

    Returns:
        ``(available, message)``. The message names what is missing so the
        README's Homebrew instructions can be quoted back to the user.
    """
    missing = [tool for tool in ("ocrmypdf", "tesseract") if shutil.which(tool) is None]
    if missing:
        return False, "Not installed: " + ", ".join(missing)
    return True, "ocrmypdf and tesseract found on PATH"


def ocr_cache_path(cache_dir: Path, rel_path: str, sha256: str | None) -> Path:
    """Deterministic cache location for a file's OCR derivative.

    The cache key includes the source SHA-256 so that a changed source
    produces a new cache entry rather than silently reusing a stale one.
    """
    digest = sha256 or hashlib.sha256(rel_path.encode("utf-8")).hexdigest()
    stem = Path(rel_path).stem[:80]
    return cache_dir / digest[:2] / f"{stem}.{digest[:16]}.ocr.pdf"


def run_ocr(
    source_pdf: Path,
    cache_target: Path,
    *,
    language: str = "eng",
    extra_args: Sequence[str] = ("--skip-text", "--quiet"),
    timeout_seconds: int = 600,
) -> tuple[bool, str]:
    """OCR a PDF into the derived-index cache.

    The source is passed to ocrmypdf as an input path only; the output path
    is always inside the cache directory. ocrmypdf is never invoked in a
    mode that would replace its input.

    Args:
        source_pdf: Absolute path to the read-only source PDF.
        cache_target: Destination inside ``<output>/ocr_cache``.
        language: Tesseract language code.
        extra_args: Additional ocrmypdf flags.
        timeout_seconds: Hard timeout for the subprocess.

    Returns:
        ``(success, message)``.

    Raises:
        ValueError: if the requested output path equals the input path -
            a guard against ever writing over a source document.
    """
    source_pdf = Path(source_pdf).resolve()
    cache_target = Path(cache_target)
    if cache_target.resolve() == source_pdf:
        raise ValueError("Refusing to OCR a source PDF in place")

    if cache_target.exists():
        return True, "Cache hit; existing OCR derivative reused"

    cache_target.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_target.with_suffix(f".{uuid.uuid4().hex[:8]}.partial")
    command = ["ocrmypdf", "-l", language, *extra_args, str(source_pdf), str(temporary)]

    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except FileNotFoundError:
        return False, "ocrmypdf is not installed"
    except subprocess.TimeoutExpired:
        temporary.unlink(missing_ok=True)
        return False, f"OCR timed out after {timeout_seconds}s"

    if completed.returncode != 0:
        temporary.unlink(missing_ok=True)
        detail = (completed.stderr or "").strip().splitlines()
        return False, f"ocrmypdf exit {completed.returncode}: {detail[-1] if detail else 'unknown'}"

    temporary.replace(cache_target)
    return True, "OCR completed"


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def thresholds_from_config(config: Config) -> dict[str, float]:
    """Extract the numeric ``extraction`` thresholds as a plain dict."""
    section = config.section("extraction")
    return {
        "min_chars_searchable": float(section.get("min_chars_searchable", 100)),
        "max_chars_apparent_blank": float(section.get("max_chars_apparent_blank", 12)),
        "max_chars_bates_only": float(section.get("max_chars_bates_only", 40)),
        "min_chars_uncertain": float(section.get("min_chars_uncertain", 25)),
        "image_coverage_image_only": float(section.get("image_coverage_image_only", 0.10)),
        "image_coverage_blank": float(section.get("image_coverage_blank", 0.01)),
    }


def persist_extraction(
    database: Database,
    file_id: int,
    rel_path: str,
    payload: dict[str, Any],
    *,
    run_id: str | None = None,
) -> None:
    """Write one document's extraction results into the database.

    Text goes to FTS5 only. Everything written to ``files``/``pages`` is
    structural.
    """
    pages = payload.get("pages") or []
    database.replace_pages(
        file_id,
        [
            {
                "page_number": page["page_number"],
                "char_count": page["char_count"],
                "word_count": page["word_count"],
                "has_text_layer": int(bool(page["has_text_layer"])),
                "is_image_only": int(bool(page["is_image_only"])),
                "is_blank_candidate": int(bool(page["is_blank_candidate"])),
                "image_count": page["image_count"],
                "image_coverage": page["image_coverage"],
                "bates_observed": page["bates_observed"],
                "bates_observed_num": page["bates_observed_num"],
                "condition": page["condition"],
                "blank_subtype": page["blank_subtype"],
                "ocr_status": page["ocr_status"],
                "notes": page["notes"],
            }
            for page in pages
        ],
    )

    text = payload.get("text") or ""
    if text:
        database.store_text(file_id, rel_path, text)

    database.update_file(
        rel_path,
        {
            "extraction_status": payload.get("status", STATUS_DONE),
            "ocr_status": payload.get("ocr_status", OcrStatus.NOT_REQUIRED.value),
            "error_message": payload.get("error_message"),
            "last_processed_ts": utcnow(),
            "app_version": APP_VERSION,
        },
    )
    database.audit(
        "extract_document",
        run_id=run_id,
        phase="phase2",
        rel_path=rel_path,
        detail={
            "pages": len(pages),
            "chars": payload.get("total_chars", 0),
            "searchable_pages": payload.get("searchable_pages", 0),
            "ocr_required_pages": payload.get("ocr_required_pages", 0),
            "status": payload.get("status"),
        },
    )


__all__ = [
    "BlankSubtype",
    "DocumentExtraction",
    "OcrStatus",
    "PageCondition",
    "PageResult",
    "classify_page",
    "extract_document",
    "ocr_available",
    "ocr_cache_path",
    "persist_extraction",
    "run_ocr",
    "thresholds_from_config",
]
