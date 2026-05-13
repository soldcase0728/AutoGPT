"""Find quick-fix opportunities in the v12 state:
   1. Where can Bone add a 3rd College Psyc section?  (clears 33 students)
   2. Which period would a second G College Calc / Bio / AP Stats fit?
   3. G Sacraments: 47 girls missing it; which period needs another section?
   4. The duplicate G PE at P3 -- can we recover the placeholder?
"""
import csv, re
from collections import Counter, defaultdict

PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]
LUNCH_OF = {"9th Grade":"5A","10th Grade":"5A","11th Grade":"5B","12th Grade":"5B"}

# Load v12 placements
placements, grade, gender, missing = {}, {}, {}, {}
with open("student_offer_v12.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
header = rows[1]
pi = {p: header.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]: continue
    s = row[0].strip()
    placements[s] = {p: (row[pi[p]] or "").split("\n")[0].strip() or "—"
                     for p in PERIODS}
    grade[s] = row[1].strip()
    gender[s] = row[2].strip()
    missing[s] = int(row[13]) if row[13] else 0

# Load requests for cross-reference
reqs = defaultdict(list)
with open("student_requests.csv", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        if "seminar" in row["Title"].lower(): continue
        reqs[row["Student summary"].strip()].append(row["Title"].strip())

# Compute who is missing what
def is_placed_in(placements_s, course_key):
    return any(course_key in p for p in placements_s.values())

def find_missing_for(course_keywords, target_gender=None, requires_grade=None):
    """For students who requested any of `course_keywords` but didn't get it,
       return (student, list_of_empty_periods)."""
    out = []
    for s, rs in reqs.items():
        if not any(kw in r for r in rs for kw in course_keywords): continue
        if target_gender and gender.get(s) != target_gender: continue
        if requires_grade and grade.get(s) != requires_grade: continue
        # check they didn't get it
        # match by simplified course name in placement
        got = False
        for slot in placements.get(s, {}).values():
            for kw in course_keywords:
                # rough match - the keyword appears in the placed course name
                # need to be careful with substrings
                if kw in slot:
                    got = True
        if got: continue
        # they didn't get it; find their free slots
        free = [p for p, v in placements.get(s, {}).items() if v == "—"]
        out.append((s, grade.get(s), gender.get(s), free))
    return out

# ============================================================================
# 1. BONE — where can he add a 3rd College Psyc?
# ============================================================================
print("="*75)
print("FIX #1: BONE -- where to add a 3rd College Psyc section")
print("="*75)
print()

# Load Bone's current row from v12 grid
with open("grid_v12.csv", encoding="utf-8-sig") as f:
    rows = list(csv.reader(f))
hdr = rows[1]
pcol = {p: hdr.index(p) for p in PERIODS}
for row in rows[2:]:
    if row[0].strip().startswith("Bone"):
        print("Bone, Russell's current v12 schedule:")
        for p in PERIODS:
            cell = (row[pcol[p]] or "").replace("\n", " / ").strip()
            print(f"  {p}: {cell}")
        bone_admin = [p for p in PERIODS if "ADMIN" in (row[pcol[p]] or "")]
        break

print(f"\nBone's ADMIN periods: {bone_admin}")
print("(Any of these could be converted to a 3rd College Psyc section)\n")

# Find the 33 College Psyc orphans and see at which Bone-ADMIN period they're free
cp_b = find_missing_for(["College Psyc"], target_gender="B")
cp_g = find_missing_for(["G College Psyc"], target_gender="G")
print(f"  College Psyc B orphans: {len(cp_b)} boys")
print(f"  G College Psyc orphans: {len(cp_g)} girls")
print()
print("How many of those 33 are FREE at each of Bone's admin slots:")
all_cp_orphans = cp_b + cp_g
for p in bone_admin:
    free = sum(1 for (s, gr, gn, fr) in all_cp_orphans if p in fr)
    print(f"  {p}: {free} of {len(all_cp_orphans)} free")

# ============================================================================
# 2. SINGLE-SECTION GIRLS AP COURSES -- where to add a 2nd section
# ============================================================================
print()
print("="*75)
print("FIX #2: WHERE TO ADD SECOND SECTIONS FOR SINGLE-SECTION GIRLS AP")
print("="*75)
candidates = [
    ("G College Calculus", ["G College Calc"]),
    ("G College Biology",  ["G College Bio"]),
    ("G AP Statistics",    ["G AP Stats"]),
    ("G AP Spanish",       ["G AP Spanish"]),
    ("G AP Chemistry",     ["G AP Chem"]),
]
for label, kws in candidates:
    orphans = find_missing_for(kws, target_gender="G")
    print(f"\n  ▼ {label}: {len(orphans)} girls waiting")
    if not orphans:
        continue
    print(f"     Where these girls are FREE:")
    for p in PERIODS:
        if p == "4th": continue  # SEM
        free = sum(1 for (_, gr, _, fr) in orphans if p in fr)
        if free:
            print(f"        {p}: {free} of {len(orphans)} free")

# ============================================================================
# 3. G SACRAMENTS -- why are 47 girls missing it with 5 sections?
# ============================================================================
print()
print("="*75)
print("FIX #3: G SACRAMENTS -- 47 girls missing, 5 sections exist")
print("="*75)
sacr = find_missing_for(["G Sacraments"], target_gender="G")
print(f"  G Sacraments orphans: {len(sacr)} girls")
print()
# Where do the existing G Sacraments sections sit, and how full are they
print("  Existing G Sacraments sections in v12:")
with open("grid_v12.csv", encoding="utf-8-sig") as f:
    rows = list(csv.reader(f))
for row in rows[2:]:
    if not row[0]: continue
    teacher = row[0].strip()
    for p in PERIODS:
        cell = (row[pcol[p]] or "").strip()
        if "G Sacraments" in cell:
            print(f"    {p}: {cell.replace(chr(10), ' / ')}  ({teacher})")
print()
print("  Where the 47 orphans are FREE:")
for p in PERIODS:
    if p == "4th": continue
    free = sum(1 for (_, gr, _, fr) in sacr if p in fr)
    if free:
        print(f"    {p}: {free} of {len(sacr)} free")

# ============================================================================
# 4. P3 G PE consolidation
# ============================================================================
print()
print("="*75)
print("FIX #4: P3 G PE/Health duplicate -- consolidate to recover 1 placeholder")
print("="*75)
print("  ADMIN PLACEHOLDER 3 P3: 4/27")
print("  ADMIN PLACEHOLDER 5 P3: 18/27")
print("  Combined: 22 students  --> fits in ONE section (cap 27)")
print()
print("  Action: move PLACEHOLDER 3's 4 students into PLACEHOLDER 5's section.")
print("  Result: PLACEHOLDER 3 entire row becomes empty -- 1 teacher")
print("  reservation slot freed. Can be redeployed (e.g., Nursing P1, etc.).")
