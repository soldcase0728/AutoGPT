"""Clean the student request CSV:
   1. Remove literal duplicate request rows (same student, same Title).
   2. If a student has BOTH 'G PE' and 'G Health 10' (or boys' equivalents),
      drop 'G Health 10' -- the school combines them into G PE/Health.

Also estimate the placement impact: how many G PE/Health seats free up,
and how many of the still-waitlisted G PE girls could take them.

Outputs:
  - student_requests_clean.csv  (clean version for future solver runs)
  - Console diagnostics: who got deduped, freed-seat count, etc.
"""
import csv
from collections import Counter, defaultdict

PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]
PE_PAIR = {"G PE", "G Health 10"}   # treat as same course
PE_PAIR_B = {"PE/Health", "Health 10"}  # boys' equivalent

src = []  # list of dict(rows preserving original order/columns)
with open("student_requests.csv", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        src.append(dict(row))

print(f"Loaded {len(src)} request rows")

# Group by student
by_student = defaultdict(list)
for r in src:
    by_student[r["Student summary"].strip()].append(r)

# Pass 1: drop literal duplicate (same student, same Title)
removed_literal = []
kept = []
for s, rows in by_student.items():
    seen = set()
    for r in rows:
        key = r["Title"].strip()
        if key in seen:
            removed_literal.append((s, key))
            continue
        seen.add(key)
        kept.append(r)

print(f"\nPass 1: literal duplicates removed: {len(removed_literal)}")
for s, t in removed_literal:
    print(f"  drop   {s:<28}  {t!r}")

# Pass 2: collapse 'G PE' + 'G Health 10' into just 'G PE'
#  (and 'PE/Health' + 'Health 10' for boys -- speculative)
removed_pairs = []
by_student2 = defaultdict(list)
for r in kept:
    by_student2[r["Student summary"].strip()].append(r)

final = []
for s, rows in by_student2.items():
    titles = {r["Title"].strip() for r in rows}
    drop_titles = set()
    if PE_PAIR.issubset(titles):
        drop_titles.add("G Health 10")        # keep G PE
        removed_pairs.append((s, "G Health 10 (merged with G PE)"))
    if PE_PAIR_B.issubset(titles):
        drop_titles.add("Health 10")          # keep PE/Health
        removed_pairs.append((s, "Health 10 (merged with PE/Health)"))
    for r in rows:
        if r["Title"].strip() not in drop_titles:
            final.append(r)

print(f"\nPass 2: PE/Health-merge drops: {len(removed_pairs)}")
for s, t in removed_pairs:
    print(f"  drop   {s:<28}  {t}")

# Write the clean CSV preserving original column order
with open("student_requests_clean.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fieldnames)
    w.writeheader()
    w.writerows(final)
print(f"\nWrote student_requests_clean.csv  ({len(final)} rows; saved "
      f"{len(src) - len(final)} duplicate request rows)")

# ----------------------------------------------------------------- IMPACT
# How many G PE/Health seats would free if we re-solve with clean data?
double_placed_students = set()
with open("student_offer_v12.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
hdr = rows[1]
pi = {p: hdr.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]: continue
    s = row[0].strip()
    counts = Counter()
    for p in PERIODS:
        cell = (row[pi[p]] or "").split("\n")[0].strip()
        if "G PE/Health" in cell or cell == "PE/Health B":
            counts[cell] += 1
    for c, n in counts.items():
        if n > 1:
            double_placed_students.add(s)

print(f"\nStudents currently double-placed in PE-related section: "
      f"{len(double_placed_students)}")

# For these students, identify the 'extra' G PE/Health placement period and
# count by period (= which placeholder/teacher seat frees up).
freed_seats_by_period = Counter()
with open("student_offer_v12.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
for row in rows[2:]:
    if not row[0]: continue
    s = row[0].strip()
    if s not in double_placed_students: continue
    pe_periods = [p for p in PERIODS
                  if "G PE/Health" in (row[pi[p]] or "")]
    # The second one is the "extra"; we'd free it
    for p in pe_periods[1:]:
        freed_seats_by_period[p] += 1

print("\nFreed G PE/Health seats by period (after dedupe + at-most-one constraint):")
for p in PERIODS:
    if freed_seats_by_period[p]:
        print(f"  {p}: +{freed_seats_by_period[p]} seats")

# Now: how many girls still want G PE/Health but didn't get placed?
unplaced_pe_girls = []
all_reqs = defaultdict(list)
with open("student_requests_clean.csv", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        all_reqs[row["Student summary"].strip()].append(row["Title"].strip())

# load v12 placements again
placements = {}
gender = {}
with open("student_offer_v12.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
hdr = rows[1]
pi = {p: hdr.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]: continue
    s = row[0].strip()
    placements[s] = {p: (row[pi[p]] or "").split("\n")[0].strip() or "—"
                     for p in PERIODS}
    gender[s] = row[2].strip()

for s, rs in all_reqs.items():
    if gender.get(s) != "G": continue
    if not any("G PE" in r or "G Health" in r for r in rs): continue
    placed = any("G PE/Health" in v for v in placements.get(s, {}).values())
    if not placed:
        # girl wanted PE but didn't get it
        free = [p for p, v in placements[s].items() if v == "—"]
        unplaced_pe_girls.append((s, free))

print(f"\nGirls who wanted G PE but didn't get it: {len(unplaced_pe_girls)}")
if unplaced_pe_girls:
    print("Their availability at periods where seats would free up:")
    matches = 0
    for s, free in unplaced_pe_girls:
        viable = [p for p in free if freed_seats_by_period[p] > 0]
        marker = " <- can be placed" if viable else ""
        print(f"  {s:<30}  free at {free}{marker}")
        if viable:
            matches += 1
    print(f"\nProjected placements from dedupe + freed seats: ~{matches}")
