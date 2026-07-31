#!/usr/bin/env python3
"""Generate a synthetic Bates-numbered production for smoke testing.

This exists so the pipeline can be exercised end to end without touching
real case material. It writes only into the directory you name, and it is
never pointed at the real production folder.

Usage:
    python scripts/make_synthetic_production.py /tmp/demo "Wilson-Rode File"
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import fitz

EMAIL_TEMPLATE = """WILSONRODE{bates:06d}
From: {sender}
Sent: {sent}
To: {to}
Cc: {cc}
Subject: {subject}
Attachments: {attachment}

{body}
"""

CHAIN_SUFFIX = """
-----Original Message-----
From: Patrick Rode <prode@example.com>
Sent: Monday, March 4, 2019 9:00 AM
To: John J. Wilson <jwilson@example.com>
Subject: {subject}

Earlier message in the chain regarding the commission agreement.
"""


def write_pdf(path: Path, pages: list[str]) -> None:
    """Write a PDF whose pages contain the supplied text."""
    document = fitz.open()
    for text in pages:
        page = document.new_page()
        for index, line in enumerate(text.splitlines()):
            page.insert_text((60, 60 + index * 13), line[:110], fontsize=9)
    path.parent.mkdir(parents=True, exist_ok=True)
    document.save(path)
    document.close()


def build(root: Path, count: int = 120) -> None:
    """Create ``count`` synthetic documents of assorted kinds."""
    root.mkdir(parents=True, exist_ok=True)
    bates = 1

    for index in range(count):
        kind = index % 6
        name = root / f"WILSONRODE{bates:06d}-null.pdf"

        if kind == 0:
            body = (
                "Pat, please review the commission agreement before we address the "
                "statute of frauds question and the one year provision. I have "
                "reviewed and understood the client file transfer request."
            )
            text = EMAIL_TEMPLATE.format(
                bates=bates,
                sender="John J. Wilson <jwilson@example.com>",
                sent="Monday, March 4, 2019 10:12 AM",
                to="Patrick Rode <prode@example.com>; Alice Smith <asmith@example.com>",
                cc="Records <records@example.com>",
                subject=f"Dagenais Issue Follow Up {index}",
                attachment=f"Commission Agreement {index}.pdf",
                body=body,
            )
            if index % 12 == 0:
                text += CHAIN_SUFFIX.format(subject=f"Dagenais Issue Follow Up {index}")
            write_pdf(name, [text])
            bates += 1

        elif kind == 1:
            pages = [
                f"WILSONRODE{bates:06d}\nCommission Agreement {index}\n"
                "This Agreement is entered into by the parties. WHEREAS the parties "
                "wish to provide for a post-termination commission for the lifetime "
                "of the account.",
                f"WILSONRODE{bates + 1:06d}\nNOW, THEREFORE the parties agree. "
                "The written agreement shall be governed by Michigan law.",
            ]
            write_pdf(name, pages)
            bates += 2

        elif kind == 2:
            text = (
                f"WILSONRODE{bates:06d}\nSTATE OF MICHIGAN\n"
                "IN THE OAKLAND COUNTY CIRCUIT COURT\n"
                f"Case No. 19-{100000 + index}-CB\n"
                "Plaintiff,\nv.\nDefendant.\n\n"
                "DEFENDANT'S MOTION FOR SUMMARY DISPOSITION\n"
                "Defendant asserts the affirmative defense of the statute of frauds "
                "and seeks leave to amend its answer. This issue is preserved for appeal."
            )
            write_pdf(name, [text])
            bates += 1

        elif kind == 3:
            text = (
                f"WILSONRODE{bates:06d}\nAnderson CPA Group\nInvoice\n"
                f"Invoice No: {44000 + index}\nInvoice Date: March 31, 2019\n"
                "For professional services rendered\nAmount Due: $12,500.00\n"
                "Expert damages analysis, present value and discount rate work."
            )
            write_pdf(name, [text])
            bates += 1

        elif kind == 4:
            text = (
                f"WILSONRODE{bates:06d}\nEXPERT REPORT OF JANE DOE\n"
                "Opinions and bases. Within a reasonable degree of professional "
                "certainty. Methodology: projected revenue, attrition, life "
                "expectancy per CDC tables, present value at a 5% discount rate. "
                "See Exhibit 37 for the damages summary."
            )
            write_pdf(name, [text])
            bates += 1

        else:
            # A blank/Bates-only separator page.
            write_pdf(name, [f"WILSONRODE{bates:06d}"])
            bates += 1

    # A byte-identical duplicate produced at a second Bates range.
    first = root / "WILSONRODE000001-null.pdf"
    if first.exists():
        shutil.copyfile(first, root / f"WILSONRODE{bates:06d}-null.pdf")
        bates += 1

    # A malformed filename and a non-PDF, both of which must be reported.
    write_pdf(root / "loose_scan_no_bates.pdf", ["A scan with no Bates number in its name."])
    (root / "readme.txt").write_text("not a pdf", encoding="utf-8")
    # A cloud-placeholder stub: a .pdf that is not really a PDF yet.
    (root / f"WILSONRODE{bates:06d}-null.pdf").write_bytes(b"placeholder")

    print(f"Wrote synthetic production to {root}")


if __name__ == "__main__":
    base = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/wri_demo")
    folder = sys.argv[2] if len(sys.argv) > 2 else "Wilson-Rode File"
    build(base / folder, count=int(sys.argv[3]) if len(sys.argv) > 3 else 120)
