"""Wilson Rode Indexer.

A local-only document indexing and triage toolkit for a Bates-numbered
legal document production.

All metadata produced by this package is DERIVED REVIEW METADATA. It is
computed by inspecting the PDFs themselves; it is not original, native, or
load-file metadata from the producing party.
"""

from src.version import APP_NAME, APP_VERSION

__all__ = ["APP_NAME", "APP_VERSION"]
