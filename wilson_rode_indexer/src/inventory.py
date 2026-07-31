"""Phase 1: structural inventory of the production folder.

Phase 1 deliberately stops short of reading substantive document content.
It walks the source tree, records filesystem facts, computes SHA-256
hashes, parses Bates numbers **from filenames only**, and opens each PDF
just far enough to learn its page count and whether it is encrypted or
unreadable. No page text is extracted, stored, logged, or displayed.

Concurrency model
-----------------
Worker processes are pure functions over a path: they hash and probe, then
return a plain dict. The parent process performs every database write.
That keeps SQLite single-writer and makes the run trivially resumable -
if the process dies, whatever was committed stays committed.

Google Drive placeholders
-------------------------
Drive File Stream can hand back a file that has not been materialised
locally. Reading it raises an OS error or yields a stub. Those files are
retried with exponential backoff and, if still unavailable, recorded as
``cloud_placeholder`` rather than ``corrupt`` - a materially different
finding for a reviewer.
"""

from __future__ import annotations

import fnmatch
import hashlib
import os
import re
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence

from src import bates as bates_mod
from src.config import Config
from src.database import (
    STATUS_DONE,
    STATUS_ERROR,
    STATUS_PLACEHOLDER,
    Database,
    utcnow,
)
from src.logging_setup import get_logger
from src.version import APP_VERSION

LOG = get_logger("inventory")


@dataclass
class FileProbe:
    """Everything Phase 1 learns about one file.

    Attributes are deliberately structural. Nothing here can carry
    document text.
    """

    rel_path: str
    abs_path: str
    filename: str
    extension: str
    file_size: int | None = None
    created_ts: str | None = None
    modified_ts: str | None = None
    sha256: str | None = None
    is_pdf: bool = False
    page_count: int | None = None
    is_encrypted: bool = False
    is_corrupt: bool = False
    is_cloud_placeholder: bool = False
    pdf_open_error: str | None = None
    error_message: str | None = None
    status: str = STATUS_DONE
    retries: int = 0
    notes: list[str] = field(default_factory=list)


def _iso(timestamp: float | None) -> str | None:
    """Convert an epoch timestamp to an ISO-8601 UTC string."""
    if timestamp is None:
        return None
    try:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):  # pragma: no cover - exotic mtimes
        return None


def _creation_timestamp(stat_result: os.stat_result) -> str | None:
    """Best-effort creation time.

    macOS exposes true birth time via ``st_birthtime``. Linux generally
    does not, in which case this returns None rather than substituting
    ``st_ctime`` (inode-change time), which would be misleading in a
    metadata report.
    """
    birthtime = getattr(stat_result, "st_birthtime", None)
    return _iso(birthtime) if birthtime is not None else None


def should_ignore(name: str, patterns: Sequence[str]) -> bool:
    """Return True when a file or directory name matches an ignore glob."""
    return any(fnmatch.fnmatch(name, pattern) for pattern in patterns)


def walk_source(
    source: Path,
    *,
    ignore_names: Sequence[str],
    ignore_dirs: Sequence[str],
    follow_symlinks: bool = False,
) -> Iterator[Path]:
    """Yield every non-ignored file beneath ``source``.

    The walk is read-only: it stats and lists, and never opens, creates,
    or modifies anything.

    Args:
        source: Root of the production folder.
        ignore_names: Glob patterns for filenames to skip.
        ignore_dirs: Glob patterns for directory names to skip wholesale.
        follow_symlinks: Whether to descend into symlinked directories.
            Off by default to avoid loops in synced folders.

    Yields:
        Absolute paths to candidate files.
    """
    for dirpath, dirnames, filenames in os.walk(source, followlinks=follow_symlinks):
        dirnames[:] = [name for name in dirnames if not should_ignore(name, ignore_dirs)]
        base = Path(dirpath)
        for name in filenames:
            if should_ignore(name, ignore_names):
                continue
            yield base / name


def sha256_file(path: Path, chunk_bytes: int = 1024 * 1024) -> str:
    """Stream a file through SHA-256 without loading it into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_bytes), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _looks_like_placeholder(path: Path, size: int, suspect_max_bytes: int) -> bool:
    """Heuristic: does this look like an un-materialised Drive stub?

    A real PDF cannot be a few hundred bytes and still parse. A zero-byte
    or tiny ``.pdf`` in a Drive-synced tree is far more likely to be a
    placeholder than a genuinely corrupt document, so it is retried.
    """
    if size > suspect_max_bytes:
        return False
    try:
        with path.open("rb") as handle:
            header = handle.read(5)
    except OSError:
        return True
    return header != b"%PDF-"


def probe_pdf_structure(path: Path) -> dict[str, Any]:
    """Open a PDF only far enough to learn structural facts.

    Reads the page count and encryption flag. Does **not** extract text,
    render pages, or write anything. The document is opened read-only and
    closed immediately.

    Args:
        path: Absolute path to the PDF.

    Returns:
        Dict with ``page_count``, ``is_encrypted``, ``is_corrupt``, and
        ``pdf_open_error``.
    """
    import fitz  # Imported lazily so non-PDF work does not pay the cost.

    result: dict[str, Any] = {
        "page_count": None,
        "is_encrypted": False,
        "is_corrupt": False,
        "pdf_open_error": None,
    }
    document = None
    try:
        document = fitz.open(path)
        if document.needs_pass:
            # Encrypted with a user password: page count is unavailable
            # without the password, which we will never guess or supply.
            result["is_encrypted"] = True
            result["pdf_open_error"] = "Password-protected (user password required)"
            return result
        result["is_encrypted"] = bool(getattr(document, "is_encrypted", False))
        result["page_count"] = int(document.page_count)
    except Exception as exc:  # noqa: BLE001 - any parse failure is a finding
        result["is_corrupt"] = True
        result["pdf_open_error"] = f"{type(exc).__name__}: {exc}"[:500]
    finally:
        if document is not None:
            try:
                document.close()
            except Exception:  # pragma: no cover - close-time best effort
                pass
    return result


def probe_file(
    abs_path_str: str,
    rel_path: str,
    *,
    pdf_extensions: Sequence[str],
    hash_chunk_bytes: int,
    placeholder_suspect_bytes: int,
    max_retries: int,
    initial_backoff: float,
    max_backoff: float,
) -> dict[str, Any]:
    """Worker entry point: stat, hash, and structurally probe one file.

    This function must stay picklable and free of database access; it runs
    inside a :class:`~concurrent.futures.ProcessPoolExecutor`.

    Args:
        abs_path_str: Absolute path as a string (processes pickle strings
            more cheaply than Path objects).
        rel_path: Path relative to the source root.
        pdf_extensions: Lower-case extensions to treat as PDFs.
        hash_chunk_bytes: Streaming read size for hashing.
        placeholder_suspect_bytes: Size below which a ``.pdf`` is suspected
            to be a cloud placeholder.
        max_retries: Retry attempts for transient/cloud errors.
        initial_backoff: First backoff delay in seconds.
        max_backoff: Ceiling for the doubling backoff.

    Returns:
        A :class:`FileProbe` rendered as a dict.
    """
    path = Path(abs_path_str)
    probe = FileProbe(
        rel_path=rel_path,
        abs_path=abs_path_str,
        filename=path.name,
        extension=path.suffix.lower(),
    )
    probe.is_pdf = probe.extension in {ext.lower() for ext in pdf_extensions}

    backoff = initial_backoff
    for attempt in range(max_retries + 1):
        probe.retries = attempt
        try:
            stat_result = path.stat()
            probe.file_size = int(stat_result.st_size)
            probe.modified_ts = _iso(stat_result.st_mtime)
            probe.created_ts = _creation_timestamp(stat_result)

            if probe.is_pdf and _looks_like_placeholder(
                path, probe.file_size, placeholder_suspect_bytes
            ):
                raise OSError(
                    f"File appears to be an un-materialised cloud placeholder "
                    f"({probe.file_size} bytes, no %PDF- header)"
                )

            probe.sha256 = sha256_file(path, hash_chunk_bytes)

            if probe.is_pdf:
                structure = probe_pdf_structure(path)
                probe.page_count = structure["page_count"]
                probe.is_encrypted = bool(structure["is_encrypted"])
                probe.is_corrupt = bool(structure["is_corrupt"])
                probe.pdf_open_error = structure["pdf_open_error"]

            probe.status = STATUS_DONE
            if attempt:
                probe.notes.append(f"Succeeded after {attempt} retry attempt(s)")
            return asdict(probe)

        except OSError as exc:
            probe.error_message = f"{type(exc).__name__}: {exc}"[:500]
            if attempt < max_retries:
                time.sleep(min(backoff, max_backoff))
                backoff = min(backoff * 2, max_backoff)
                continue
            probe.is_cloud_placeholder = True
            probe.status = STATUS_PLACEHOLDER
            probe.notes.append(
                "Unreadable after retries; treated as a cloud placeholder, not corrupt"
            )
            return asdict(probe)

        except Exception as exc:  # noqa: BLE001 - record, never crash the run
            probe.error_message = f"{type(exc).__name__}: {exc}"[:500]
            probe.is_corrupt = True
            probe.status = STATUS_ERROR
            return asdict(probe)

    return asdict(probe)  # pragma: no cover - loop always returns


@dataclass
class InventoryStats:
    """Aggregate Phase 1 statistics. Safe to print; contains no content."""

    run_id: str = ""
    started_ts: str = ""
    finished_ts: str = ""
    total_files: int = 0
    total_pdfs: int = 0
    total_non_pdfs: int = 0
    total_bytes: int = 0
    processed_now: int = 0
    skipped_resumed: int = 0
    errors: int = 0
    cloud_placeholders: int = 0
    encrypted: int = 0
    corrupt: int = 0
    pdfs_with_page_count: int = 0
    total_pages: int = 0
    min_bates: int | None = None
    max_bates: int | None = None
    bates_parsed: int = 0
    bates_missing: int = 0
    bates_malformed: int = 0
    noncompliant_filenames: int = 0
    duplicate_filename_groups: int = 0
    duplicate_filename_files: int = 0
    exact_duplicate_groups: int = 0
    exact_duplicate_files: int = 0
    redundant_duplicate_files: int = 0
    filename_gap_runs: int = 0
    filename_gap_missing_numbers: int = 0
    page_count_distribution: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-serialisable copy."""
        return asdict(self)


def run_inventory(
    config: Config,
    database: Database,
    *,
    run_id: str | None = None,
    force: bool = False,
    limit: int | None = None,
    progress: bool = True,
) -> InventoryStats:
    """Execute Phase 1 across the whole source tree.

    Args:
        config: Loaded configuration. ``validate_paths`` must already have
            been called by the caller.
        database: Open processing-state database (single writer).
        run_id: Optional explicit run identifier; generated when omitted.
        force: Re-probe every file even if already recorded as done.
        limit: Stop after this many files (useful for smoke tests).
        progress: Show a tqdm progress bar on the terminal.

    Returns:
        Aggregate :class:`InventoryStats`.
    """
    from tqdm import tqdm

    run_id = run_id or f"phase1-{uuid.uuid4().hex[:12]}"
    stats = InventoryStats(run_id=run_id, started_ts=utcnow())

    source = config.paths.source_folder
    inventory_cfg = config.section("inventory")
    placeholder_cfg = config.section("cloud_placeholder")

    database.start_run(
        run_id,
        "phase1",
        {
            "config_path": str(config.config_path),
            "source_folder": str(source),
            "output_folder": str(config.paths.output_folder),
        },
    )
    database.audit(
        "phase1_start",
        run_id=run_id,
        phase="phase1",
        detail={"source": str(source), "force": force, "limit": limit},
    )

    LOG.info("Scanning source folder", extra={"source": str(source)})
    candidates: list[tuple[str, str]] = []
    for path in walk_source(
        source,
        ignore_names=list(inventory_cfg.get("ignore_names", [])),
        ignore_dirs=list(inventory_cfg.get("ignore_dirs", [])),
        follow_symlinks=bool(inventory_cfg.get("follow_symlinks", False)),
    ):
        candidates.append((str(path), str(path.relative_to(source))))
        if limit is not None and len(candidates) >= limit:
            break

    LOG.info("Discovered files", extra={"count": len(candidates)})
    database.audit(
        "walk_complete", run_id=run_id, phase="phase1", detail={"discovered": len(candidates)}
    )

    # Decide what actually needs work (resume support).
    todo: list[tuple[str, str]] = []
    for abs_path, rel_path in candidates:
        if force:
            todo.append((abs_path, rel_path))
            continue
        try:
            stat_result = Path(abs_path).stat()
        except OSError:
            todo.append((abs_path, rel_path))
            continue
        if database.needs_processing(
            rel_path,
            size=stat_result.st_size,
            mtime_iso=_iso(stat_result.st_mtime) or "",
            stage="processing_status",
        ):
            todo.append((abs_path, rel_path))
        else:
            stats.skipped_resumed += 1

    LOG.info(
        "Resume analysis complete",
        extra={"to_process": len(todo), "already_done": stats.skipped_resumed},
    )

    worker_kwargs = {
        "pdf_extensions": list(inventory_cfg.get("pdf_extensions", [".pdf"])),
        "hash_chunk_bytes": int(inventory_cfg.get("hash_chunk_bytes", 1048576)),
        "placeholder_suspect_bytes": int(placeholder_cfg.get("suspect_max_bytes", 1024)),
        "max_retries": int(placeholder_cfg.get("max_retries", 3)),
        "initial_backoff": float(placeholder_cfg.get("initial_backoff_seconds", 2.0)),
        "max_backoff": float(placeholder_cfg.get("max_backoff_seconds", 30.0)),
    }

    filename_pattern = config.compiled("bates.filename_regex")
    compliant_pattern = config.compiled("bates.compliant_filename_regex", flags=0)
    prefix = str(config.get("bates.prefix", "WILSONRODE"))
    expected_digits = int(config.get("bates.expected_digits", 6))

    batch_size = int(config.get("performance.commit_batch_size", 200))
    workers = config.worker_count()
    LOG.info("Probing files", extra={"workers": workers, "count": len(todo)})

    pending: list[dict[str, Any]] = []

    def flush() -> None:
        """Commit the accumulated batch."""
        if not pending:
            return
        database.bulk_upsert_files(pending)
        pending.clear()

    def handle(result: dict[str, Any]) -> None:
        """Fold one worker result into the database batch and stats."""
        parsed = bates_mod.parse_filename_bates(
            result["filename"],
            pattern=filename_pattern,
            prefix=prefix,
            expected_digits=expected_digits,
            compliant_pattern=compliant_pattern,
        )
        notes = list(result.get("notes") or [])
        if parsed.notes:
            notes.append(parsed.notes)

        pending.append(
            {
                "rel_path": result["rel_path"],
                "abs_path": result["abs_path"],
                "filename": result["filename"],
                "extension": result["extension"],
                "file_size": result["file_size"],
                "created_ts": result["created_ts"],
                "modified_ts": result["modified_ts"],
                "sha256": result["sha256"],
                "is_pdf": int(bool(result["is_pdf"])),
                "page_count": result["page_count"],
                "is_encrypted": int(bool(result["is_encrypted"])),
                "is_corrupt": int(bool(result["is_corrupt"])),
                "is_cloud_placeholder": int(bool(result["is_cloud_placeholder"])),
                "pdf_open_error": result["pdf_open_error"],
                "bates_filename_raw": parsed.normalized,
                "bates_filename_num": parsed.number,
                "filename_compliant": int(bool(parsed.compliant and parsed.number is not None)),
                "filename_notes": "; ".join(note for note in notes if note) or None,
                "processing_status": result["status"],
                "error_message": result["error_message"],
                "last_processed_ts": utcnow(),
                "app_version": APP_VERSION,
                "seen_size": result["file_size"],
                "seen_mtime": result["modified_ts"],
            }
        )

        stats.processed_now += 1
        if result["status"] == STATUS_ERROR:
            stats.errors += 1
            LOG.warning(
                "File probe failed",
                extra={"rel_path": result["rel_path"], "error": result["error_message"]},
            )
        if result["is_cloud_placeholder"]:
            stats.cloud_placeholders += 1
            LOG.warning(
                "Cloud placeholder not materialised; will need a re-run once downloaded",
                extra={"rel_path": result["rel_path"]},
            )

        if len(pending) >= batch_size:
            flush()

    iterator = tqdm(
        total=len(todo),
        disable=not progress,
        unit="file",
        desc="Phase 1 inventory",
        mininterval=float(config.get("performance.progress_interval_seconds", 0.5)),
    )

    try:
        if workers <= 1 or len(todo) <= 1:
            for abs_path, rel_path in todo:
                handle(probe_file(abs_path, rel_path, **worker_kwargs))
                iterator.update(1)
        else:
            with ProcessPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(probe_file, abs_path, rel_path, **worker_kwargs): rel_path
                    for abs_path, rel_path in todo
                }
                for future in as_completed(futures):
                    rel_path = futures[future]
                    try:
                        handle(future.result())
                    except Exception as exc:  # noqa: BLE001 - never lose the run
                        stats.errors += 1
                        LOG.error(
                            "Worker raised while probing file",
                            extra={"rel_path": rel_path, "error": str(exc)},
                        )
                        pending.append(
                            {
                                "rel_path": rel_path,
                                "abs_path": str(source / rel_path),
                                "filename": Path(rel_path).name,
                                "extension": Path(rel_path).suffix.lower(),
                                "processing_status": STATUS_ERROR,
                                "error_message": f"{type(exc).__name__}: {exc}"[:500],
                                "last_processed_ts": utcnow(),
                            }
                        )
                    iterator.update(1)
    finally:
        flush()
        iterator.close()

    _assign_duplicate_groups(database)
    _finalise_stats(database, config, stats)

    stats.finished_ts = utcnow()
    database.finish_run(run_id, stats.as_dict())
    database.audit("phase1_complete", run_id=run_id, phase="phase1", detail=stats.as_dict())
    return stats


def _assign_duplicate_groups(database: Database) -> None:
    """Populate ``dup_filename_group`` and ``exact_dup_group`` on files.

    Grouping is exact: identical basenames, and identical SHA-256 digests.
    Near-duplicate work belongs to Phase 3 and is not attempted here.
    """
    with database.transaction() as conn:
        conn.execute("UPDATE files SET dup_filename_group=NULL, exact_dup_group=NULL")
        conn.execute(
            """
            UPDATE files SET dup_filename_group = 'FN-' || lower(filename)
            WHERE filename IN (
                SELECT filename FROM files GROUP BY filename HAVING COUNT(*) > 1
            )
            """
        )
        conn.execute(
            """
            UPDATE files SET exact_dup_group = 'SHA-' || substr(sha256, 1, 16)
            WHERE sha256 IS NOT NULL AND sha256 IN (
                SELECT sha256 FROM files
                WHERE sha256 IS NOT NULL
                GROUP BY sha256 HAVING COUNT(*) > 1
            )
            """
        )


def _finalise_stats(database: Database, config: Config, stats: InventoryStats) -> None:
    """Compute aggregate Phase 1 statistics from the database."""
    stats.total_files = database.count_files()
    stats.total_pdfs = database.count_files("is_pdf = 1")
    stats.total_non_pdfs = stats.total_files - stats.total_pdfs
    stats.total_bytes = int(
        database.scalar("SELECT COALESCE(SUM(file_size), 0) FROM files", default=0)
    )
    stats.encrypted = database.count_files("is_encrypted = 1")
    stats.corrupt = database.count_files("is_corrupt = 1")
    stats.cloud_placeholders = database.count_files("is_cloud_placeholder = 1")
    stats.errors = database.count_files("processing_status = ?", (STATUS_ERROR,))

    stats.pdfs_with_page_count = database.count_files("is_pdf = 1 AND page_count IS NOT NULL")
    stats.total_pages = int(
        database.scalar(
            "SELECT COALESCE(SUM(page_count), 0) FROM files WHERE page_count IS NOT NULL",
            default=0,
        )
    )

    stats.bates_parsed = database.count_files("bates_filename_num IS NOT NULL")
    stats.bates_missing = database.count_files("is_pdf = 1 AND bates_filename_num IS NULL")
    stats.noncompliant_filenames = database.count_files("is_pdf = 1 AND filename_compliant = 0")
    stats.bates_malformed = database.count_files(
        "bates_filename_num IS NOT NULL AND filename_compliant = 0"
    )

    stats.min_bates = database.scalar("SELECT MIN(bates_filename_num) FROM files")
    stats.max_bates = database.scalar("SELECT MAX(bates_filename_num) FROM files")

    stats.duplicate_filename_files = database.count_files("dup_filename_group IS NOT NULL")
    stats.duplicate_filename_groups = int(
        database.scalar(
            "SELECT COUNT(DISTINCT dup_filename_group) FROM files"
            " WHERE dup_filename_group IS NOT NULL",
            default=0,
        )
    )
    stats.exact_duplicate_files = database.count_files("exact_dup_group IS NOT NULL")
    stats.exact_duplicate_groups = int(
        database.scalar(
            "SELECT COUNT(DISTINCT exact_dup_group) FROM files"
            " WHERE exact_dup_group IS NOT NULL",
            default=0,
        )
    )
    stats.redundant_duplicate_files = max(
        0, stats.exact_duplicate_files - stats.exact_duplicate_groups
    )

    numbers = [
        int(row["bates_filename_num"])
        for row in database.query(
            "SELECT bates_filename_num FROM files WHERE bates_filename_num IS NOT NULL"
        )
    ]
    gaps = bates_mod.find_filename_gaps(numbers)
    stats.filename_gap_runs = len(gaps)
    stats.filename_gap_missing_numbers = sum(gap.missing_count for gap in gaps)

    distribution: Counter[str] = Counter()
    for row in database.query(
        "SELECT page_count FROM files WHERE is_pdf = 1 AND page_count IS NOT NULL"
    ):
        distribution[_page_bucket(int(row["page_count"]))] += 1
    order = ["0", "1", "2-5", "6-10", "11-25", "26-50", "51-100", "101-500", "500+"]
    stats.page_count_distribution = {
        bucket: distribution[bucket] for bucket in order if distribution[bucket]
    }


def _page_bucket(pages: int) -> str:
    """Bucket a page count for the distribution histogram."""
    if pages <= 0:
        return "0"
    if pages == 1:
        return "1"
    for upper, label in ((5, "2-5"), (10, "6-10"), (25, "11-25"), (50, "26-50"), (100, "51-100"), (500, "101-500")):
        if pages <= upper:
            return label
    return "500+"


def duplicate_filename_groups(database: Database) -> dict[str, list[Any]]:
    """Return filename -> rows for every repeated basename."""
    groups: dict[str, list[Any]] = defaultdict(list)
    for row in database.iter_files(where="dup_filename_group IS NOT NULL"):
        groups[str(row["dup_filename_group"])].append(row)
    return dict(groups)


def exact_duplicate_groups(database: Database) -> dict[str, list[Any]]:
    """Return SHA group -> rows for every set of byte-identical files."""
    groups: dict[str, list[Any]] = defaultdict(list)
    for row in database.iter_files(where="exact_dup_group IS NOT NULL"):
        groups[str(row["exact_dup_group"])].append(row)
    return dict(groups)


__all__ = [
    "FileProbe",
    "InventoryStats",
    "duplicate_filename_groups",
    "exact_duplicate_groups",
    "probe_file",
    "probe_pdf_structure",
    "run_inventory",
    "sha256_file",
    "should_ignore",
    "walk_source",
]
