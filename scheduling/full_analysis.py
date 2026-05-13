"""End-to-end analysis pass:
  1. Normalize course names so request-CSV names line up with grid names.
  2. Recompute the top-waitlisted courses with REAL capacity numbers.
  3. "Where are they free?" pivot for the top-N waitlisted courses.
  4. 11th-grade drill-down: why is 74% of the junior class incomplete?
"""
import csv
import re
from collections import Counter, defaultdict

PERIODS = ["1st", "2nd", "3rd", "4th", "5A", "5B", "6th", "7th", "8th"]

# ---------------------------------------------------------------- 1. Loaders
def load_placements():
    placements, grade, gender, missing = {}, {}, {}, {}
    with open("student_offer.csv", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header = rows[1]
    pidx = {p: header.index(p) for p in PERIODS}
    for row in rows[2:]:
        if not row[0]:
            continue
        s = row[0].strip()
        placements[s] = {p: (row[pidx[p]] or "").split("\n")[0].strip() or "—"
                         for p in PERIODS}
        grade[s] = row[1].strip()
        gender[s] = row[2].strip()
        missing[s] = int(row[13]) if row[13] else 0
    return placements, grade, gender, missing

def load_waitlist():
    wl = []
    with open("waitlist.csv", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    for row in rows[2:]:
        if not row[0]:
            continue
        wl.append({"student": row[0].strip(), "grade": row[1].strip(),
                   "gender": row[2].strip(), "wanted": row[3].strip()})
    return wl

def load_capacity():
    """Return list of {course, period, teacher, cap, filled, available}."""
    out = []
    with open("capacity_report.csv", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    for row in rows[2:]:
        if not row[0]:
            continue
        out.append({"course":   row[0].strip(),
                    "period":   row[1].strip(),
                    "teacher":  row[2].strip(),
                    "cap":      int(row[3]) if row[3] else 0,
                    "filled":   int(row[4]) if row[4] else 0,
                    "available":int(row[5]) if row[5] else 0})
    return out

# ---------------------------------------------------------- 2. Name normalization
ROMAN = [("VIII", "8"), ("VII", "7"), ("VI", "6"), ("IV", "4"),
         ("III", "3"), ("II", "2"), ("IX", "9"), ("V", "5"), ("I", "1")]
SUBS = [
    ("Honors Pre Calculus", "Hon Pre-Calc"),
    ("Pre Calculus",        "Pre-Calc"),
    ("Honors English 9",    "Hon Eng 9"),
    ("Honors English 10",   "Hon Eng 10"),
    ("Honors Algebra 2",    "Hon Alg 2"),
    ("Honors Geometry",     "Hon Geo"),
    ("Honors Biology",      "Hon Bio"),
    ("Honors Chemistry",    "Hon Chem"),
    ("Honors Physics",      "Hon Physics"),
    ("Honors Engineering Science", "Hon Eng Sci"),
    ("Honors ",             "Hon "),
    ("Algebra 2",           "Alg 2"),
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
    ("AP World History and Geography","AP Wrld Hist"),
    ("Environmental Science","Env Sci"),
    ("College Psychology",  "College Psyc"),
    ("College Biology",     "College Bio"),
    ("College Calculus",    "College Calc"),
    ("College Composition", "College Comp"),
    ("Business Administration", "Business"),
    ("Concepts of Physics", "Conc Phys"),
    ("Polish History",      "Polish Hist"),
    ("Econ/Government",     "Econ"),
    ("AP Econ/Government",  "AP Econ"),
    ("Advanced Liturgy 12", "Adv Liturgy"),
    ("Advanced Liturgy",    "Adv Liturgy"),
    ("Forensic Science",    "Forensic Sci"),
    ("Forensics/Debate",    "Forensics/Debate (combined)"),
    ("Math Analysis",       "Math Analysis"),
    ("Engineering Rotation","Engineering ROT"),
    ("Music Tech Rotation", "Music Tech ROT"),
    ("Multimedia Rotation", "MM ROT"),
    ("Build Wealth",        "Build Wealth"),
    ("Personal Finance",    "Personal Finance"),
    ("Computer Science",    "Computer Science"),
    ("Genetics",            "Genetics"),
    ("Anatomy",             "Anatomy"),
    ("Choir",               "Choir"),
    ("Statistics",          "Statistics"),
    ("AP Statistics",       "AP Stats"),
    ("AP American Literature", "AP Amer Lit"),
    ("AP U.S. History and Geography", "AP US Hist"),
    ("AP World Literature", "AP World Lit"),
    ("AP Chemistry",        "AP Chem"),
    ("AP Physics",          "AP Physics"),
    ("Moments in History",  "Moments Hist"),
    ("Current Events",      "Current Events"),
    ("Grammar and Genre Studies 9", "Grammar"),
    ("Grammar and Genre Studies",   "Grammar"),
]

def base_name(req: str) -> str:
    """Apply text substitutions; leave the 'G '/no-G prefix alone for now."""
    name = req
    for src, dst in SUBS:
        name = name.replace(src, dst)
    # roman numerals only on whole-word boundaries at end of words like "Spanish I"
    for rn, ar in ROMAN:
        name = re.sub(rf"\b{rn}\b", ar, name)
    return name.strip()


def grid_candidates(req: str, gender: str) -> list[str]:
    """Given a request and a student gender, return the LIKELY grid course
    names to search for in capacity rows."""
    n = base_name(req)
    out = []
    # Some requests already have 'G ' prefix
    has_g = n.startswith("G ")
    if has_g:
        out.append(n)                          # 'G Foo'
    elif gender == "G":
        out.append("G " + n)                   # girl wants 'Foo' -> 'G Foo'
        # Some girls courses don't follow the 'G ' pattern (Choir/Band/etc)
        out.append(n)
    elif gender == "B":
        out.append(n + " B")                   # boy 'Foo' -> 'Foo B'
        out.append(n)                          # fall back to bare name (combined)
        out.append("B " + n)                   # 'B Personal Finance' pattern
    else:
        out.append(n)
    return out


# ---------------------------------------------------------------- 3. Run
placements, grade, gender, missing = load_placements()
wl = load_waitlist()
cap_rows = load_capacity()

# index capacity by course name
caps_by_course: dict[str, list[dict]] = defaultdict(list)
for c in cap_rows:
    caps_by_course[c["course"]].append(c)

# attach normalized names + matched-capacity to each waitlist row
for w in wl:
    cands = grid_candidates(w["wanted"], w["gender"])
    w["grid_name"] = None
    for c in cands:
        if c in caps_by_course:
            w["grid_name"] = c
            break

unmatched = [w for w in wl if w["grid_name"] is None]
print(f"Waitlist rows matched to a grid course: "
      f"{len(wl) - len(unmatched)} / {len(wl)}")
if unmatched:
    print(f"Top unmatched waitlist courses (first 15):")
    for v, n in Counter(w["wanted"] for w in unmatched).most_common(15):
        print(f"  {n:>3}  {v}")

# ---- Top-waitlisted with NORMALIZED capacity ----
print()
print("=" * 75)
print("TOP WAITLISTED COURSES (normalized to grid sections)")
print("=" * 75)

def fmt_caps(name):
    secs = caps_by_course.get(name, [])
    if not secs:
        return "no grid sections"
    tot_cap = sum(s["cap"] for s in secs)
    tot_fill = sum(s["filled"] for s in secs)
    avail = sum(s["available"] for s in secs)
    periods = ",".join(s["period"] for s in secs)
    return f"fill={tot_fill}/{tot_cap}  avail={avail}  @[{periods}]"

# Bucket by grid_name when matched, fall back to wanted name
buckets = defaultdict(list)
for w in wl:
    key = w["grid_name"] or f"(unmatched) {w['wanted']}"
    buckets[key].append(w)

for name, members in sorted(buckets.items(), key=lambda kv: -len(kv[1]))[:25]:
    print(f"  waitlist={len(members):>3}  {fmt_caps(name)}  {name}")

# ---- "Where are they free?" pivot for top-6 matched courses ----
print()
print("=" * 75)
print("\"WHERE ARE THEY FREE?\" PIVOT  (top 6 matched waitlisted courses)")
print("=" * 75)
top_matched = [name for name, _ in sorted(buckets.items(), key=lambda kv: -len(kv[1]))
               if name in caps_by_course][:6]

for course in top_matched:
    members = buckets[course]
    secs = caps_by_course[course]
    print(f"\n  ▼ {course}  ({len(members)} waitlisted)")
    print(f"     existing sections: " +
          ", ".join(f"{s['period']} {s['filled']}/{s['cap']}" for s in secs))
    # for each period, count waitlist members who have '—' or LUNCH there
    for p in PERIODS:
        free = sum(1 for w in members
                   if placements.get(w["student"], {}).get(p, "—") == "—")
        marker = ""
        # already at cap there?
        ex = [s for s in secs if s["period"] == p]
        if ex and ex[0]["available"] == 0:
            marker = "  (existing section FULL)"
        elif ex:
            marker = f"  (existing section has {ex[0]['available']} seats)"
        if free or marker:
            print(f"        {p}: {free:>3} free{marker}")

# ---- 11th-grade drill-down ----
print()
print("=" * 75)
print("11TH GRADE DRILL-DOWN  (74% incomplete -- worst grade)")
print("=" * 75)
g11_students = [s for s in grade if grade[s] == "11th Grade"]
g11_incomplete = [s for s in g11_students if missing[s] > 0]
print(f"  Total 11th graders: {len(g11_students)}")
print(f"  Incomplete:         {len(g11_incomplete)}  "
      f"(avg missing = {sum(missing[s] for s in g11_incomplete)/len(g11_incomplete):.2f})")

# Top missing courses for 11th
g11_wl = [w for w in wl if w["grade"] == "11th Grade"]
print(f"\n  Top waitlisted courses for 11th grade ({len(g11_wl)} total entries):")
g11_buckets = Counter((w["grid_name"] or "(unmatched) " + w["wanted"])
                     for w in g11_wl)
for name, n in g11_buckets.most_common(12):
    print(f"    waitlist={n:>3}  {fmt_caps(name) if not name.startswith('(unmatched)') else 'n/a'}  {name}")

# Period-by-period: where do 11th grade incomplete students have "—"?
print(f"\n  Where 11th graders have '—' (empty slot) -- {len(g11_incomplete)} students:")
g11_empty_by_period = Counter()
for s in g11_incomplete:
    for p in PERIODS:
        if placements[s].get(p, "—") == "—":
            g11_empty_by_period[p] += 1
for p in PERIODS:
    print(f"    {p}: {g11_empty_by_period[p]:>3} students free")

# What sections at those periods STILL HAVE SEATS that 11th graders could take?
print(f"\n  Sections with available seats at 11th-grader-accessible periods")
print(f"  (skip 5B = junior lunch; skip rows where filled = cap):")
relevant = []
for c in cap_rows:
    if c["period"] == "5B":  # 11th grade lunch
        continue
    if c["available"] <= 0:
        continue
    # exclude clearly non-11th-grade courses (the 'B Personal Finance' etc are 10th)
    name = c["course"]
    skip_prefixes = ("Hon Bio", "G Hon Bio", "G Bio", "Bio B", "Polish Hist",
                     "G Polish Hist", "Current Events", "Algebra 1", "G Algebra 1",
                     "MM ROT", "G MM ROT", "Music Tech", "G Music Tech",
                     "Engineering ROT", "G Engineering ROT", "French 1",
                     "G French 1", "Sacred Scrip", "G Sacred Scrip",
                     "Spanish 1", "G Spanish 1", "Computer Science",  # mostly 9/10
                     "G Architecture")
    if any(name.startswith(p) for p in skip_prefixes):
        continue
    relevant.append(c)
relevant.sort(key=lambda c: -c["available"])
for c in relevant[:20]:
    print(f"    {c['period']:>3}  {c['filled']:>2}/{c['cap']:<2}  avail={c['available']:>2}  "
          f"{c['course']:<28} ({c['teacher']})")
