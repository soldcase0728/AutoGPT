"""CP-SAT re-solve against the v10 grid.

INPUTS:
  - student_requests.csv : 847 students x ~8 requested courses each
  - grid_v10.csv         : teacher x period grid with section capacities
                           (already includes Sheena/Furlong/Simone/Jeffery
                           moves and Johnson kill)

DECISION VARIABLES:
  x[s, r, k]  = 1  iff  student s satisfies request r by being placed in
                       eligible section k of that course.

HARD CONSTRAINTS:
  H1  gender separation (G* courses for girls, *B courses for boys,
       co-ed exceptions allowed)
  H2  lunch lock-out: 9-10 cannot have a class at 5A, 11-12 cannot at 5B
  H3  one class per period per student
  H4  enrollment of each section <= capacity
  H5  each request fulfilled by at most one section (no double-placement)

OBJECTIVE:
  maximize sum of all x[s, r, k]  (= total satisfied requests).
"""
import csv
import re
import time
from collections import defaultdict, Counter

from ortools.sat.python import cp_model

PERIODS = ["1st", "2nd", "3rd", "4th", "5A", "5B", "6th", "7th", "8th"]
LUNCH_OF = {"9th Grade": "5A", "10th Grade": "5A",
            "11th Grade": "5B", "12th Grade": "5B"}
SEM_PERIOD = "4th"

# Sections that we treat as co-ed (no gender filter)
COED_NAME_HINTS = ("Choir", "Band", "AP Art", "Forensics", "AP French",
                   "French 3 (Combined)", "Hon Eng (combined)",
                   "Math Analysis", "Moments Hist", "Genetics",
                   "AP Computer Science", "AP Stats", "Statistics",
                   "College Calc", "Math ", "Adv Liturgy")

# ---------- Course name normalization (request name -> grid name pieces) ----
ROMAN = [("VIII","8"),("VII","7"),("VI","6"),("IV","4"),("III","3"),
         ("IX","9"),("II","2"),("V","5"),("I","1")]
SUBS = [
    # ----- AP-prefixed rules MUST come before non-AP rules -----
    ("AP U.S. History and Geography",    "AP US Hist"),
    ("AP World History and Geography",   "AP Wrld Hist"),
    ("AP American Literature",           "AP Amer Lit"),
    ("AP World Literature",              "AP World Lit"),
    ("AP Chemistry",                     "AP Chem"),
    ("AP Statistics",                    "AP Stats"),
    ("AP Econ/Government",               "AP Econ"),
    ("AP Econ/Gov",                      "AP Econ"),
    ("Econ/Government",                  "Econ"),
    ("Econ/Gov",                         "Econ"),
    # Honors abbreviations (longest match first)
    ("Honors Pre Calculus",              "Hon Pre-Calc"),
    ("Honors Engineering Science",       "Hon Eng Sci"),
    ("Honors English 9",                 "Hon Eng 9"),
    ("Honors English 10",                "Hon Eng 10"),
    ("Honors Algebra II",                "Hon Alg 2"),
    ("Honors Algebra 2",                 "Hon Alg 2"),
    ("Honors Geometry",                  "Hon Geo"),
    ("Honors Biology",                   "Hon Bio"),
    ("Honors Chemistry",                 "Hon Chem"),
    ("Honors Physics",                   "Hon Physics"),
    ("Honors ",                          "Hon "),
    # Other math/science
    ("Pre Calculus",                     "Pre-Calc"),
    ("Pre-Calculus",                     "Pre-Calc"),
    ("Algebra II",                       "Algebra 2"),
    ("Conceptual Physics",               "Conc Phys"),
    ("Concepts of Physics",              "Conc Phys"),
    ("Chemistry 10",                     "Chem"),
    ("Biology",                          "Bio"),
    ("Chemistry",                        "Chem"),
    # PE -- handle "G PE" explicitly to avoid double-sub of "PE/Health"
    ("G PE",                             "G PE/Health"),
    # Business / accounting / personal-finance variants
    ("Building Wealth",                  "Build Wealth"),
    ("Business Administration/DECA",     "Business"),
    ("Business Administration",          "Business"),
    ("Accounting I",                     "Account"),
    ("Accounting II",                    "Account"),
    ("Accounting",                       "Account"),
    # Other course-name short forms used in the grid
    ("Current Events/Geography",         "Current Events"),
    ("Choir I",  "Choir"), ("Choir II", "Choir"),
    ("Choir III","Choir"), ("Choir IV", "Choir"),
    ("Band I",   "Band 1-4"), ("Band II",  "Band 1-4"),
    ("Band III", "Band 1-4"), ("Band IV",  "Band 1-4"),
    ("Sacred Scriptures and Holy Trinity", "Sacred Scrip"),
    ("Sacred Scriptures & The Holy Trinity", "Sacred Scrip"),
    ("Sacraments & Morality", "Sacraments"),
    ("Sacraments and Morality", "Sacraments"),
    ("Jesus the Redeemer & The Church", "Jesus Redeem"),
    ("Jesus the Redeemer and The Church", "Jesus Redeem"),
    ("World Religions",     "World Relig"),
    ("World Literature",    "World Lit"),
    ("American Literature", "Amer Lit"),
    ("U.S. History and Geography", "US Hist"),
    ("US History and Geography",   "US Hist"),
    ("World History and Geography","World Hist"),
    ("World History & Geography",  "World Hist"),
    ("AP World History and Geography","AP Wrld Hist"),
    ("AP U.S. History and Geography", "AP US Hist"),
    ("Environmental Science","Env Sci"),
    ("College Psychology",  "College Psyc"),
    ("College Biology",     "College Bio"),
    ("College Calculus",    "College Calc"),
    ("College Composition", "College Comp"),
    ("Business Administration", "Business"),
    ("Business Administration/DECA", "Business"),
    ("Concepts of Physics", "Conc Phys"),
    ("Polish History",      "Polish Hist"),
    ("Econ/Government",     "Econ"),
    ("AP Econ/Government",  "AP Econ"),
    ("AP Econ/Gov",         "AP Econ"),
    ("Advanced Liturgy 12", "Adv Liturgy"),
    ("Advanced Liturgy",    "Adv Liturgy"),
    ("Forensic Science",    "Forensic Sci"),
    ("Forensics/Debate",    "Forensics/Debate (combined)"),
    ("AP American Literature", "AP Amer Lit"),
    ("AP World Literature", "AP World Lit"),
    ("AP Chemistry",        "AP Chem"),
    ("AP Statistics",       "AP Stats"),
    ("Moments in History",  "Moments Hist"),
    ("Grammar and Genre Studies 9", "Grammar"),
    ("Grammar and Genre Studies",   "Grammar"),
    ("Engineering Rotation","Engineering ROT"),
    ("Music Tech Rotation", "Music Tech ROT"),
    ("Multimedia Rotation", "MM ROT"),
]

def base_name(req: str) -> str:
    n = req
    for src, dst in SUBS:
        n = n.replace(src, dst)
    for rn, ar in ROMAN:
        n = re.sub(rf"\b{rn}\b", ar, n)
    return n.strip()

# ---------- Load student requests --------------------------------------
students = {}  # name -> dict(grade, gender, requests=[course_string])
with open("student_requests.csv", encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        s = row["Student summary"].strip()
        if s not in students:
            students[s] = {"grade":  row["Student grade level"].strip(),
                           "gender": row["Gender"].strip() or "?",
                           "requests": []}
        # Skip Seminar requests -- everyone gets SEM at P4 automatically
        # (matches "Seminar 100", "G Seminar 100", etc.)
        title = row["Title"].strip()
        if "seminar" in title.lower():
            continue
        students[s]["requests"].append(title)

# Default unknown-gender students to Male (matches earlier audit)
for s, d in students.items():
    if d["gender"] not in ("Male", "Female"):
        d["gender"] = "Male"

print(f"Students:        {len(students)}")
print(f"Total non-SEM requests: {sum(len(d['requests']) for d in students.values())}")

# ---------- Load v10 grid ---------------------------------------------
sections = []   # list of dict(course, period, teacher, cap)
USED_CAP = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$")
SKIP = {"SEM", "LUNCH", "PREP", "ADMIN", "AVAILABLE", "TBD", "—", "",
        "— CUT —", "SEM/DECA"}

with open("grid_v10.csv", encoding="utf-8-sig", newline="") as f:
    rows = list(csv.reader(f))
header = rows[1]
pcol = {p: header.index(p) for p in PERIODS}

for row in rows[2:]:
    teacher = row[0].strip().strip("~").strip()
    if not teacher:
        continue
    for p in PERIODS:
        if pcol[p] >= len(row):
            continue
        cell = (row[pcol[p]] or "").strip()
        if not cell or cell in SKIP:
            continue
        lines = [ln.strip() for ln in cell.split("\n") if ln.strip()]
        if len(lines) < 2:
            continue
        course = lines[0]
        m = USED_CAP.match(lines[1])
        if not m:
            continue
        cap = int(m.group(2))
        sections.append({"course": course, "period": p,
                         "teacher": teacher, "cap": cap})

print(f"Sections (v10):  {len(sections)}")
print(f"Total cap:       {sum(s['cap'] for s in sections)}")

# ---------- Eligibility ------------------------------------------------
# For a (student, request) find the list of section indices the student
# could be placed in.

def is_coed_section(course: str) -> bool:
    return any(h in course for h in COED_NAME_HINTS)

def section_gender(course: str) -> str:
    """Return 'G' or 'B' or 'X' (any)."""
    if is_coed_section(course):
        return "X"
    # 'G ' prefix (most G courses) or ' G' suffix (Computer Science G)
    if course.startswith("G ") or course.endswith(" G"):
        return "G"
    return "B"

def candidate_section_names(req: str, gender: str) -> list[str]:
    n = base_name(req)
    out = []
    if n.startswith("G "):
        bare = n[2:]
        out.append(n)                       # 'G Foo'
        out.append(bare + " G")             # 'Foo G'  (Computer Science G pattern)
        out.append(bare)                    # bare 'Foo' (co-ed like Choir, Forensics)
        out.append(bare + " (Combined)")    # 'Foo (Combined)' (French 3, AP French)
        out.append(bare + " (combined)")
        out.append("Forensics/Debate (combined)")  # for any 'G Forensics*' shape
    elif gender == "Female":
        out.append("G " + n)
        out.append(n + " G")
        out.append(n)
        out.append(n + " (Combined)")
        out.append(n + " (combined)")
    else:
        out.append(n + " B")
        out.append("B " + n)
        out.append(n)
        out.append(n + " (Combined)")
        out.append(n + " (combined)")
    return out

# Build name -> [section_idx, ...] index
by_course_name = defaultdict(list)
for i, s in enumerate(sections):
    by_course_name[s["course"]].append(i)

def eligible_for(student_name: str, req: str) -> list[int]:
    student = students[student_name]
    g = student["gender"]
    grade = student["grade"]
    lunch = LUNCH_OF.get(grade)
    cands = candidate_section_names(req, g)
    out = []
    for name in cands:
        for idx in by_course_name.get(name, []):
            sec = sections[idx]
            # gender check
            sec_g = section_gender(sec["course"])
            if sec_g != "X":
                if g == "Female" and sec_g != "G":
                    continue
                if g == "Male"   and sec_g != "B":
                    continue
            # lunch block
            if sec["period"] == lunch:
                continue
            # SEM block
            if sec["period"] == SEM_PERIOD:
                continue
            out.append(idx)
        if out:
            break  # first matched name family wins
    return out

# ---------- Build CP-SAT model ----------------------------------------
print("\nBuilding model...")
t0 = time.time()
model = cp_model.CpModel()

# x[(student_name, request_idx, section_idx)] = bool
x = {}
unmatched_requests = []  # (student, course) with no eligible section
student_list = sorted(students.keys())

for s in student_list:
    student = students[s]
    for r_idx, req in enumerate(student["requests"]):
        elig = eligible_for(s, req)
        if not elig:
            unmatched_requests.append((s, req))
            continue
        for k in elig:
            x[(s, r_idx, k)] = model.NewBoolVar(f"x_{len(x)}")

print(f"  variables: {len(x):,}")
print(f"  requests with NO eligible section: {len(unmatched_requests)}")
if unmatched_requests:
    cnt = Counter(req for _, req in unmatched_requests)
    print("  top unmatched:")
    for req, n in cnt.most_common(10):
        print(f"    {n:>3}  {req}")

# H5: each request fulfilled by at most one section
for s in student_list:
    student = students[s]
    for r_idx, _ in enumerate(student["requests"]):
        elig_vars = [x[(s, r_idx, k)] for k in eligible_for(s, req=student["requests"][r_idx])
                     if (s, r_idx, k) in x]
        if elig_vars:
            model.AddAtMostOne(elig_vars)

# H3: at most one class per student per period
for s in student_list:
    student = students[s]
    for p in PERIODS:
        if p == SEM_PERIOD or p == LUNCH_OF.get(student["grade"]):
            continue
        vars_at_p = []
        for r_idx, _ in enumerate(student["requests"]):
            for k in eligible_for(s, student["requests"][r_idx]):
                if sections[k]["period"] == p and (s, r_idx, k) in x:
                    vars_at_p.append(x[(s, r_idx, k)])
        if vars_at_p:
            model.AddAtMostOne(vars_at_p)

# H4: each section <= capacity
for k, sec in enumerate(sections):
    in_section = [x[key] for key in x if key[2] == k]
    if in_section:
        model.Add(sum(in_section) <= sec["cap"])

# H6: each student in each COURSE at most once
# (prevents the solver from filling an empty slot with a duplicate section
# of a course the student already has -- the "double PE" bug.)
# We group eligible vars by (student, course) and AddAtMostOne over them.
from collections import defaultdict as _dd
by_student_course = _dd(list)
for (s, r_idx, k), var in x.items():
    course = sections[k]["course"]
    by_student_course[(s, course)].append(var)
for (s, course), vlist in by_student_course.items():
    if len(vlist) > 1:
        model.AddAtMostOne(vlist)

# Objective
model.Maximize(sum(x.values()))

print(f"  model built in {time.time()-t0:.1f}s")

# ---------- Solve ------------------------------------------------------
print("\nSolving...")
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 600
solver.parameters.num_search_workers = 8
solver.parameters.log_search_progress = False

t0 = time.time()
status = solver.Solve(model)
elapsed = time.time() - t0

print(f"  status: {solver.StatusName(status)}  ({elapsed:.1f}s)")
print(f"  objective (requests placed): {int(solver.ObjectiveValue())}")

# ---------- Extract placements ----------------------------------------
placements_by_student = defaultdict(dict)   # name -> {period: course_label}
section_counts = Counter()
satisfied_count_per_student = Counter()

for (s, r_idx, k), var in x.items():
    if solver.Value(var) == 1:
        sec = sections[k]
        placements_by_student[s][sec["period"]] = sec["course"]
        section_counts[k] += 1
        satisfied_count_per_student[s] += 1

# Fill in SEM and LUNCH cells
for s, d in students.items():
    placements_by_student[s][SEM_PERIOD] = "SEM"
    placements_by_student[s][LUNCH_OF.get(d["grade"])] = "LUNCH"

# Compute Missing per student
miss_dist = Counter()
total_requests = 0
total_placed = 0
for s, d in students.items():
    nreq = len(d["requests"])
    placed = satisfied_count_per_student[s]
    miss = nreq - placed
    total_requests += nreq
    total_placed += placed
    miss_dist[miss] += 1

complete = miss_dist[0]
N = len(students)
print()
print("=" * 70)
print("v10 SOLVER RESULTS")
print("=" * 70)
print(f"  Students complete (Miss=0):  {complete} / {N}  ({complete/N:.1%})")
print(f"  Distribution of Missing:")
for m in sorted(miss_dist):
    print(f"    Miss = {m}: {miss_dist[m]:>3} students")
print()
print(f"  Total non-SEM requests:      {total_requests}")
print(f"  Requests placed:             {total_placed}  ({total_placed/total_requests:.1%})")
print(f"  Requests on waitlist:        {total_requests - total_placed}")

# Compare to v9
print()
print("-" * 70)
print("v9 vs v10 comparison")
print("-" * 70)
print(f"  v9 complete schedules:  257 / 847  (30.3%)")
print(f"  v10 (this solve):       {complete} / {N}  ({complete/N:.1%})")
delta = complete - 257
print(f"  Delta:                  {delta:+d} students  ({delta/N*100:+.1f} pp)")
print(f"  v9 placements:          5007 / 5852  (85.6%)")
print(f"  v10 placements:         {total_placed} / {total_requests}  ({total_placed/total_requests:.1%})")
print(f"  Delta:                  {total_placed - 5007:+d} placements")

# ---------- Write outputs ---------------------------------------------
out_csv = "student_offer_v10.csv"
with open(out_csv, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Student", "Grade", "Gender",
                *PERIODS, "Filled", "Missing"])
    for s in student_list:
        d = students[s]
        nreq = len(d["requests"])
        placed = satisfied_count_per_student[s]
        row = [s, d["grade"], d["gender"]]
        for p in PERIODS:
            row.append(placements_by_student[s].get(p, "—"))
        row.extend([placed, nreq - placed])
        w.writerow(row)
print(f"\nWrote {out_csv}  ({N} students)")

# Section utilization vs v9
print()
print("=" * 70)
print("TOP UTILIZATION CHANGES vs v9 (sections with >5 enrollment delta)")
print("=" * 70)
# Read v9 capacity report
v9_fill = {}
with open("capacity_report.csv") as f:
    rows = list(csv.reader(f))
for row in rows[2:]:
    if not row[0]:
        continue
    key = (row[0].strip(), row[1].strip(), row[2].strip())  # (course, period, teacher)
    v9_fill[key] = int(row[4]) if row[4] else 0

changes = []
for k, sec in enumerate(sections):
    key = (sec["course"], sec["period"], sec["teacher"])
    v9 = v9_fill.get(key, 0)
    v10 = section_counts[k]
    if abs(v10 - v9) >= 5:
        changes.append((sec, v9, v10))
changes.sort(key=lambda t: -(t[2]-t[1]))
for sec, v9, v10 in changes[:20]:
    print(f"  {sec['period']:>3}  v9={v9:>2} -> v10={v10:>2}  ({v10-v9:+d})  "
          f"{sec['course']:<25}  ({sec['teacher']})")
