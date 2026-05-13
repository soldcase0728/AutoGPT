"""Debug why CP-SAT v10 places fewer than v9.

For every v9 placement, check whether my eligibility filter would even
generate an x[s, r, k] variable for it. Any placement v9 made that I
can't model is a normalization / eligibility bug."""
import csv, re
from collections import Counter, defaultdict

# Re-use the same loaders as solve_v10.py
PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]
LUNCH_OF = {"9th Grade":"5A","10th Grade":"5A","11th Grade":"5B","12th Grade":"5B"}
SEM_PERIOD = "4th"
COED_NAME_HINTS = ("Choir","Band","AP Art","Forensics","AP French",
                   "French 3 (Combined)","Hon Eng (combined)",
                   "Math Analysis","Moments Hist","Genetics",
                   "AP Computer Science","AP Stats","Statistics",
                   "College Calc","Math ","Adv Liturgy")
ROMAN=[("VIII","8"),("VII","7"),("VI","6"),("IV","4"),("III","3"),
       ("IX","9"),("II","2"),("V","5"),("I","1")]
SUBS=[("Honors Pre Calculus","Hon Pre-Calc"),("Pre Calculus","Pre-Calc"),
      ("Honors English 9","Hon Eng 9"),("Honors English 10","Hon Eng 10"),
      ("Honors Algebra II","Hon Alg 2"),("Honors Algebra 2","Hon Alg 2"),
      ("Honors Geometry","Hon Geo"),("Honors Biology","Hon Bio"),
      ("Honors Chemistry","Hon Chem"),("Honors Physics","Hon Physics"),
      ("Honors Engineering Science","Hon Eng Sci"),
      ("Honors ","Hon "),
      ("Algebra II","Algebra 2"),("Biology","Bio"),("Chemistry","Chem"),
      ("G PE","G PE/Health"),
      ("Sacred Scriptures and Holy Trinity","Sacred Scrip"),
      ("Sacred Scriptures & The Holy Trinity","Sacred Scrip"),
      ("Sacraments & Morality","Sacraments"),
      ("Sacraments and Morality","Sacraments"),
      ("Jesus the Redeemer & The Church","Jesus Redeem"),
      ("Jesus the Redeemer and The Church","Jesus Redeem"),
      ("World Religions","World Relig"),("World Literature","World Lit"),
      ("American Literature","Amer Lit"),
      ("U.S. History and Geography","US Hist"),
      ("US History and Geography","US Hist"),
      ("World History and Geography","World Hist"),
      ("World History & Geography","World Hist"),
      ("AP World History and Geography","AP Wrld Hist"),
      ("AP U.S. History and Geography","AP US Hist"),
      ("Environmental Science","Env Sci"),
      ("College Psychology","College Psyc"),("College Biology","College Bio"),
      ("College Calculus","College Calc"),("College Composition","College Comp"),
      ("Business Administration","Business"),
      ("Business Administration/DECA","Business"),
      ("Concepts of Physics","Conc Phys"),("Polish History","Polish Hist"),
      ("Econ/Government","Econ"),("AP Econ/Government","AP Econ"),
      ("AP Econ/Gov","AP Econ"),
      ("Advanced Liturgy 12","Adv Liturgy"),("Advanced Liturgy","Adv Liturgy"),
      ("Forensic Science","Forensic Sci"),
      ("Forensics/Debate","Forensics/Debate (combined)"),
      ("AP American Literature","AP Amer Lit"),
      ("AP World Literature","AP World Lit"),("AP Chemistry","AP Chem"),
      ("AP Statistics","AP Stats"),("Moments in History","Moments Hist"),
      ("Grammar and Genre Studies 9","Grammar"),
      ("Grammar and Genre Studies","Grammar"),
      ("Engineering Rotation","Engineering ROT"),
      ("Music Tech Rotation","Music Tech ROT"),
      ("Multimedia Rotation","MM ROT")]
def base_name(req):
    n=req
    for s,d in SUBS: n=n.replace(s,d)
    for rn,ar in ROMAN: n=re.sub(rf"\b{rn}\b",ar,n)
    return n.strip()

# Load students from request CSV
students={}
with open("student_requests.csv",encoding="utf-8-sig",newline="") as f:
    for row in csv.DictReader(f):
        s=row["Student summary"].strip()
        if s not in students:
            students[s]={"grade":row["Student grade level"].strip(),
                         "gender":row["Gender"].strip() or "Male"}
            if students[s]["gender"] not in ("Male","Female"):
                students[s]["gender"]="Male"

# Load v9 placements from student_offer.csv
v9_placements={}
with open("student_offer.csv",encoding="utf-8") as f:
    rows=list(csv.reader(f))
header=rows[1]
pcol={p:header.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]: continue
    s=row[0].strip()
    v9_placements[s]={}
    for p in PERIODS:
        cell=(row[pcol[p]] or "").split("\n")[0].strip()
        if cell and cell not in ("—","LUNCH","SEM"):
            v9_placements[s][p]=cell

# Load v10 grid
USED_CAP=re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$")
SKIP={"SEM","LUNCH","PREP","ADMIN","AVAILABLE","TBD","—","","— CUT —","SEM/DECA"}
sections=[]
with open("grid_v10.csv",encoding="utf-8-sig",newline="") as f:
    rows=list(csv.reader(f))
header=rows[1]
pc={p:header.index(p) for p in PERIODS}
for row in rows[2:]:
    if not row[0]: continue
    teacher=row[0].strip().strip("~").strip()
    for p in PERIODS:
        if pc[p]>=len(row): continue
        cell=(row[pc[p]] or "").strip()
        if not cell or cell in SKIP: continue
        lines=[ln.strip() for ln in cell.split("\n") if ln.strip()]
        if len(lines)<2: continue
        m=USED_CAP.match(lines[1])
        if not m: continue
        sections.append({"course":lines[0],"period":p,"teacher":teacher,
                         "cap":int(m.group(2))})

# Index sections by (course, period)
sec_by_cp=defaultdict(list)
for i,s in enumerate(sections):
    sec_by_cp[(s["course"],s["period"])].append(i)

# Now: for every v9 placement, check if a matching section exists in v10
# and if my eligibility-name logic would have produced it.
def is_coed(c): return any(h in c for h in COED_NAME_HINTS)
def cands(req, gender):
    n=base_name(req)
    if n.startswith("G "): return [n]
    if gender=="Female": return ["G "+n, n]
    return [n+" B","B "+n,n]

unmodeled = []
for s, slots in v9_placements.items():
    if s not in students: continue
    student = students[s]
    for p, course in slots.items():
        # check if this exact (course, period) section exists in v10
        if (course, p) not in sec_by_cp:
            # was the section removed in v10? Skip if so (architecture etc.)
            continue
        # check if the student's request would normalize to this course
        # (We don't have requests in this script, so try both 'Spanish I'-style
        # and the literal grid course)
        # Easier: just check if 'course' is in cands(course, gender) -- it
        # should be a no-op pass if normalization works.
        # Better: just record (s, course, p) -> v10 section that we should be able to model.
        # The actual test: is `course` reachable from SOME request the student has?
        pass

# Simpler approach: count how many v9 (student, course) placements exist
# whose course-name does NOT appear in any cands list for that student.
v9_courses = set()
for s, slots in v9_placements.items():
    for c in slots.values():
        v9_courses.add(c)
print(f"Distinct courses placed in v9: {len(v9_courses)}")

# For each request in student_requests.csv, compute candidate names and
# count how many of them match any actual v10 section name.
req_counts = Counter()
no_match_examples = defaultdict(list)
with open("student_requests.csv",encoding="utf-8-sig",newline="") as f:
    for row in csv.DictReader(f):
        s=row["Student summary"].strip()
        title=row["Title"].strip()
        if "seminar" in title.lower(): continue
        if s not in students: continue
        gender=students[s]["gender"]
        c=cands(title, gender)
        # see if ANY candidate name matches a section course name
        hit = any(any(name==sec["course"] for sec in sections) for name in c)
        req_counts[("hit" if hit else "miss")] += 1
        if not hit:
            no_match_examples[title].append((s, gender, c))

print(f"\nRequest match status:")
print(f"  hit (eligible sections exist):  {req_counts['hit']}")
print(f"  miss (no eligible section):     {req_counts['miss']}")
print(f"\nTop unmatched requests:")
for title, examples in sorted(no_match_examples.items(),
                              key=lambda kv: -len(kv[1]))[:20]:
    sample = examples[0]
    print(f"  {len(examples):>3}  {title!r}  -> tried {sample[2]}  (gender {sample[1]})")
