"""Quick exploratory analysis of the student requests CSV."""
import csv
from collections import Counter, defaultdict
from itertools import combinations

PATH = "student_requests.csv"

students_courses: dict[str, set[str]] = defaultdict(set)
student_grade: dict[str, str] = {}
student_gender: dict[str, str] = {}
student_term: dict[str, str] = {}

with open(PATH, encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        s = row["Student summary"].strip()
        c = row["Title"].strip()
        students_courses[s].add(c)
        student_grade[s] = row["Student grade level"].strip()
        student_gender[s] = row["Gender"].strip()
        student_term[s] = row["Request start term"].strip()

print(f"Total students:        {len(students_courses)}")
print(f"Total requests (rows): {sum(len(v) for v in students_courses.values())}")
print(f"Unique courses:        {len({c for s in students_courses.values() for c in s})}")

# Requests per student
rps = Counter(len(v) for v in students_courses.values())
print("\nRequests-per-student distribution:")
for k in sorted(rps):
    print(f"  {k} requests: {rps[k]} students")

# Grade distribution
print("\nGrade distribution:")
for g, n in Counter(student_grade.values()).most_common():
    print(f"  {g}: {n}")

# Gender distribution
print("\nGender distribution:")
for g, n in Counter(student_gender.values()).most_common():
    print(f"  {g}: {n}")

# Term distribution
print("\nTerm distribution:")
for t, n in Counter(student_term.values()).most_common():
    print(f"  {t}: {n}")

# Demand per course (top 30)
demand = Counter()
for s, cs in students_courses.items():
    for c in cs:
        demand[c] += 1

print(f"\nTop 30 courses by demand (of {len(demand)} total):")
for c, n in demand.most_common(30):
    print(f"  {n:4d}  {c}")

print("\nLowest 15 courses by demand:")
for c, n in demand.most_common()[-15:]:
    print(f"  {n:4d}  {c}")
