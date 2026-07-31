"""Application identity and schema version constants.

``APP_VERSION`` is recorded on every processed-file row so that a later run
can tell which build of the tool produced a given result. Bump it whenever
extraction, classification, or scoring behaviour changes in a way that
should invalidate previously computed results.
"""

from __future__ import annotations

APP_NAME: str = "wilson_rode_indexer"
APP_VERSION: str = "1.0.0"

#: Bumped only when the SQLite schema changes incompatibly.
SCHEMA_VERSION: int = 1

__all__ = ["APP_NAME", "APP_VERSION", "SCHEMA_VERSION"]
