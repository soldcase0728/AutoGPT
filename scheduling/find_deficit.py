"""Find courses where the grid is structurally deficient:
   demand from student_requests > capacity in grid_v12.

Uses the same name normalization as solve_v10.py to bridge request titles
(e.g., 'Spanish I') to grid course names (e.g., 'Spanish 1 B' / 'G Spanish 1').
"""
import csv, re
from collections import defaultdict, Counter

PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]

# ---- Same normalizer used in solve_v10.py ----
ROMAN = [("VIII","8"),("VII","7"),("VI","6"),("IV","4"),("III","3"),
         ("IX","9"),("II","2"),("V","5"),("I","1")]
SUBS = [
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
    ("Pre Calculus",                     "Pre-Calc"),
    ("Pre-Calculus",                     "Pre-Calc"),
    ("Algebra II",                       "Algebra 2"),
    ("Conceptual Physics",               "Conc Phys"),
    ("Concepts of Physics",              "Conc Phys"),
    ("Chemistry 10",                     "Chem"),
    ("Biology",                          "Bio"),
    ("Chemistry",                        "Chem"),
    ("G PE",                             "G PE/Health"),
    ("Building Wealth",                  "Build Wealth"),
    ("Business Administration/DECA",     "Business"),
    ("Business Administration",          "Business"),
    ("Accounting I",                     "Account"),
    ("Accounting II",                    "Account"),
    ("Accounting",                       "Account"),
    ("Current Events/Geography",         "Current Events"),
    ("Choir I",  "Choir"), ("Choir II", "Choir"),
    ("Choir III","Choir"), ("Choir IV", "Choir"),
    ("Band I",   "Band 1-4"), ("Band II",  "Band 1-4"),
    ("Band III", "Band 1-4"), ("Band IV",  "Band 1-4"),
    ("Sacred Scriptures and Holy Trinity",   "Sacred Scrip"),
    ("Sacred Scriptures & The Holy Trinity", "Sacred Scrip"),
    ("Sacraments & Morality",            "Sacraments"),
    ("Sacraments and Morality",          "Sacraments"),
    ("Jesus the Redeemer & The Church",  "Jesus Redeem"),
    ("Jesus the Redeemer and The Church","Jesus Redeem"),
    ("World Religions",                  "World Relig"),
    ("World Literature",                 "World Lit"),
    ("American Literature",              "Amer Lit"),
    ("U.S. History and Geography",       "US Hist"),
    ("US History and Geography",         "US Hist"),
    ("World History and Geography",      "World Hist"),
    ("World History & Geography",        "World Hist"),
    ("Environmental Science",            "Env Sci"),
    ("College Psychology",               "College Psyc"),
    ("College Biology",                  "College Bio"),
    ("College Calculus",                 "College Calc"),
    ("College Composition",              "College Comp"),
    ("Polish History",                   "Polish Hist"),
    ("Advanced Liturgy 12",              "Adv Liturgy"),
    ("Advanced Liturgy",                 "Adv Liturgy"),
    ("Forensic Science",                 "Forensic Sci"),
    ("Forensics/Debate",                 "Forensics/Debate (combined)"),
    ("Moments in History",               "Moments Hist"),
    ("Grammar and Genre Studies 9",      "Grammar"),
    ("Grammar and Genre Studies",        "Grammar"),
    ("Engineering Rotation",             "Engineering ROT"),
    ("Music Tech Rotation",              "Music Tech ROT"),
    ("Multimedia Rotation",              "MM ROT"),
]
def base_name(req):
    n = req
    for s, d in SUBS: n = n.replace(s, d)
    for rn, ar in ROMAN: n = re.sub(rf"\b{rn}\b", ar, n)
    return n.strip()

def request_to_grid_keys(req, gender):
    """Return candidate grid course names this request could match."""
    n = base_name(req)
    out = []
    if n.startswith("G "):
        bare = n[2:]
        out.extend([n, bare + " G", bare,
                    bare + " (Combined)", bare + " (combined)"])
    elif gender == "Female":
        out.extend(["G " + n, n + " G", n,
                    n + " (Combined)", n + " (combined)"])
    else:  # Male
        out.extend([n + " B", "B " + n, n,
                    n + " (Combined)", n + " (combined)"])
    return out

# ---- Load capacity from grid_v12.csv ----
USED_CAP = re.compile(r"(\d+)\s*/\s*(\d+)")
SKIP = {"SEM","LUNCH","PREP","ADMIN","AVAILABLE","TBD","—","","— CUT —","SEM/DECA"}

cap_by_course = defaultdict(int)
sections_by_course = defaultdict(list)
with open("grid_v12.csv", encoding="utf-8-sig") as f:
    rows = list(csv.reader(f))
hdr = rows[1]
pc = {p: hdr.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]: continue
    teacher = row[0].strip().strip("~").strip()
    for p in PERIODS:
        cell = (row[pc[p]] or "").strip()
        if not cell or cell in SKIP: continue
        lines = [ln.strip() for ln in cell.split("\n") if ln.strip()]
        if len(lines) < 2: continue
        m = USED_CAP.search(cell)
        if not m: continue
        course = lines[0]
        cap = int(m.group(2))
        cap_by_course[course] += cap
        sections_by_course[course].append((p, teacher, cap))

# ---- Load student requests + map to grid courses ----
# A request demands 1 seat in *some* eligible grid section. We tally demand
# against the FIRST matching grid course (most-specific gender form first).
demand_by_grid_course = defaultdict(int)
unmatched_titles = Counter()
with open("student_requests.csv", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        t = row["Title"].strip()
        if "seminar" in t.lower(): continue
        g_str = row["Gender"].strip()
        gender = "Female" if g_str == "Female" else "Male"
        cands = request_to_grid_keys(t, gender)
        # pick the first candidate that exists as a grid course
        matched = None
        for c in cands:
            if c in cap_by_course:
                matched = c
                break
        if matched is None:
            unmatched_titles[t] += 1
            continue
        demand_by_grid_course[matched] += 1

# ---- Compute deficit ----
rows_out = []
for course in set(list(cap_by_course) + list(demand_by_grid_course)):
    cap = cap_by_course.get(course, 0)
    demand = demand_by_grid_course.get(course, 0)
    deficit = demand - cap
    rows_out.append((deficit, demand, cap, course))

rows_out.sort(reverse=True)
print("="*80)
print(f"{'Course':<30}  {'Demand':>8}  {'Cap':>5}  {'Deficit':>8}  Periods")
print("="*80)
print("Courses where DEMAND EXCEEDS CAPACITY (true shortage):")
print("-"*80)
for deficit, demand, cap, course in rows_out:
    if deficit <= 0: continue
    ps = ",".join(p for p,_,_ in sections_by_course.get(course, []))
    print(f"  {course:<30}  {demand:>8}  {cap:>5}  {deficit:>+8}  [{ps}]")

print()
print("="*80)
print("Courses where capacity is TIGHT (within 5 of cap):")
print("-"*80)
for deficit, demand, cap, course in rows_out:
    if deficit > 0: continue
    slack = -deficit
    if 0 <= slack <= 5 and cap > 0:
        ps = ",".join(p for p,_,_ in sections_by_course.get(course, []))
        print(f"  {course:<30}  {demand:>8}  {cap:>5}  slack {slack:>3}  [{ps}]")

print()
print("="*80)
print("Courses with NO grid section (demand exists, capacity = 0):")
print("-"*80)
no_cap = [(d, dem, course) for d, dem, cap, course in rows_out if cap == 0]
no_cap.sort(reverse=True)
for _, dem, course in no_cap:
    if dem > 0:
        print(f"  {course:<30}  {dem:>3} requests, 0 sections")

print()
print(f"Request titles I could NOT match to any grid course "
      f"(probably real curriculum gaps): {sum(unmatched_titles.values())}")
for t, n in unmatched_titles.most_common(15):
    print(f"  {n:>3}  {t}")
