# Wilson Rode Indexer

A local, read-only indexing and triage tool for a large Bates-numbered
legal document production. It walks a Google Drive-synced folder of
Bates-named PDFs, records what is actually there, extracts text locally,
and produces review workbooks that let a human decide what to read first.

**Nothing leaves your machine.** There are no external APIs, no cloud OCR,
no hosted AI services, and no network calls of any kind in the processing
path. All PDF parsing, OCR, hashing, indexing, and classification happen
locally.

---

## The single most important thing to understand

Everything this tool produces is **DERIVED REVIEW METADATA**.

This production shipped with no CSV, no DAT, no OPT, and no native-file
index. Native metadata — the producing party's own record of who sent
what, when, and which attachment belonged to which email — **does not
exist here**. Every field in every workbook was reconstructed by this tool
from the PDFs themselves.

That has three consequences, and they run through the whole design:

1. Each derived field carries an explicit **confidence** value and, where
   relevant, a **source** (observed on page / parsed from filename /
   calculated / inferred).
2. Fields that cannot be determined are left **blank**. The tool never
   invents a date, a sender, a custodian, or a Bates number.
3. Columns are labelled **OBSERVED**, **CALCULATED**, or **INFERRED** in
   every workbook's Data Dictionary tab, so a reviewer always knows
   whether they are looking at a fact or a judgement.

Never represent output from this tool as original or native metadata.

---

## Safety guarantees

The source folder is treated as strictly read-only. The tool never
renames, moves, alters, annotates, OCRs in place, combines, or deletes
anything beneath it. Specifically:

- Startup **refuses to run** if the output folder is inside the source
  folder, or vice versa (`src/config.py`, `validate_paths`).
- PDFs are opened read-only and closed immediately.
- OCR writes to a cache copy inside the derived-index folder, and
  `run_ocr` raises rather than let an output path equal its input.
- Automated tests fingerprint every source file before a run and assert
  byte-for-byte equality afterwards
  (`tests/test_inventory_and_resume.py::TestReadOnlySourceProtection`).

Document confidentiality is protected at the same level:

- The terminal receives only counts, filenames, progress, warnings, and
  aggregate statistics — never document text.
- The logging layer carries a `DocumentTextGuard` filter that **drops**
  any log record carrying an extracted-text payload. It fails closed.
- Extracted text lives only in the SQLite FTS5 table. No workbook or CSV
  contains document text; issue-tag hits carry a structural locator (page
  and character offset), not an excerpt.

---

## Installation (macOS)

Python 3.12 is recommended; 3.11 or later works.

```bash
# 1. Python and (optional) local OCR
brew install python@3.12
brew install ocrmypdf tesseract      # optional — only needed for image-only PDFs

# 2. Project virtual environment
cd wilson_rode_indexer
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 3. Verify
python -m src.cli doctor
```

`doctor` reports every dependency, whether OCR is available, whether
SQLite has FTS5, and whether the configured paths are valid and safe. Fix
anything it flags before running a phase.

If Homebrew is not installed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

OCR is genuinely optional. If `ocrmypdf` and `tesseract` are absent, the
tool still runs; it reports OCR candidates in `07_OCR_Required.xlsx`
instead of processing them, and says so in the summaries.

---

## Locating the Google Drive folder

```bash
python -m src.cli locate
```

This searches the usual macOS Drive mount points — `~/Library/CloudStorage`
first, then `~/Google Drive`, `/Volumes/GoogleDrive`, and a few others —
for a directory named exactly `Wilson-Rode File`, and prints what it finds
without touching anything.

If exactly one folder matches, it prints the two lines to paste into
`config.yaml`. If several match, it lists them all and asks you to choose:
picking the wrong copy of a production is a real risk, so the tool will not
guess.

Then edit `config.yaml`:

```yaml
paths:
  source_folder: "/Users/you/Library/CloudStorage/GoogleDrive-you@firm.com/My Drive/Wilson-Rode File"
  output_folder: "/Users/you/Library/CloudStorage/GoogleDrive-you@firm.com/My Drive/Wilson_Rode_Derived_Index"
```

The output folder must be a **sibling** of the source folder, never inside
it.

### Make Drive materialise the files first

Google Drive can present a file that has not been downloaded. Those are
detected, logged, retried with backoff, and reported as **cloud
placeholders** — deliberately *not* as corrupt files, because the
follow-up is completely different. To avoid them, right-click the folder
in Finder and choose **Download now** before the first run, then re-run
once syncing completes.

---

## Running the phases

Each phase stops when it finishes. Nothing advances automatically.

### Phase 1 — structural inventory

```bash
scripts/run_phase1.sh
# or: python -m src.cli phase1
```

Reads no substantive document content. For every file it records the
filename, paths, size, timestamps, SHA-256, file type, PDF page count,
encryption and corruption status, the Bates number parsed **from the
filename only**, filename-pattern compliance, duplicate-filename and
exact-duplicate grouping.

Produces `01`–`04`, `Phase_1_Summary.md`, the SQLite database, and a full
log.

### Phase 2 — text and page-condition audit

```bash
scripts/run_phase2.sh                  # ~200-document stratified pilot
scripts/run_phase2.sh --full           # whole production, after approval
```

Extracts text natively, measures characters, words, image count and
approximate image coverage per page, detects Bates stamps **on the page**,
classifies each page's condition, and OCRs only the pages that need it.

Produces `05`–`08` and `Phase_2_Pilot_Summary.md`.

The pilot sample is stratified, not random: it deliberately over-weights
low and high Bates ranges, the smallest and largest files, single- and
multi-page documents, likely image-only and likely blank PDFs, exact
duplicates, and malformed filenames — the cases most likely to break
extraction.

### Phase 3 — derived metadata and review workbooks

```bash
python -m src.cli phase3
```

Derives Bates ranges, dates, email headers, litigation and invoice fields,
document type, duplicates (three ways), family inferences, issue tags, and
priority scores. Produces `09`–`20`, `Processing_Errors.xlsx`, and
`Final_Run_Summary.md`.

### Everything at once

```bash
scripts/run_full.sh
```

Runs Phase 1, full Phase 2, Phase 3, and the QC sample in sequence. Use
this only after both the Phase 1 summary and the Phase 2 pilot have been
reviewed.

---

## Resuming a stopped run

Just run the same command again.

Processing state lives in the SQLite database, and work is committed in
batches as it completes. A file is reprocessed only when it is new, its
previous attempt failed, its recorded app version differs from the current
one, or its size or modification time changed on disk. Everything else is
skipped.

```bash
python -m src.cli status        # what is done, what is outstanding
python -m src.cli phase1        # resumes; completed files are skipped
```

Interrupting with Ctrl-C is safe. The tool prints a note confirming that
committed progress is retained.

To force a complete redo of a phase, add `--force`.

---

## Reading the reports

| Report | What it tells you |
| --- | --- |
| `01_File_Inventory.xlsx` / `.csv` | Every file with hashes, sizes, page counts, and clickable local links. The ground truth of what exists. |
| `02_Bates_Structural_Report.xlsx` | **Preliminary** filename-based Bates gaps, and every malformed filename. |
| `03_Exact_Duplicate_Report.xlsx` | Groups of byte-identical files. |
| `04_Unreadable_or_Corrupt_Files.xlsx` | Encrypted, corrupt, and not-yet-downloaded files, each with a recommended action. |
| `05_Page_Condition_Audit.xlsx` | Per-page condition, character counts, image coverage, and observed Bates stamps. |
| `06_Blank_and_Bates_Only_Candidates.xlsx` | Pages that look blank, split into truly-blank, Bates-only, separator, and failed-export candidates. |
| `07_OCR_Required.xlsx` | Pages with image content and no usable text layer. |
| `08_Extraction_Failures.xlsx` | Documents whose text could not be extracted. |
| `09_Derived_Document_Index.xlsx` / `.csv` | **The master index.** One row per document, all derived fields with confidences. |
| `10_Bates_Gap_and_Overlap_Report.xlsx` | Definitive gap analysis using resolved begin/end ranges, plus overlapping claims. Supersedes report 02. |
| `11_Blank_and_Extraction_Failure_Report.xlsx` | Document-level blanks and extraction failures. |
| `12_Duplicate_Groups.xlsx` | All three duplicate methods with a relation label and similarity. |
| `13_Document_Family_Inferences.xlsx` | Inferred parent-email/attachment links, each with its reasoning. |
| `14_Issue_Tag_Index.xlsx` | Every issue-tag hit with term, page, count, and a structural locator. |
| `15`–`20` review queues | Pre-filtered slices: priority, John Wilson, statute of frauds, expert and damages, client file, insurance. |
| `Final_Run_Summary.md` | Totals, distributions, and limitations for the whole run. |

Every workbook carries **Data Dictionary**, **Methodology and
Limitations**, and **Run Statistics** tabs.

### Why Phase 1's Bates gaps are labelled preliminary

Each PDF here may contain several Bates-stamped pages. A jump from
`WILSONRODE000002-null.pdf` to `WILSONRODE000005-null.pdf` usually means
the first document was three pages long, not that two documents are
missing. Filename-based gaps are therefore *candidates only*. Report `10`
computes gaps from resolved begin/end ranges with page counts accounted
for; that is the one to rely on.

*(On the synthetic validation corpus, filename analysis flagged 20 gap
runs; range-based analysis after Phase 3 resolved every one of them to
zero real gaps.)*

### Reading confidence values

| Value | Meaning |
| --- | --- |
| `Confirmed` | Read directly off the page, or fully corroborated. |
| `Probable` | Strong but indirect evidence, e.g. a complete email header. |
| `Possible` | Weak or single-signal evidence. Verify before relying on it. |
| `Unknown` | Could not be determined. The field is blank. |

`Manual review required = Yes` means the row's derived fields should be
checked against the document before use.

### Reading priority scores

The score is additive and every contributing factor is written out in the
**Priority score explanation** column, so any row can be audited.

**A high score means "look at this early". It does not indicate
malpractice, liability, or any legal conclusion.** Issue tags are a
screening tool: a tag means a configured term appeared in extracted text,
nothing more.

---

## Privacy and limitations

**Privacy**

- Fully local. No network calls, no cloud OCR, no hosted AI, no telemetry.
- No document text on the terminal, in logs, or in any spreadsheet.
- Extracted text is stored only in the SQLite FTS5 table inside the
  derived-index folder. That database is as confidential as the production
  itself — treat it accordingly, and note that if the derived-index folder
  is inside a synced Drive, the database syncs to the cloud with it. To
  avoid that, point `paths.output_folder` at a local, non-synced path.
- `python -m src.cli search` prints matching filenames only, never text.

**Limitations**

- No perfect-accuracy claim is made. Measured pilot accuracy is reported
  in `Phase_2_Pilot_Summary.md`.
- Document type, family relationships, issue tags, and priority scores are
  heuristic. Verify anything below `Confirmed`.
- OCR output contains recognition errors; fields derived from OCR text are
  correspondingly less reliable.
- Near-duplicate detection uses banded LSH over SimHash. It is fast and
  high-recall, but deliberately not an exhaustive O(n²) comparison, so it
  is not guaranteed to find every near-duplicate pair.
- Custodian is populated only where the production actually shows one.
  Folder structure in a synced Drive is not evidence of custody and is
  never used to infer it.
- Encrypted PDFs are reported, not opened. No password is ever guessed or
  supplied.
- Blank-page findings are candidates. Confirming a page is truly blank —
  rather than a failed export or an image the extractor could not see —
  requires visual inspection.

---

## Changing issue tags

Issue tags live in `config.yaml` under `issue_tags.terms`. Edit that
section; no code change is needed.

```yaml
issue_tags:
  terms:
    STATUTE_OF_FRAUDS:
      - "statute of frauds"
      - "within one year"
    MY_NEW_CATEGORY:
      - "some phrase"
      - "another phrase"
```

Terms are matched case-insensitively on word boundaries. Regex
metacharacters are escaped automatically, so `502(b)(7)` works as written.

To make a new tag affect priority, add it to `priority.tag_points`:

```yaml
priority:
  tag_points:
    MY_NEW_CATEGORY: 7
```

To create a review queue for it, add an entry to `queue_specs` in
`src/reports.py::write_phase3_reports`.

Re-run `python -m src.cli phase3` afterwards. Tagging and scoring read
text from the database, so no re-extraction is needed and the pass is
quick.

**Keep the context setting at zero.** `issue_tags.context_chars: 0` makes
hit records store a structural locator instead of surrounding text.
Raising it puts document content into a spreadsheet — only do that as a
deliberate, privileged decision.

---

## Re-running only failed files

```bash
python -m src.cli rerun-failed     # requeue errored files and placeholders
python -m src.cli phase1           # reprocess just those
python -m src.cli phase3
```

`rerun-failed` clears the derived rows for every file that errored or was
a cloud placeholder and resets their state to pending. The next run picks
up exactly those files and nothing else.

Cloud placeholders are retried automatically on every run — no reset
needed. Once Drive materialises the file, the next run processes it
normally.

---

## Updating after new files are added

Copy the new files into the source folder, then:

```bash
python -m src.cli phase1     # inventories only the new files
python -m src.cli phase3     # extracts the new files, rebuilds every report
```

Phase 1 skips everything already recorded. Phase 3 extracts only what is
missing but recomputes duplicate groups, family inferences, and all
workbooks across the whole collection — necessary, because a new document
can change the grouping of existing ones.

---

## Quality control

```bash
python -m src.cli qc
```

Writes `QC_Sample.xlsx`, a stratified sample with empty **Reviewer
verdict** and **Reviewer notes** columns to fill in. The default strata
are 50 high-priority, 50 low-priority, 25 OCR, 25 blank candidates, 25
family inferences, and 25 near-duplicate matches — configurable under
`qc.full_run_sample`.

The sample is deterministic for a given `qc.random_seed`, so a QC pass can
be reproduced and audited.

Run the QC sample after **each** phase. Automated checks cannot substitute
for opening documents and looking at them.

### Automated tests

```bash
.venv/bin/python -m pytest -q
```

148 tests cover Bates parsing, page-count extraction, email-header parsing
(including chains, where the current message's header must not be confused
with quoted prior headers), date parsing, duplicate hashing and SimHash,
issue tagging, parent-attachment inference, resume behaviour, logging
safety, and read-only source protection.

To exercise the whole pipeline without touching real material:

```bash
python scripts/make_synthetic_production.py /tmp/wri_demo "Wilson-Rode File" 120
python -m src.cli --source "/tmp/wri_demo/Wilson-Rode File" \
                  --output "/tmp/wri_demo/Wilson_Rode_Derived_Index" phase1
```

---

## Troubleshooting

**`Source folder does not exist`**
Run `python -m src.cli locate` and paste the printed paths into
`config.yaml`. Check for a trailing space in the path.

**`Refusing to run: paths.output_folder is inside paths.source_folder`**
Working as designed — the source production must stay untouched. Point
`output_folder` at a sibling directory.

**Many files reported as cloud placeholders**
Drive has not downloaded them. Right-click the folder in Finder →
**Download now**, wait for syncing to finish, then re-run. They are
retried automatically; no reset is needed.

**Run is very slow**
Lower `performance.workers` (Drive's file provider serialises badly under
high fan-out) and confirm the files are local rather than streaming. OCR
dominates runtime when many pages are image-only — check
`07_OCR_Required.xlsx` for the volume, and set `ocr.run_ocr: false` to
report candidates without processing them.

**`ocrmypdf: command not found`**
`brew install ocrmypdf tesseract`. Or leave OCR off; the tool reports
candidates instead.

**Encrypted PDFs**
Reported in `04_Unreadable_or_Corrupt_Files.xlsx`. Obtain the password
from the producing party — this tool never guesses one.

**Excel is slow to open a workbook**
Expected on very large productions. Use the CSV twin
(`09_Derived_Document_Index.csv`), or query the SQLite database directly.

**Extraction quality looks poor**
Check `05_Page_Condition_Audit.xlsx` for the `Uncertain` share. If it is
high, tune the `extraction` thresholds in `config.yaml` — especially
`min_chars_searchable` and `image_coverage_image_only` — and re-run
Phase 2 with `--force`.

**Out of disk space during OCR**
The OCR cache lives in `<output>/ocr_cache` and can grow large. It is safe
to delete; entries are regenerated on demand.

---

## Project layout

```
wilson_rode_indexer/
├── README.md
├── config.yaml                  # everything configurable lives here
├── pyproject.toml / requirements.txt
├── src/
│   ├── config.py                # loading, path resolution, safety validation
│   ├── logging_setup.py         # structured logging + document-text guard
│   ├── database.py              # SQLite state store, FTS5, audit log
│   ├── bates.py                 # Bates parsing, ranges, gap analysis
│   ├── inventory.py             # Phase 1
│   ├── pdf_extract.py           # Phase 2: text, page conditions, OCR
│   ├── metadata_extract.py      # Phase 3: emails, dates, classification
│   ├── duplicates.py            # exact, text, and SimHash/LSH near-duplicates
│   ├── issue_tags.py            # tagging and priority scoring
│   ├── document_family.py       # parent/attachment inference
│   ├── reports.py               # Excel, CSV, and Markdown output
│   └── cli.py                   # commands and orchestration
├── tests/
├── logs/
└── scripts/
    ├── run_phase1.sh
    ├── run_phase2.sh
    ├── run_full.sh
    └── make_synthetic_production.py
```

## Command reference

| Command | Purpose |
| --- | --- |
| `locate` | Find the source production folder |
| `doctor` | Check dependencies, configuration, and permissions |
| `phase1` | Structural inventory |
| `phase2 [--full] [--sample N]` | Text and page-condition audit |
| `phase3` | Derived metadata and review workbooks |
| `qc` | Write the quality-control sample |
| `search "<query>"` | FTS5 search; prints filenames only |
| `status` | Show processing progress |
| `rerun-failed` | Requeue only the failed files |

Global flags: `--config`, `--source`, `--output`, `--workers`,
`--no-progress`, and `--force` on the phase commands.
