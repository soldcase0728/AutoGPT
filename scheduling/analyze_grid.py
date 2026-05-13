"""Parse the OLSM teacher x period grid and surface capacity / slack / phantom sections.

The grid CSV format (after the title row):
  Teacher, 1st, 2nd, 3rd, 4th, 5A, 5B, 6th, 7th, 8th, Total Classes

Each period cell is either a special token (SEM, LUNCH, PREP, ADMIN, AVAILABLE,
TBD, "—", "— CUT —") or a course assignment formatted as two physical lines
inside a single quoted CSV field:

    Course Name
    used/cap

We collapse the multi-line field with csv.reader (which handles embedded
newlines in quoted fields), then split on '\n' to pull (course, used, cap).
"""
import csv
import re
from collections import defaultdict

PATH = "grid_v9.csv"

PERIODS = ["1st", "2nd", "3rd", "4th", "5A", "5B", "6th", "7th", "8th"]
LUNCH_PERIOD_BY_GRADE = {"9th": "5A", "10th": "5A", "11th": "5B", "12th": "5B"}

SPECIALS = {"SEM", "LUNCH", "PREP", "ADMIN", "AVAILABLE", "TBD", "—", "",
            "— CUT —", "SEM/DECA"}

USED_CAP_RE = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$")


def parse_cell(cell: str):
    """Return (course, used, cap) or None for specials."""
    cell = cell.strip()
    if not cell or cell in SPECIALS:
        return None
    # multi-line: course on line 1, "used/cap" on line 2 (sometimes more)
    lines = [ln.strip() for ln in cell.split("\n") if ln.strip()]
    if len(lines) < 2:
        return None
    course = lines[0]
    m = USED_CAP_RE.match(lines[1])
    if not m:
        return None
    return course, int(m.group(1)), int(m.group(2))


# (teacher, course, period) -> (used, cap)
sections = []  # list of dicts
teachers = []

with open(PATH, encoding="utf-8-sig", newline="") as f:
    reader = csv.reader(f)
    rows = list(reader)

# Row 0 is the title, row 1 is the header
header = rows[1]
assert header[0] == "Teacher"
period_cols = {p: header.index(p) for p in PERIODS}

for row in rows[2:]:
    if not row or not row[0].strip():
        continue
    teacher = row[0].strip().strip("~").strip()
    teachers.append(teacher)
    for p in PERIODS:
        cell = row[period_cols[p]] if period_cols[p] < len(row) else ""
        parsed = parse_cell(cell)
        if parsed is None:
            continue
        course, used, cap = parsed
        sections.append({
            "teacher": teacher,
            "period": p,
            "course": course,
            "used": used,
            "cap": cap,
            "slack": cap - used,
            "util": used / cap if cap else 0.0,
        })

print(f"Teachers read:       {len(teachers)}")
print(f"Sections parsed:     {len(sections)}")
print(f"Total seats offered: {sum(s['cap'] for s in sections):,}")
print(f"Seats filled:        {sum(s['used'] for s in sections):,}")
print(f"Empty seats:         {sum(s['slack'] for s in sections):,}")

# Capacity bottlenecks: sections at 100% utilization
print("\n=== CAPACITY BOTTLENECKS (100% full) ===")
full = sorted([s for s in sections if s["used"] == s["cap"]],
              key=lambda s: (-s["cap"], s["course"]))
print(f"({len(full)} sections at cap)")
for s in full[:25]:
    print(f"  {s['period']:>3}  {s['used']:>2}/{s['cap']:<2}  "
          f"{s['course']:<35} ({s['teacher']})")

# Most empty seats (slack)
print("\n=== MOST SLACK (empty seats) ===")
for s in sorted(sections, key=lambda s: -s["slack"])[:25]:
    print(f"  {s['period']:>3}  {s['used']:>2}/{s['cap']:<2}  slack={s['slack']:>2}  "
          f"{s['course']:<35} ({s['teacher']})")

# Phantom sections: 0 used  OR  scheduled at a period that's lunch for the target audience
print("\n=== ZERO-ENROLLMENT SECTIONS (used = 0) ===")
zeros = [s for s in sections if s["used"] == 0]
for s in zeros:
    print(f"  {s['period']:>3}  0/{s['cap']:<2}  "
          f"{s['course']:<35} ({s['teacher']})")

# Try to flag sections placed at the wrong period for their grade audience
# Heuristic: G Jesus Redeem / Jesus Redeem B / G Hon Eng 10 etc. -> 10th grade
# We can't be perfect; report sections at 5A/5B with very low fill as suspects.
print("\n=== LUNCH-SLOT SECTIONS (placed at 5A or 5B) ===")
print("(5A is lunch for 9/10; 5B is lunch for 11/12 -- a section here is")
print(" only reachable by the OTHER half of the school)")
for s in sections:
    if s["period"] in ("5A", "5B"):
        print(f"  {s['period']}  {s['used']:>2}/{s['cap']:<2}  "
              f"{s['course']:<35} ({s['teacher']})")

# Per-course aggregates: total cap vs total filled across all its sections
print("\n=== PER-COURSE TOTAL CAPACITY vs DEMAND (top 30 fullest courses) ===")
by_course = defaultdict(lambda: {"sections": 0, "used": 0, "cap": 0, "periods": []})
for s in sections:
    c = by_course[s["course"]]
    c["sections"] += 1
    c["used"] += s["used"]
    c["cap"] += s["cap"]
    c["periods"].append(s["period"])
ranked = sorted(by_course.items(),
                key=lambda kv: (-(kv[1]["used"] / kv[1]["cap"] if kv[1]["cap"] else 0),
                                -kv[1]["used"]))
for course, c in ranked[:30]:
    util = c["used"] / c["cap"] if c["cap"] else 0
    ps = ",".join(c["periods"])
    print(f"  {c['used']:>3}/{c['cap']:<3}  ({util:.0%})  x{c['sections']}  "
          f"@[{ps:<12}]  {course}")
