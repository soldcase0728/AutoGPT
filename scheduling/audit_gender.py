"""Audit request data against the gender-separation rule:
  - 'G <Course>' = girls only
  - '<Course>'   = boys only
Flag any cross-gender requests and any courses that appear with both genders.
"""
import csv
from collections import defaultdict, Counter

PATH = "student_requests.csv"

# {course: {gender: count}}
course_gender = defaultdict(lambda: Counter())
# {student: {gender, [(course, is_g_prefixed)]}}
student_rows = defaultdict(list)
student_gender = {}

with open(PATH, encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        s = row["Student summary"].strip()
        c = row["Title"].strip()
        g = row["Gender"].strip()
        student_gender[s] = g
        course_gender[c][g] += 1
        student_rows[s].append(c)

# Categorize courses
g_courses = {c for c in course_gender if c.startswith("G ")}
b_courses = {c for c in course_gender if not c.startswith("G ")}
print(f"Girls-prefixed courses: {len(g_courses)}")
print(f"Non-prefixed (boys/coed?) courses: {len(b_courses)}")

# Find boys requesting G courses, girls requesting non-G courses
boys_in_g = []      # (student, course)
girls_in_nong = []  # (student, course)
unknown_gender = []
for s, courses in student_rows.items():
    g = student_gender[s]
    for c in courses:
        is_g = c.startswith("G ")
        if g == "Male" and is_g:
            boys_in_g.append((s, c))
        elif g == "Female" and not is_g:
            girls_in_nong.append((s, c))
        elif g not in ("Male", "Female"):
            unknown_gender.append((s, g, c))

print(f"\nBoys requesting G-prefixed courses: {len(boys_in_g)}")
for s, c in boys_in_g[:10]:
    print(f"  {s}  ->  {c}")
if len(boys_in_g) > 10:
    print(f"  ... +{len(boys_in_g)-10} more")

print(f"\nGirls requesting non-G courses: {len(girls_in_nong)}")
# group by course
gn_by_course = Counter(c for _, c in girls_in_nong)
for c, n in gn_by_course.most_common(20):
    print(f"  {n:4d}  {c}")

print(f"\nStudents with blank gender: {len(unknown_gender)}")
for row in unknown_gender[:10]:
    print(f"  {row}")

# Courses that appear under both genders (i.e. the non-G version has female requests)
print("\nCourses with mixed-gender requests (data smell):")
mixed = []
for c, counts in course_gender.items():
    m, f = counts.get("Male", 0), counts.get("Female", 0)
    if m > 0 and f > 0:
        mixed.append((c, m, f))
mixed.sort(key=lambda x: -(x[1] + x[2]))
for c, m, f in mixed[:25]:
    print(f"  M={m:3d}  F={f:3d}  {c}")
print(f"  (total mixed: {len(mixed)})")
