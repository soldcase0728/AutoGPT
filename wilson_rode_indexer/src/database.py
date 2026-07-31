"""SQLite persistence layer: the authoritative processing-state store.

Design notes
------------
* **Single writer.** Worker processes never touch the database. They
  return plain dataclasses/dicts to the parent, which performs all writes.
  This sidesteps SQLite lock contention entirely and keeps the audit trail
  ordered.
* **WAL mode** so that a reader (for example an in-progress report) does
  not block the writer.
* **Resumability** lives in :meth:`Database.needs_processing`: a file is
  reprocessed only when it is new, previously failed, was produced by an
  older app version, or its size/mtime changed on disk.
* **FTS5** holds extracted text for search. Full text is never copied into
  Excel; only counts, statuses, and structural locators are.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.logging_setup import get_logger
from src.version import APP_VERSION, SCHEMA_VERSION

LOG = get_logger("database")

# Processing status values used across phases.
STATUS_PENDING = "pending"
STATUS_DONE = "done"
STATUS_ERROR = "error"
STATUS_SKIPPED = "skipped"
STATUS_PLACEHOLDER = "cloud_placeholder"

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- One row per file discovered beneath the source folder. `rel_path` is the
-- stable identity: absolute paths change when the Drive mount moves.
CREATE TABLE IF NOT EXISTS files (
    id                   INTEGER PRIMARY KEY,
    rel_path             TEXT    NOT NULL UNIQUE,
    abs_path             TEXT    NOT NULL,
    filename             TEXT    NOT NULL,
    extension            TEXT    NOT NULL,
    file_size            INTEGER,
    created_ts           TEXT,
    modified_ts          TEXT,
    sha256               TEXT,

    -- Phase 1 structural observations
    is_pdf               INTEGER NOT NULL DEFAULT 0,
    page_count           INTEGER,
    is_encrypted         INTEGER NOT NULL DEFAULT 0,
    is_corrupt           INTEGER NOT NULL DEFAULT 0,
    is_cloud_placeholder INTEGER NOT NULL DEFAULT 0,
    pdf_open_error       TEXT,

    -- Bates parsed from the FILENAME only (preliminary; a PDF may carry
    -- many Bates-stamped pages).
    bates_filename_raw   TEXT,
    bates_filename_num   INTEGER,
    filename_compliant   INTEGER NOT NULL DEFAULT 0,
    filename_notes       TEXT,

    -- Grouping
    dup_filename_group   TEXT,
    exact_dup_group      TEXT,

    -- Processing state machine
    processing_status    TEXT    NOT NULL DEFAULT 'pending',
    extraction_status    TEXT    NOT NULL DEFAULT 'pending',
    ocr_status           TEXT    NOT NULL DEFAULT 'not_required',
    last_processed_ts    TEXT,
    error_message        TEXT,
    app_version          TEXT,

    -- Cached fingerprint used to decide whether to redo work
    seen_size            INTEGER,
    seen_mtime           TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_sha         ON files(sha256);
CREATE INDEX IF NOT EXISTS idx_files_filename    ON files(filename);
CREATE INDEX IF NOT EXISTS idx_files_bates       ON files(bates_filename_num);
CREATE INDEX IF NOT EXISTS idx_files_status      ON files(processing_status);
CREATE INDEX IF NOT EXISTS idx_files_extraction  ON files(extraction_status);

-- One row per page examined in Phase 2.
CREATE TABLE IF NOT EXISTS pages (
    id                INTEGER PRIMARY KEY,
    file_id           INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    page_number       INTEGER NOT NULL,
    char_count        INTEGER NOT NULL DEFAULT 0,
    word_count        INTEGER NOT NULL DEFAULT 0,
    has_text_layer    INTEGER NOT NULL DEFAULT 0,
    is_image_only     INTEGER NOT NULL DEFAULT 0,
    is_blank_candidate INTEGER NOT NULL DEFAULT 0,
    image_count       INTEGER NOT NULL DEFAULT 0,
    image_coverage    REAL    NOT NULL DEFAULT 0.0,
    bates_observed    TEXT,
    bates_observed_num INTEGER,
    condition         TEXT    NOT NULL DEFAULT 'uncertain',
    blank_subtype     TEXT,
    ocr_status        TEXT    NOT NULL DEFAULT 'not_required',
    notes             TEXT,
    UNIQUE(file_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_pages_file      ON pages(file_id);
CREATE INDEX IF NOT EXISTS idx_pages_condition ON pages(condition);
CREATE INDEX IF NOT EXISTS idx_pages_bates     ON pages(bates_observed_num);

-- Extracted text, kept out of every spreadsheet. FTS5 for search only.
CREATE VIRTUAL TABLE IF NOT EXISTS doc_text USING fts5(
    rel_path UNINDEXED,
    body,
    tokenize = 'porter unicode61'
);

-- Maps a doc_text rowid back to files.id (FTS5 tables cannot hold FKs).
CREATE TABLE IF NOT EXISTS doc_text_map (
    file_id     INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    fts_rowid   INTEGER NOT NULL,
    char_count  INTEGER NOT NULL DEFAULT 0,
    normalized_sha256 TEXT,
    simhash     TEXT
);

CREATE INDEX IF NOT EXISTS idx_doctextmap_norm ON doc_text_map(normalized_sha256);

-- Derived review metadata, one row per document (Phase 3).
CREATE TABLE IF NOT EXISTS documents (
    file_id              INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    begin_bates          TEXT,
    end_bates            TEXT,
    begin_bates_num      INTEGER,
    end_bates_num        INTEGER,
    bates_source         TEXT,
    bates_confidence     TEXT,
    page_count           INTEGER,

    document_date        TEXT,
    document_date_confidence TEXT,
    email_sent_date      TEXT,
    email_from           TEXT,
    email_to             TEXT,
    email_cc             TEXT,
    email_bcc            TEXT,
    email_subject        TEXT,
    embedded_message_count INTEGER,
    earliest_message_date TEXT,
    latest_message_date  TEXT,

    author               TEXT,
    title                TEXT,
    court                TEXT,
    case_number          TEXT,
    filing_date          TEXT,
    filing_party         TEXT,
    invoice_date         TEXT,
    vendor               TEXT,
    invoice_amount       TEXT,

    document_type        TEXT,
    document_type_confidence REAL,
    attachment_names     TEXT,
    custodian            TEXT,
    custodian_source     TEXT,

    searchable_status    TEXT,
    ocr_status           TEXT,
    apparent_blank_status TEXT,

    exact_dup_group      TEXT,
    text_dup_group       TEXT,
    near_dup_group       TEXT,

    issue_tags           TEXT,
    priority_score       REAL,
    priority_explanation TEXT,

    extraction_confidence TEXT,
    manual_review        INTEGER NOT NULL DEFAULT 0,
    processing_notes     TEXT,
    app_version          TEXT,
    updated_ts           TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_type     ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_priority ON documents(priority_score);
CREATE INDEX IF NOT EXISTS idx_documents_bates    ON documents(begin_bates_num);

-- Issue-tag hits. `locator` is structural (page + offset), never an excerpt.
CREATE TABLE IF NOT EXISTS issue_hits (
    id          INTEGER PRIMARY KEY,
    file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag         TEXT    NOT NULL,
    term        TEXT    NOT NULL,
    page_number INTEGER,
    hit_count   INTEGER NOT NULL DEFAULT 1,
    locator     TEXT
);

CREATE INDEX IF NOT EXISTS idx_issue_file ON issue_hits(file_id);
CREATE INDEX IF NOT EXISTS idx_issue_tag  ON issue_hits(tag);

-- Inferred parent/child relationships. NEVER native metadata.
CREATE TABLE IF NOT EXISTS families (
    id                INTEGER PRIMARY KEY,
    parent_file_id    INTEGER REFERENCES files(id) ON DELETE CASCADE,
    child_file_id     INTEGER REFERENCES files(id) ON DELETE CASCADE,
    parent_bates      TEXT,
    child_bates       TEXT,
    relationship_type TEXT NOT NULL,
    confidence        TEXT NOT NULL,
    reason            TEXT NOT NULL,
    UNIQUE(parent_file_id, child_file_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_family_parent ON families(parent_file_id);
CREATE INDEX IF NOT EXISTS idx_family_child  ON families(child_file_id);

-- Duplicate groupings across all three detection methods.
CREATE TABLE IF NOT EXISTS duplicate_members (
    id         INTEGER PRIMARY KEY,
    group_id   TEXT    NOT NULL,
    method     TEXT    NOT NULL,     -- exact_binary | normalized_text | near_duplicate
    file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    is_primary INTEGER NOT NULL DEFAULT 0,
    relation   TEXT,                 -- refined relation label
    similarity REAL,
    UNIQUE(group_id, method, file_id)
);

CREATE INDEX IF NOT EXISTS idx_dupmember_file  ON duplicate_members(file_id);
CREATE INDEX IF NOT EXISTS idx_dupmember_group ON duplicate_members(group_id, method);

-- Append-only audit trail of every operation.
CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY,
    ts        TEXT NOT NULL,
    run_id    TEXT,
    phase     TEXT,
    operation TEXT NOT NULL,
    rel_path  TEXT,
    detail    TEXT,
    app_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_log(run_id);

-- One row per invocation, for the Run Statistics tab.
CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    phase       TEXT NOT NULL,
    started_ts  TEXT NOT NULL,
    finished_ts TEXT,
    app_version TEXT,
    config_path TEXT,
    source_folder TEXT,
    output_folder TEXT,
    stats_json  TEXT,
    status      TEXT NOT NULL DEFAULT 'running'
);
"""


def utcnow() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """Thin, explicit wrapper around the processing-state SQLite file.

    The connection is created per-instance and guarded by a lock so the
    parent process can safely write from a progress callback while the
    main loop iterates.
    """

    def __init__(self, db_path: Path, *, read_only: bool = False) -> None:
        """Open (and if necessary create) the database at ``db_path``."""
        self.db_path = Path(db_path)
        self.read_only = read_only
        self._lock = threading.RLock()
        if not read_only:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        uri = f"file:{self.db_path}?mode=ro" if read_only else str(self.db_path)
        self.conn = sqlite3.connect(uri, uri=read_only, timeout=60.0, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        if not read_only:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
            self.conn.execute("PRAGMA foreign_keys=ON")
            self.conn.execute("PRAGMA busy_timeout=60000")
            self._initialise()

    # -- lifecycle --------------------------------------------------------

    def _initialise(self) -> None:
        """Create the schema if absent and record the schema version."""
        with self._lock:
            self.conn.executescript(SCHEMA_SQL)
            self.conn.execute(
                "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(SCHEMA_VERSION),),
            )

    def close(self) -> None:
        """Flush and close the connection."""
        with self._lock:
            try:
                self.conn.commit()
            except sqlite3.Error:  # pragma: no cover - close-time best effort
                pass
            self.conn.close()

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Run a block inside an explicit transaction."""
        with self._lock:
            self.conn.execute("BEGIN")
            try:
                yield self.conn
            except Exception:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    # -- audit ------------------------------------------------------------

    def audit(
        self,
        operation: str,
        *,
        run_id: str | None = None,
        phase: str | None = None,
        rel_path: str | None = None,
        detail: Any = None,
    ) -> None:
        """Append an entry to the immutable audit log.

        ``detail`` is JSON-encoded. Callers must pass only structural
        information - counts, statuses, paths - never document text.
        """
        payload = None if detail is None else json.dumps(detail, default=str)
        with self._lock:
            self.conn.execute(
                "INSERT INTO audit_log(ts, run_id, phase, operation, rel_path, detail, app_version)"
                " VALUES(?,?,?,?,?,?,?)",
                (utcnow(), run_id, phase, operation, rel_path, payload, APP_VERSION),
            )

    def start_run(self, run_id: str, phase: str, config_summary: dict[str, Any]) -> None:
        """Record the beginning of a phase run."""
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO runs(run_id, phase, started_ts, app_version,"
                " config_path, source_folder, output_folder, status)"
                " VALUES(?,?,?,?,?,?,?, 'running')",
                (
                    run_id,
                    phase,
                    utcnow(),
                    APP_VERSION,
                    config_summary.get("config_path"),
                    config_summary.get("source_folder"),
                    config_summary.get("output_folder"),
                ),
            )

    def finish_run(self, run_id: str, stats: dict[str, Any], status: str = "completed") -> None:
        """Record the end of a phase run together with its statistics."""
        with self._lock:
            self.conn.execute(
                "UPDATE runs SET finished_ts=?, stats_json=?, status=? WHERE run_id=?",
                (utcnow(), json.dumps(stats, default=str), status, run_id),
            )

    def latest_run(self, phase: str | None = None) -> sqlite3.Row | None:
        """Return the most recent run row, optionally filtered by phase."""
        if phase:
            cur = self.conn.execute(
                "SELECT * FROM runs WHERE phase=? ORDER BY started_ts DESC LIMIT 1", (phase,)
            )
        else:
            cur = self.conn.execute("SELECT * FROM runs ORDER BY started_ts DESC LIMIT 1")
        return cur.fetchone()

    # -- files ------------------------------------------------------------

    def upsert_file_stub(
        self, *, rel_path: str, abs_path: str, filename: str, extension: str
    ) -> int:
        """Ensure a row exists for a discovered path and return its id."""
        with self._lock:
            self.conn.execute(
                "INSERT INTO files(rel_path, abs_path, filename, extension)"
                " VALUES(?,?,?,?)"
                " ON CONFLICT(rel_path) DO UPDATE SET abs_path=excluded.abs_path",
                (rel_path, abs_path, filename, extension),
            )
            row = self.conn.execute(
                "SELECT id FROM files WHERE rel_path=?", (rel_path,)
            ).fetchone()
        return int(row["id"])

    def update_file(self, rel_path: str, values: dict[str, Any]) -> None:
        """Patch a files row by relative path."""
        if not values:
            return
        columns = ", ".join(f"{key}=?" for key in values)
        params: list[Any] = list(values.values())
        params.append(rel_path)
        with self._lock:
            self.conn.execute(f"UPDATE files SET {columns} WHERE rel_path=?", params)

    def bulk_upsert_files(self, records: Sequence[dict[str, Any]]) -> None:
        """Insert or replace many inventory records in one transaction.

        Args:
            records: Dicts whose keys are ``files`` column names. Every
                record must include ``rel_path``.
        """
        if not records:
            return
        columns = sorted({key for record in records for key in record})
        if "rel_path" not in columns:
            raise ValueError("bulk_upsert_files requires 'rel_path' in every record")
        placeholders = ", ".join("?" for _ in columns)
        assignments = ", ".join(
            f"{col}=excluded.{col}" for col in columns if col != "rel_path"
        )
        sql = (
            f"INSERT INTO files({', '.join(columns)}) VALUES({placeholders}) "
            f"ON CONFLICT(rel_path) DO UPDATE SET {assignments}"
        )
        rows = [tuple(record.get(col) for col in columns) for record in records]
        with self._lock:
            self.conn.executemany(sql, rows)

    def get_file(self, rel_path: str) -> sqlite3.Row | None:
        """Return a single files row, or None."""
        return self.conn.execute(
            "SELECT * FROM files WHERE rel_path=?", (rel_path,)
        ).fetchone()

    def iter_files(
        self,
        *,
        where: str = "",
        params: Sequence[Any] = (),
        batch_size: int = 500,
    ) -> Iterator[sqlite3.Row]:
        """Stream files rows without materialising the whole table.

        Args:
            where: Optional SQL predicate (without the ``WHERE`` keyword).
            params: Parameters bound into ``where``.
            batch_size: Rows fetched per round trip.
        """
        sql = "SELECT * FROM files"
        if where:
            sql += f" WHERE {where}"
        sql += " ORDER BY id"
        cursor = self.conn.execute(sql, tuple(params))
        while True:
            batch = cursor.fetchmany(batch_size)
            if not batch:
                return
            yield from batch

    def count_files(self, where: str = "", params: Sequence[Any] = ()) -> int:
        """Count files rows matching an optional predicate."""
        sql = "SELECT COUNT(*) AS n FROM files"
        if where:
            sql += f" WHERE {where}"
        return int(self.conn.execute(sql, tuple(params)).fetchone()["n"])

    def needs_processing(
        self,
        rel_path: str,
        *,
        size: int,
        mtime_iso: str,
        stage: str = "processing_status",
        app_version: str = APP_VERSION,
    ) -> bool:
        """Decide whether a file still needs work in a given stage.

        Work is required when the file is unknown, the stage is not
        ``done``, the recorded app version differs, or the on-disk size or
        modification time has changed since it was last seen.

        Args:
            rel_path: Source-relative path (the file's stable identity).
            size: Current on-disk size in bytes.
            mtime_iso: Current modification time, ISO-8601.
            stage: Column to consult - ``processing_status``,
                ``extraction_status``, or ``ocr_status``.
            app_version: Version that current results must match.

        Returns:
            True when the file should be (re)processed.
        """
        if stage not in {"processing_status", "extraction_status", "ocr_status"}:
            raise ValueError(f"Unknown stage column: {stage}")
        row = self.conn.execute(
            f"SELECT {stage} AS status, seen_size, seen_mtime, app_version"
            " FROM files WHERE rel_path=?",
            (rel_path,),
        ).fetchone()
        if row is None:
            return True
        if row["status"] != STATUS_DONE:
            return True
        if row["app_version"] != app_version:
            return True
        if row["seen_size"] is None or int(row["seen_size"]) != int(size):
            return True
        if row["seen_mtime"] != mtime_iso:
            return True
        return False

    # -- pages ------------------------------------------------------------

    def replace_pages(self, file_id: int, page_records: Sequence[dict[str, Any]]) -> None:
        """Replace all page rows for a file (idempotent re-processing)."""
        with self._lock:
            self.conn.execute("DELETE FROM pages WHERE file_id=?", (file_id,))
            if not page_records:
                return
            columns = sorted({key for record in page_records for key in record} | {"file_id"})
            placeholders = ", ".join("?" for _ in columns)
            sql = f"INSERT INTO pages({', '.join(columns)}) VALUES({placeholders})"
            rows = [
                tuple(
                    file_id if col == "file_id" else record.get(col)
                    for col in columns
                )
                for record in page_records
            ]
            self.conn.executemany(sql, rows)

    def iter_pages(self, file_id: int) -> Iterator[sqlite3.Row]:
        """Yield page rows for a file in page order."""
        yield from self.conn.execute(
            "SELECT * FROM pages WHERE file_id=? ORDER BY page_number", (file_id,)
        )

    # -- text / FTS -------------------------------------------------------

    def store_text(
        self,
        file_id: int,
        rel_path: str,
        body: str,
        *,
        normalized_sha256: str | None = None,
        simhash: str | None = None,
    ) -> None:
        """Store extracted text in FTS5 and record its fingerprints.

        The text is written only here. No other code path copies it into a
        report, a log record, or the terminal.
        """
        with self._lock:
            existing = self.conn.execute(
                "SELECT fts_rowid FROM doc_text_map WHERE file_id=?", (file_id,)
            ).fetchone()
            if existing is not None:
                self.conn.execute(
                    "DELETE FROM doc_text WHERE rowid=?", (existing["fts_rowid"],)
                )
            cursor = self.conn.execute(
                "INSERT INTO doc_text(rel_path, body) VALUES(?,?)", (rel_path, body)
            )
            self.conn.execute(
                "INSERT INTO doc_text_map(file_id, fts_rowid, char_count, normalized_sha256, simhash)"
                " VALUES(?,?,?,?,?)"
                " ON CONFLICT(file_id) DO UPDATE SET fts_rowid=excluded.fts_rowid,"
                " char_count=excluded.char_count,"
                " normalized_sha256=excluded.normalized_sha256, simhash=excluded.simhash",
                (file_id, cursor.lastrowid, len(body), normalized_sha256, simhash),
            )

    def get_text(self, file_id: int) -> str | None:
        """Return stored text for a file.

        Intended for in-process analysis only (tagging, classification,
        duplicate detection). Never route the result to a log or report.
        """
        row = self.conn.execute(
            "SELECT t.body AS body FROM doc_text_map m"
            " JOIN doc_text t ON t.rowid = m.fts_rowid WHERE m.file_id=?",
            (file_id,),
        ).fetchone()
        return None if row is None else str(row["body"])

    def search_text(self, query: str, limit: int = 50) -> list[sqlite3.Row]:
        """Run an FTS5 MATCH query, returning file identities only."""
        return list(
            self.conn.execute(
                "SELECT m.file_id AS file_id, t.rel_path AS rel_path,"
                " bm25(doc_text) AS score"
                " FROM doc_text t JOIN doc_text_map m ON m.fts_rowid = t.rowid"
                " WHERE doc_text MATCH ? ORDER BY score LIMIT ?",
                (query, limit),
            )
        )

    # -- generic helpers --------------------------------------------------

    def replace_rows(self, table: str, records: Sequence[dict[str, Any]]) -> None:
        """Delete every row in ``table`` and insert ``records``.

        Used for derived tables (duplicate_members, families) that are
        recomputed wholesale from the current state of the database.
        """
        allowed = {"duplicate_members", "families", "issue_hits", "documents"}
        if table not in allowed:
            raise ValueError(f"replace_rows refuses table '{table}'")
        with self._lock:
            self.conn.execute(f"DELETE FROM {table}")
            self.insert_rows(table, records)

    def insert_rows(self, table: str, records: Sequence[dict[str, Any]]) -> None:
        """Insert (or replace on conflict) many rows into ``table``."""
        allowed = {"duplicate_members", "families", "issue_hits", "documents"}
        if table not in allowed:
            raise ValueError(f"insert_rows refuses table '{table}'")
        if not records:
            return
        columns = sorted({key for record in records for key in record})
        placeholders = ", ".join("?" for _ in columns)
        sql = (
            f"INSERT OR REPLACE INTO {table}({', '.join(columns)}) VALUES({placeholders})"
        )
        rows = [tuple(record.get(col) for col in columns) for record in records]
        with self._lock:
            self.conn.executemany(sql, rows)

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        """Run a read-only SELECT and return all rows."""
        return list(self.conn.execute(sql, tuple(params)))

    def scalar(self, sql: str, params: Sequence[Any] = (), default: Any = None) -> Any:
        """Run a SELECT expected to yield a single value."""
        row = self.conn.execute(sql, tuple(params)).fetchone()
        if row is None:
            return default
        value = row[0]
        return default if value is None else value

    def delete_file_derivatives(self, file_ids: Iterable[int]) -> None:
        """Remove per-file derived rows so a file can be reprocessed cleanly."""
        ids = list(file_ids)
        if not ids:
            return
        marks = ",".join("?" for _ in ids)
        with self._lock:
            for table in ("pages", "issue_hits", "documents"):
                self.conn.execute(f"DELETE FROM {table} WHERE file_id IN ({marks})", ids)
            self.conn.execute(
                f"DELETE FROM duplicate_members WHERE file_id IN ({marks})", ids
            )
            self.conn.execute(
                f"DELETE FROM families WHERE parent_file_id IN ({marks})"
                f" OR child_file_id IN ({marks})",
                ids + ids,
            )


__all__ = [
    "Database",
    "STATUS_DONE",
    "STATUS_ERROR",
    "STATUS_PENDING",
    "STATUS_PLACEHOLDER",
    "STATUS_SKIPPED",
    "utcnow",
]
