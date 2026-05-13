"""Master orphan catalog.

Combines:
  - student_offer.csv  : v9 placements (one row per student, columns are periods)
  - waitlist.csv       : the 845 unmet requests, with the OR-tools backup suggestion
  - capacity_report.csv: section-level fill / capacity
  - grid_v9.csv        : teacher grid (for period lookup)

Outputs both human-readable summaries and a machine-readable
`orphan_catalog.csv` keyed by (student, wanted_course).
"""
import csv
import re
from collections import Counter, defaultdict

PERIODS = ["1st", "2nd", "3rd", "4th", "5A", "5B", "6th", "7th", "8th"]

# ----- 1. Per-student placements -----
# placements[student] = {period: course}
placements: dict[str, dict[str, str]] = {}
student_grade = {}
student_gender = {}
student_filled = {}
student_missing = {}

with open("student_offer.csv", encoding="utf-8") as f:
    r = csv.reader(f)
    rows = list(r)
header = rows[1]
p_idx = {p: header.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]:
        continue
    s = row[0].strip()
    placements[s] = {}
    for p in PERIODS:
        cell = (row[p_idx[p]] or "").strip()
        if not cell:
            placements[s][p] = "—"
        else:
            # course name is line 1 of multi-line cell
            course = cell.split("\n")[0].strip()
            placements[s][p] = course
    student_grade[s] = row[1].strip()
    student_gender[s] = row[2].strip()
    student_filled[s] = int(row[12]) if row[12] else 0
    student_missing[s] = int(row[13]) if row[13] else 0

print(f"Loaded {len(placements)} student placements")

# ----- 2. Waitlist -----
waitlist = []  # list of {student, grade, gender, wanted, backup, backup_period, ...}
with open("waitlist.csv", encoding="utf-8") as f:
    r = csv.reader(f)
    rows = list(r)
for row in rows[2:]:
    if not row[0]:
        continue
    waitlist.append({
        "student":      row[0].strip(),
        "grade":        row[1].strip(),
        "gender":       row[2].strip(),
        "wanted":       row[3].strip(),
        "backup":       row[4].strip(),
        "backup_period":row[5].strip(),
        "backup_teach": row[6].strip(),
        "backup_seats": row[7].strip(),
    })

print(f"Loaded {len(waitlist)} waitlist entries")

# ----- 3. Capacity report -----
# capacity_by_course[course] = list of {period, teacher, cap, filled, available}
capacity_by_course: dict[str, list[dict]] = defaultdict(list)
with open("capacity_report.csv", encoding="utf-8") as f:
    r = csv.reader(f)
    rows = list(r)
for row in rows[2:]:
    if not row[0]:
        continue
    capacity_by_course[row[0].strip()].append({
        "period":    row[1].strip(),
        "teacher":   row[2].strip(),
        "cap":       int(row[3]) if row[3] else 0,
        "filled":    int(row[4]) if row[4] else 0,
        "available": int(row[5]) if row[5] else 0,
    })

print(f"Loaded {len(capacity_by_course)} courses in capacity report")

# ----- 4. Aggregate stats -----
print()
print("=" * 70)
print("DEMAND-vs-WAITLIST BY COURSE  (top 30 most-waitlisted)")
print("=" * 70)
want_count = Counter(w["wanted"] for w in waitlist)
for course, n in want_count.most_common(30):
    # Look up total cap/fill from capacity report (course names may differ slightly)
    sections = capacity_by_course.get(course, [])
    total_cap = sum(s["cap"] for s in sections)
    total_fill = sum(s["filled"] for s in sections)
    periods = ",".join(s["period"] for s in sections) or "—"
    print(f"  waitlist={n:>3}  capacity={total_fill}/{total_cap}  @[{periods}]  {course}")

# Missing == 0 means complete; group breakdown
print()
print("=" * 70)
print("STUDENTS WITH INCOMPLETE SCHEDULES, by grade")
print("=" * 70)
incomplete_by_grade = Counter()
total_by_grade = Counter()
for s, miss in student_missing.items():
    total_by_grade[student_grade[s]] += 1
    if miss > 0:
        incomplete_by_grade[student_grade[s]] += 1
for g in sorted(total_by_grade):
    inc = incomplete_by_grade[g]
    tot = total_by_grade[g]
    print(f"  {g:<12}  {inc:>3} / {tot}  incomplete  ({inc/tot:.0%})")

print()
print("=" * 70)
print("WORST-OFF STUDENTS  (Missing >= 3)")
print("=" * 70)
worst = sorted([(s, student_missing[s], student_filled[s])
                for s in student_missing if student_missing[s] >= 3],
               key=lambda t: -t[1])
print(f"({len(worst)} students)")
for s, m, f in worst[:25]:
    print(f"  Miss={m} Filled={f}  {s}  ({student_grade[s]} {student_gender[s]})")

# ----- 5. The Sheena→P2 question -----
print()
print("=" * 70)
print("SHEENA MOVE ANALYSIS — G Jesus Redeem")
print("=" * 70)
g_jr_waitlist = [w for w in waitlist
                 if "jesus" in w["wanted"].lower() and w["gender"] == "G"]
print(f"Girls waitlisted for some form of Jesus Redeem: {len(g_jr_waitlist)}")
# print the distinct course strings to see naming variants
print("  Wanted-course string variants:")
for v, n in Counter(w["wanted"] for w in g_jr_waitlist).items():
    print(f"    {n:>3}  {v!r}")

# For each girl on waitlist for G JR, find what they have at P2 (Sheena's
# candidate slot) and P6 (the other Skellet G JR slot)
print()
print("  How many G JR waitlist girls are FREE (—) at each period:")
for p in PERIODS:
    free = sum(1 for w in g_jr_waitlist
               if placements.get(w["student"], {}).get(p, "—") == "—")
    print(f"    {p}: {free} of {len(g_jr_waitlist)} free")

# ----- 6. Bone / College Psyc orphans -----
print()
print("=" * 70)
print("COLLEGE PSYC ORPHANS")
print("=" * 70)
cp = [w for w in waitlist if "psyc" in w["wanted"].lower()]
print(f"Students waitlisted for some form of College Psyc: {len(cp)}")
for v, n in Counter(w["wanted"] for w in cp).items():
    print(f"  {n:>3}  {v!r}")
boys_cp = [w for w in cp if w["gender"] == "B"]
girls_cp = [w for w in cp if w["gender"] == "G"]
print(f"  Boys: {len(boys_cp)}    Girls: {len(girls_cp)}")

# ----- 7. Write the catalog file -----
out_path = "orphan_catalog.csv"
with open(out_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["student", "grade", "gender", "wanted_course", "missing_total",
                "filled_total", "backup_suggestion", "backup_period",
                "backup_teacher", "backup_seats",
                "p1", "p2", "p3", "p4", "p5A", "p5B", "p6", "p7", "p8"])
    for wl in waitlist:
        s = wl["student"]
        pl = placements.get(s, {})
        w.writerow([
            s, wl["grade"], wl["gender"], wl["wanted"],
            student_missing.get(s, ""), student_filled.get(s, ""),
            wl["backup"], wl["backup_period"], wl["backup_teach"],
            wl["backup_seats"],
            *(pl.get(p, "—") for p in PERIODS),
        ])
print()
print(f"Wrote orphan catalog to {out_path}  ({len(waitlist)} rows)")
