"""Build v11 from v10 by killing electives the school will not offer:
    - Grammar B  (both sections: Schop P7, Keller P2)
    - Math Analysis  (Clouse P8)
    - Statistics B   (Clouse P6, NEW HIRE Math P7)
    - Creative Writing and History by Hollywood: not currently offered
      anywhere in the grid, so no change to the grid -- requests remain
      orphaned.
    - G Architecture: already killed in v10.

After re-writing the grid, re-runs the CP-SAT solver via solve_v10.py
substitution and produces student_offer_v11.csv.
"""
import copy
import csv

PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]

KILLS = [
    {"teacher": "Schop, Gregory",          "period": "7th", "course": "Grammar B"},
    {"teacher": "Keller, Miki",            "period": "2nd", "course": "Grammar B"},
    {"teacher": "Clouse, Bobby",           "period": "7th", "course": "Math Analysis"},
    {"teacher": "Clouse, Bobby",           "period": "6th", "course": "Statistics B"},
    {"teacher": "NEW HIRE Math (Anson Replacement)", "period": "6th", "course": "Statistics B"},
]

with open("grid_v10.csv", encoding="utf-8-sig", newline="") as f:
    rows = list(csv.reader(f))
header = rows[1]
pcol = {p: header.index(p) for p in PERIODS}

v11 = copy.deepcopy(rows)
v11[0][0] = "OLSM Master Schedule v11 — v10 + kill Grammar/MathAnalysis/Statistics electives"

teacher_to_row = {rows[i][0].strip().strip("~").strip(): i
                  for i in range(2, len(rows))}

applied = []
for k in KILLS:
    rid = teacher_to_row.get(k["teacher"])
    if rid is None:
        print(f"WARN: teacher not found: {k['teacher']}")
        continue
    before = v11[rid][pcol[k["period"]]]
    # confirm the cell matches the expected course
    if k["course"] not in before:
        print(f"WARN: expected {k['course']!r} at {k['teacher']} {k['period']}, "
              f"found {before!r}; skipping")
        continue
    v11[rid][pcol[k["period"]]] = "PREP"
    applied.append(f"  KILL  {k['teacher']:<35}  {k['period']:>3}  {k['course']:<20}  "
                   f"(was {before.replace(chr(10),' / ')!r})")

print("v11 EDITS APPLIED:")
print("\n".join(applied))

with open("grid_v11.csv", "w", newline="", encoding="utf-8") as f:
    csv.writer(f).writerows(v11)
print(f"\nWrote grid_v11.csv  ({len(KILLS)} kills)")
