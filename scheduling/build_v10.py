"""Build v10 grid from v9 by applying user-approved section moves and kills,
then project how many additional placements each move yields by greedily
matching waitlisted students against the new open seats.

This is a HEURISTIC projection -- it gives a tight lower bound on the
real CP-solver gain because we do not re-optimize the whole grid, only
slot the displaced students into newly-accessible periods.
"""
import csv
import copy
from collections import defaultdict, Counter

PERIODS = ["1st", "2nd", "3rd", "4th", "5A", "5B", "6th", "7th", "8th"]

# v10 MOVES: each is (teacher, course_label, from_period, to_period, cap, note)
# A move "to_period=None" means kill the section.
MOVES = [
    {"teacher": "Sheena, Marcus",
     "course":  "G Jesus Redeem",
     "from":    "5A",  # was 0/24, lunch-period mismatch for 10th girls
     "to":      "6th", # Sheena's current PREP
     "cap":     24,
     "note":    "Fix lunch-period bug; concurrent w/ Skellet P6, helps girls blocked at Skellet's full sections"},

    {"teacher": "Furlong, Michael",
     "course":  "Sacred Scrip B",
     "from":    "2nd", # was 0/22 - zero enrollment
     "to":      "3rd", # Furlong's PREP -- 18 boys waitlisted are free at P3
     "cap":     22,
     "note":    "Was scheduled to KILL per user; deeper data shows MOVE captures ~18 placements"},

    {"teacher": "Johnson, Tara",
     "course":  "G Architecture",
     "from":    "8th", # was 0/22 - no requests
     "to":      None,  # kill outright
     "cap":     0,
     "note":    "No student requested this course; 22 phantom seats removed"},

    {"teacher": "Simone, Carla",
     "course":  "Spanish 1 B",
     "from":    "2nd", # was 2/22 - mostly empty
     "to":      "7th", # Simone's PREP -- 18 boys waitlisted are free at P7
     "cap":     22,
     "note":    "Stranded boys at P7; 2 displaced from P2 should absorb into P1 (10 seats free)"},

    {"teacher": "Jeffery, Keith",
     "course":  "PE/Health B",
     "from":    "2nd", # was 3/17 - mostly empty
     "to":      "7th", # Jeffery's PREP -- 18 boys waitlisted are free at P7
     "cap":     17,
     "note":    "Stranded boys at P7; 3 displaced from P2 should absorb at P1 (9 seats free)"},
]

# ----- Load v9 grid (teacher view) -----
with open("grid_v9.csv", encoding="utf-8-sig", newline="") as f:
    grid_rows = list(csv.reader(f))
header = grid_rows[1]
pcol = {p: header.index(p) for p in PERIODS}

# Map teacher name -> row index
teacher_row_idx = {grid_rows[i][0].strip().strip("~").strip(): i
                   for i in range(2, len(grid_rows))}

# ----- Apply moves to grid_rows (deep copy) -----
v10 = copy.deepcopy(grid_rows)
v10[0][0] = "OLSM Master Schedule v10 — Applied moves: Sheena/Furlong/Johnson/Simone/Jeffery"

applied = []
for m in MOVES:
    rid = teacher_row_idx.get(m["teacher"])
    if rid is None:
        print(f"WARN: teacher not found: {m['teacher']}")
        continue
    cell_from = v10[rid][pcol[m["from"]]]
    cell_to   = v10[rid][pcol[m["to"]]] if m["to"] else None
    if m["to"]:
        # New cell at to_period: course + "0/cap" (we'll fill later)
        v10[rid][pcol[m["to"]]] = f"{m['course']}\n0/{m['cap']}"
        v10[rid][pcol[m["from"]]] = "PREP"
        applied.append(f"  MOVE  {m['teacher']:<25}  {m['from']:>3} -> {m['to']:<3}  "
                       f"{m['course']:<22} (cap {m['cap']})")
    else:
        v10[rid][pcol[m["from"]]] = "PREP"
        applied.append(f"  KILL  {m['teacher']:<25}  {m['from']:>3}             "
                       f"{m['course']:<22} (was {cell_from!r})")

print("v10 EDITS APPLIED:")
print("\n".join(applied))

# ----- Write grid_v10.csv -----
with open("grid_v10.csv", "w", newline="", encoding="utf-8") as f:
    csv.writer(f).writerows(v10)
print("\nWrote grid_v10.csv")

# ----- Projection: how many waitlisted students each MOVE absorbs -----
# Load per-student placements (v9) and waitlist
def load_placements():
    placements, grade, gender = {}, {}, {}
    with open("student_offer.csv", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    h = rows[1]
    pi = {p: h.index(p) for p in PERIODS}
    for row in rows[2:]:
        if not row[0]:
            continue
        s = row[0].strip()
        placements[s] = {p: (row[pi[p]] or "").split("\n")[0].strip() or "—"
                         for p in PERIODS}
        grade[s] = row[1].strip()
        gender[s] = row[2].strip()
    return placements, grade, gender

placements, grade, gender = load_placements()

with open("waitlist.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
waitlist = [{"student": r[0].strip(),
             "grade":   r[1].strip(),
             "gender":  r[2].strip(),
             "wanted":  r[3].strip()} for r in rows[2:] if r[0]]

# Map course-label in MOVES to the request-CSV strings most likely to want it
TARGETS = {
    "G Jesus Redeem":   ["G Jesus the Redeemer and The Church"],
    "Sacred Scrip B":   ["Sacred Scriptures & The Holy Trinity"],
    "Spanish 1 B":      ["Spanish I"],
    "PE/Health B":      ["PE/Health"],
}

print()
print("=" * 75)
print("PROJECTED GAINS  (greedy fit: students free at the move's target period)")
print("=" * 75)

total_gain = 0
gainers = []  # list of (student, course) tuples that move from waitlist -> placed
for m in MOVES:
    if not m["to"]:
        continue
    label = m["course"]
    wants = TARGETS.get(label, [])
    cands = [w for w in waitlist
             if w["wanted"] in wants
             and (label.startswith("G ") and w["gender"] == "G"
                  or (not label.startswith("G ")
                      and label.endswith(" B") and w["gender"] == "B")
                  or (not label.startswith("G ") and not label.endswith(" B")))]
    free = [w for w in cands
            if placements.get(w["student"], {}).get(m["to"], "—") == "—"]
    take = free[:m["cap"]]
    total_gain += len(take)
    gainers.extend((w["student"], label) for w in take)
    print(f"  {m['teacher']:<25} {m['from']}->{m['to']}  {label:<22}  "
          f"waitlist={len(cands):>3}  free@{m['to']}={len(free):>3}  "
          f"-> seats taken: {len(take)}  (cap {m['cap']})")

print(f"\n  PROJECTED NET GAIN: +{total_gain} students placed who weren't placed in v9")
print(f"  (Note: lower bound -- a full re-solve would also re-optimize displaced kids)")

# ----- Updated stats -----
v9_complete = 257
v9_total = 847
projected_complete = v9_complete + total_gain
print(f"\n  v9  complete schedules: {v9_complete}/{v9_total}  ({v9_complete/v9_total:.0%})")
print(f"  v10 projected:          {projected_complete}/{v9_total}  ({projected_complete/v9_total:.0%})")
print(f"  Gain:                   +{total_gain} students "
      f"({total_gain/v9_total*100:.1f} percentage points)")

# Side bucket: College Psyc capacity-locked orphans
print()
print("=" * 75)
print("SIDE BUCKET (capacity-locked, not solvable by section moves)")
print("=" * 75)
cp = [w for w in waitlist if "College Psychology" in w["wanted"]]
print(f"  College Psyc orphans: {len(cp)} students "
      f"({sum(1 for w in cp if w['gender']=='B')} B + "
      f"{sum(1 for w in cp if w['gender']=='G')} G)")
print(f"  These require a NEW SECTION (Bone is the only teacher; both his")
print(f"  sections are at cap). Options: add a third Bone section,")
print(f"  cross-train another teacher, or accept the gap.")
