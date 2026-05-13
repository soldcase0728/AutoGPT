"""Profile the incomplete-schedule cohort in v9 to find common themes.
   When the v12 student offer is available, swap student_offer.csv for
   the v12 file and the same analysis runs."""
import csv
from collections import Counter, defaultdict

PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]

# Per-student data
incomplete, complete = [], []
with open("student_offer.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
header = rows[1]
m_col = header.index("Missing")
f_col = header.index("Filled")
for row in rows[2:]:
    if not row[0]: continue
    rec = {"student": row[0].strip(), "grade": row[1].strip(),
           "gender": row[2].strip(),
           "filled": int(row[f_col]) if row[f_col] else 0,
           "missing": int(row[m_col]) if row[m_col] else 0}
    (incomplete if rec["missing"] > 0 else complete).append(rec)

N = len(incomplete) + len(complete)
print(f"Total students: {N}")
print(f"Incomplete:    {len(incomplete)}  ({len(incomplete)/N:.1%})")
print(f"Complete:      {len(complete)}    ({len(complete)/N:.1%})")

# Per-student requests (to find request-side patterns)
reqs = defaultdict(list)
with open("student_requests.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        s = r["Student summary"].strip()
        title = r["Title"].strip()
        if "seminar" in title.lower(): continue
        reqs[s].append(title)

# --- Theme 1: GRADE / GENDER ---
print("\n=== By GRADE ===")
g_total = Counter(s["grade"] for s in incomplete + complete)
g_inc   = Counter(s["grade"] for s in incomplete)
for g in sorted(g_total):
    print(f"  {g:<12}  incomplete {g_inc[g]:>3} / {g_total[g]:>3}  "
          f"({g_inc[g]/g_total[g]:>5.1%})")

print("\n=== By GENDER ===")
gd_total = Counter(s["gender"] for s in incomplete + complete)
gd_inc   = Counter(s["gender"] for s in incomplete)
for g in sorted(gd_total):
    print(f"  {g!r:<10}  incomplete {gd_inc[g]:>3} / {gd_total[g]:>3}  "
          f"({gd_inc[g]/gd_total[g]:>5.1%})")

print("\n=== By GRADE x GENDER ===")
gg_total = Counter((s["grade"], s["gender"]) for s in incomplete + complete)
gg_inc   = Counter((s["grade"], s["gender"]) for s in incomplete)
for k in sorted(gg_total):
    print(f"  {str(k):<28}  incomplete {gg_inc[k]:>3} / {gg_total[k]:>3}  "
          f"({gg_inc[k]/gg_total[k]:>5.1%})")

# --- Theme 2: # of requests submitted ---
print("\n=== By # of non-SEM requests submitted ===")
req_count_inc = Counter(len(reqs[s["student"]]) for s in incomplete)
req_count_all = Counter(len(reqs[s["student"]]) for s in incomplete + complete)
for n in sorted(req_count_all):
    inc = req_count_inc[n]
    tot = req_count_all[n]
    print(f"  {n} requests:  incomplete {inc:>3} / {tot:>3}  ({inc/tot:>5.1%})")

# --- Theme 3: Which courses correlate with incompleteness? ---
# For each course, what % of students who requested it are incomplete?
print("\n=== Courses where requesters are MOST often incomplete ===")
print("(min 15 requesters)")
by_course_inc = defaultdict(int)
by_course_tot = defaultdict(int)
for s in incomplete + complete:
    for c in reqs[s["student"]]:
        by_course_tot[c] += 1
        if s in incomplete:
            by_course_inc[c] += 1
rows_sorted = []
for c, tot in by_course_tot.items():
    if tot < 15: continue
    pct = by_course_inc[c] / tot
    rows_sorted.append((pct, by_course_inc[c], tot, c))
rows_sorted.sort(reverse=True)
for pct, inc, tot, c in rows_sorted[:20]:
    print(f"  {pct:>5.1%}  ({inc:>3} of {tot:>3} requesters incomplete)  {c}")

# --- Theme 4: Unique / niche course requests ---
# Students who requested at least one "rare" course (<10 requesters)
rare = {c for c, n in by_course_tot.items() if n < 10}
print(f"\n=== Niche-course requesters (asked for a course with <10 total requesters) ===")
inc_with_rare = sum(1 for s in incomplete
                    if any(c in rare for c in reqs[s["student"]]))
tot_with_rare = sum(1 for s in (incomplete + complete)
                    if any(c in rare for c in reqs[s["student"]]))
print(f"  {inc_with_rare} of {tot_with_rare} ({inc_with_rare/tot_with_rare:.0%})")
inc_without_rare = sum(1 for s in incomplete
                        if not any(c in rare for c in reqs[s["student"]]))
tot_without_rare = sum(1 for s in (incomplete + complete)
                        if not any(c in rare for c in reqs[s["student"]]))
print(f"  Without any niche request: "
      f"{inc_without_rare} of {tot_without_rare} ({inc_without_rare/tot_without_rare:.0%})")
