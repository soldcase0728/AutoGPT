"""Structured logging with a hard guarantee against leaking document text.

Two sinks are configured:

* a rotating file handler under ``<output>/logs`` that keeps the full audit
  trail, and
* a console handler that is deliberately restricted to counts, filenames,
  progress, warnings, and aggregate statistics.

:class:`DocumentTextGuard` is attached to *both* handlers. Any log record
that carries an extracted-text payload (``extra={"document_text": ...}``)
or that a caller has marked with ``extra={"contains_document_text": True}``
is dropped rather than written. This is defence in depth: the calling code
is already written never to log text, and the guard makes an accidental
future change fail closed.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from src.version import APP_NAME, APP_VERSION

#: Keys that, if present on a record, mean the record may carry content.
_TEXT_BEARING_KEYS = frozenset(
    {
        "document_text",
        "page_text",
        "extracted_text",
        "email_body",
        "excerpt",
        "snippet",
        "contains_document_text",
    }
)

#: Reserved LogRecord attributes, used to isolate caller-supplied extras.
_RESERVED = frozenset(
    vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()
) | {"message", "asctime", "taskName"}


class DocumentTextGuard(logging.Filter):
    """Drop any log record that might carry substantive document text."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D102
        for key in _TEXT_BEARING_KEYS:
            if hasattr(record, key):
                return False
        return True


class JsonLineFormatter(logging.Formatter):
    """Emit one JSON object per line for machine-readable audit logs."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D102
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
            "pid": os.getpid(),
            "app_version": APP_VERSION,
        }
        for key, value in vars(record).items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = _jsonable(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    """Terse human-readable console format."""

    def __init__(self) -> None:
        super().__init__(fmt="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")


def _jsonable(value: Any) -> Any:
    """Coerce a value into something ``json.dumps`` will accept."""
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    return str(value)


def setup_logging(
    log_dir: Path,
    *,
    run_name: str,
    console_level: str = "INFO",
    file_level: str = "DEBUG",
    max_bytes: int = 20 * 1024 * 1024,
    backup_count: int = 10,
) -> Path:
    """Configure root logging for a run and return the log file path.

    Args:
        log_dir: Directory to write logs into. Created if absent.
        run_name: Short phase identifier, e.g. ``"phase1"``. Becomes part
            of the log filename.
        console_level: Threshold for the terminal sink.
        file_level: Threshold for the rotating file sink.
        max_bytes: Rotation size for the file sink.
        backup_count: Number of rotated files to retain.

    Returns:
        Path of the active log file.
    """
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = log_dir / f"{run_name}_{stamp}.log"

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()

    guard = DocumentTextGuard()

    file_handler = logging.handlers.RotatingFileHandler(
        log_path, maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8"
    )
    file_handler.setLevel(getattr(logging, file_level.upper(), logging.DEBUG))
    file_handler.setFormatter(JsonLineFormatter())
    file_handler.addFilter(guard)
    root.addHandler(file_handler)

    console = logging.StreamHandler(stream=sys.stderr)
    console.setLevel(getattr(logging, console_level.upper(), logging.INFO))
    console.setFormatter(ConsoleFormatter())
    console.addFilter(guard)
    root.addHandler(console)

    logging.getLogger(APP_NAME).info(
        "Logging initialised",
        extra={"log_file": str(log_path), "run": run_name, "app_version": APP_VERSION},
    )
    return log_path


def get_logger(name: str) -> logging.Logger:
    """Return a namespaced application logger."""
    return logging.getLogger(f"{APP_NAME}.{name}")


__all__ = ["DocumentTextGuard", "JsonLineFormatter", "get_logger", "setup_logging"]
