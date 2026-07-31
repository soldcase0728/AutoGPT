"""Shared pytest fixtures.

Fixtures build a synthetic production in a temporary directory. No real
case documents are ever used in the test suite.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.config import load_config  # noqa: E402
from src.database import Database  # noqa: E402


def make_pdf(path: Path, pages: list[str], *, encrypt: bool = False) -> Path:
    """Write a small synthetic PDF containing the supplied page text."""
    import fitz

    document = fitz.open()
    for text in pages:
        page = document.new_page()
        if text:
            page.insert_text((72, 72), text, fontsize=11)
    path.parent.mkdir(parents=True, exist_ok=True)
    if encrypt:
        document.save(
            path,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw="owner-secret",
            user_pw="user-secret",
        )
    else:
        document.save(path)
    document.close()
    return path


@pytest.fixture()
def source_tree(tmp_path: Path) -> Path:
    """Build a synthetic Bates-numbered production folder."""
    source = tmp_path / "Wilson-Rode File"
    source.mkdir(parents=True)

    make_pdf(
        source / "WILSONRODE000001-null.pdf",
        [
            "WILSONRODE000001\n"
            "From: John J. Wilson <jwilson@example.com>\n"
            "Sent: Monday, March 4, 2019 10:12 AM\n"
            "To: Patrick Rode <prode@example.com>; Alice Smith <asmith@example.com>\n"
            "Cc: Records <records@example.com>\n"
            "Subject: Dagenais Issue Follow Up\n"
            "Attachments: Commission Agreement.pdf\n\n"
            "Pat, please review the commission agreement before we discuss the "
            "statute of frauds question and the one year provision.\n"
        ],
    )
    make_pdf(
        source / "WILSONRODE000002-null.pdf",
        [
            "WILSONRODE000002\nCommission Agreement\n"
            "This Agreement is entered into by the parties. WHEREAS the parties "
            "wish to set out terms and conditions for a post-termination commission.\n",
            "WILSONRODE000003\nNOW, THEREFORE the parties agree as follows.\n",
        ],
    )
    make_pdf(
        source / "WILSONRODE000004-null.pdf",
        ["WILSONRODE000004"],
    )
    make_pdf(source / "WILSONRODE000010-null.pdf", ["WILSONRODE000010\nInvoice\n"
                                                    "Invoice No: 44120\nAmount Due: $12,500.00\n"])
    # Byte-identical duplicate of 000001, produced at a different Bates range.
    shutil.copyfile(
        source / "WILSONRODE000001-null.pdf", source / "WILSONRODE000011-null.pdf"
    )
    # Malformed filename: no Bates pattern at all.
    make_pdf(source / "scan_0012.pdf", ["Loose scan with no Bates number in the name."])
    # Encrypted document.
    make_pdf(source / "WILSONRODE000020-null.pdf", ["secret"], encrypt=True)
    # Non-PDF file, and files that must be ignored.
    (source / "notes.txt").write_text("plain text file", encoding="utf-8")
    (source / ".DS_Store").write_bytes(b"\x00\x01")
    # Cloud placeholder: a .pdf that is a tiny stub with no %PDF- header.
    (source / "WILSONRODE000030-null.pdf").write_bytes(b"placeholder")

    return source


@pytest.fixture()
def config_file(tmp_path: Path, source_tree: Path) -> Path:
    """Write a config.yaml pointing at the synthetic production."""
    template = yaml.safe_load((PROJECT_ROOT / "config.yaml").read_text(encoding="utf-8"))
    template["paths"]["source_folder"] = str(source_tree)
    template["paths"]["output_folder"] = str(tmp_path / "Wilson_Rode_Derived_Index")
    template["performance"]["workers"] = 1
    template["cloud_placeholder"]["max_retries"] = 0
    template["cloud_placeholder"]["initial_backoff_seconds"] = 0.0
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(template, sort_keys=False), encoding="utf-8")
    return path


@pytest.fixture()
def config(config_file: Path):
    """Load the synthetic configuration."""
    loaded = load_config(config_file)
    loaded.validate_paths()
    loaded.paths.ensure_output_tree()
    return loaded


@pytest.fixture()
def database(config) -> Database:
    """Open a fresh processing-state database for the synthetic config."""
    db = Database(config.paths.db_path)
    yield db
    db.close()


@pytest.fixture()
def source_snapshot(source_tree: Path) -> dict[str, tuple[int, str]]:
    """Fingerprint every source file so tests can prove nothing changed."""
    import hashlib

    snapshot: dict[str, tuple[int, str]] = {}
    for path in sorted(source_tree.rglob("*")):
        if path.is_file():
            data = path.read_bytes()
            snapshot[str(path.relative_to(source_tree))] = (
                len(data),
                hashlib.sha256(data).hexdigest(),
            )
    return snapshot
