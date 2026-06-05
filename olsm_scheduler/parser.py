"""Parse OLSM input files into data models."""

from __future__ import annotations

import csv
import math
import openpyxl
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

from .models import (
    Course, CourseFlag, Constraint, Gender,
    Period, Room, ScheduleData, Student, Teacher, ALL_PERIODS,
)


def _str(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _int(val, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _parse_gender(val: str) -> Optional[Gender]:
    val = val.strip().lower()
    if val in ("g", "girls", "girl", "f", "female"):
        return Gender.GIRLS
    if val in ("b", "boys", "boy", "m", "male"):
        return Gender.BOYS
    return None


def _parse_grade(val) -> int:
    s = _str(val).lower().replace("th", "").replace("grade", "").replace("nd", "").replace("rd", "").replace("st", "").strip()
    for num in ("12", "11", "10", "9"):
        if num in s:
            return int(num)
    try:
        return int(s)
    except ValueError:
        return 0


def _parse_course_flag(name: str) -> CourseFlag:
    lower = name.lower()
    if lower.startswith("ap ") or lower.startswith("g ap "):
        return CourseFlag.AP
    if "honors" in lower or "hon " in lower:
        return CourseFlag.HONORS
    if "college" in lower:
        return CourseFlag.COLLEGE
    return CourseFlag.REGULAR


def _detect_gender_restriction(title: str) -> Optional[Gender]:
    if title.startswith("G "):
        return Gender.GIRLS
    return None


def _detect_department(title: str) -> str:
    lower = title.lower().replace("g ", "", 1) if title.startswith("G ") else title.lower()

    dept_map = [
        (["sacred scrip", "sacrament", "jesus", "world relig", "advanced liturgy", "redeemer"], "Religion"),
        (["english", "american lit", "world lit", "grammar", "genre", "creative writ", "composition", "journalism"], "English"),
        (["algebra", "geometry", "calculus", "pre-calc", "pre calc", "statistics", "stats", "math analysis"], "Math"),
        (["biology", "chemistry", "physics", "anatomy", "genetics", "environmental", "forensic sci", "conceptual phys", "college bio", "nursing", "engineering"], "Science"),
        (["history", "geography", "econ", "government", "civil war", "current events", "moments in", "u.s. hist", "world hist", "women in lead", "polish hist"], "History"),
        (["spanish", "french", "polish"], "Language"),
        (["pe", "health"], "PE"),
        (["art", "multimedia", "studio art"], "Arts"),
        (["band", "choir", "music"], "Music"),
        (["computer science", "java"], "Computer Science"),
        (["business", "accounting", "deca", "building wealth", "act prep"], "Business"),
        (["psychology", "psych"], "Psychology"),
        (["seminar"], "Seminar"),
        (["forensics/debate", "speech"], "Elective"),
    ]

    for keywords, dept in dept_map:
        if any(kw in lower for kw in keywords):
            return dept
    return "Elective"


def _detect_grade_level(title: str, requesting_grades: set[int]) -> int:
    lower = title.lower()
    if " 9" in lower or "english 9" in lower or "scrip" in lower:
        return 9
    if " 10" in lower or "english 10" in lower or "sacrament" in lower:
        return 10
    if "american lit" in lower or "redeemer" in lower or "u.s. hist" in lower:
        return 11
    if "world lit" in lower or "world relig" in lower or "econ" in lower or "liturgy 12" in lower:
        return 12
    if "seminar 100" in lower:
        return 9
    if "seminar 200" in lower:
        return 10
    if "seminar 300" in lower:
        return 11
    if "seminar 400" in lower:
        return 12
    if requesting_grades:
        return min(requesting_grades)
    return 0


# ── CSV PARSER (Student_Requests.csv) ───────────────────────────────────

def load_student_requests_csv(filepath: str | Path, rotation_girls: str = "",
                               rotation_boys: str = "") -> ScheduleData:
    filepath = Path(filepath)
    data = ScheduleData()

    with open(filepath, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    student_map: dict[str, dict] = {}
    course_counter: Counter = Counter()
    course_grades: dict[str, set[int]] = defaultdict(set)
    course_genders: dict[str, set[str]] = defaultdict(set)

    for row in rows:
        name = row.get("Student summary", "").strip()
        grade_str = row.get("Student grade level", "").strip()
        title = row.get("Title", "").strip()
        gender_str = row.get("Gender", "").strip()

        if not name or not title:
            continue

        grade = _parse_grade(grade_str)
        gender = _parse_gender(gender_str)
        if not gender:
            gender_from_grade = grade_str.lower()
            if "female" in gender_from_grade:
                gender = Gender.GIRLS
            elif "male" in gender_from_grade:
                gender = Gender.BOYS

        if name not in student_map:
            sid = str(10001 + len(student_map))
            parts = name.split(None, 1)
            first = parts[0] if parts else name
            last = parts[1] if len(parts) > 1 else ""
            student_map[name] = {
                "id": sid, "first": first, "last": last,
                "grade": grade, "gender": gender,
                "courses": [],
            }

        sdata = student_map[name]
        if grade > 0:
            sdata["grade"] = grade
        if gender:
            sdata["gender"] = gender
        sdata["courses"].append(title)

        course_counter[title] += 1
        if grade > 0:
            course_grades[title].add(grade)
        if gender:
            course_genders[title].add(gender.value)

    for name, sdata in student_map.items():
        if not sdata["gender"]:
            continue
        data.students[sdata["id"]] = Student(
            student_id=sdata["id"],
            last_name=sdata["last"],
            first_name=sdata["first"],
            grade=sdata["grade"],
            gender=sdata["gender"],
            course_requests=sdata["courses"],
        )

    rot_girls = rotation_girls or "G Grammar and Genre Studies 9"
    rot_boys = rotation_boys or "Grammar and Genre Studies"

    for title, count in course_counter.items():
        gender_restriction = _detect_gender_restriction(title)
        grades = course_grades.get(title, set())
        grade_level = _detect_grade_level(title, grades)
        dept = _detect_department(title)
        flag = _parse_course_flag(title)

        is_rotation = (title == rot_girls or title == rot_boys)
        if is_rotation:
            flag = CourseFlag.ROTATION

        is_seminar = "seminar" in title.lower()

        capacity = 24
        if dept == "PE":
            capacity = 30
        elif dept == "Arts":
            capacity = 20
        elif is_seminar:
            capacity = 30
        elif is_rotation:
            capacity = 55

        min_sections = max(1, math.ceil(count / capacity))

        data.courses[title] = Course(
            code=title,
            name=title,
            department=dept,
            grade_level=grade_level,
            gender_restriction=gender_restriction,
            min_sections=min_sections,
            standard_capacity=capacity,
            flag=flag,
            enrollment_count=count,
        )

    _add_default_constraints(data)
    _auto_generate_teachers(data)

    print(f"  Parsed {len(data.students)} students, {len(data.courses)} courses, {len(data.teachers)} teachers (auto)")
    print(f"  Rotation (girls): '{rot_girls}' — {course_counter.get(rot_girls, 0)} students")
    print(f"  Rotation (boys): '{rot_boys}' — {course_counter.get(rot_boys, 0)} students")

    return data


def _auto_generate_teachers(data: ScheduleData):
    """Generate placeholder teachers when no teacher roster is provided."""
    if data.teachers:
        return

    dept_sections: dict[str, int] = defaultdict(int)
    dept_courses: dict[str, list[str]] = defaultdict(list)

    for course in data.courses.values():
        if course.enrollment_count == 0:
            continue
        sections_needed = course.required_sections()
        dept = course.department
        dept_sections[dept] += sections_needed
        dept_courses[dept].append(course.code)

    teacher_id = 1
    last_names = [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Davis", "Miller",
        "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White",
        "Harris", "Martin", "Thompson", "Garcia", "Martinez", "Robinson",
        "Clark", "Rodriguez", "Lewis", "Lee", "Walker", "Hall", "Allen",
        "Young", "King", "Wright", "Lopez", "Hill", "Scott", "Green",
        "Adams", "Baker", "Nelson", "Carter", "Mitchell", "Perez",
        "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans",
        "Edwards", "Collins", "Stewart", "Reed", "Cooper", "Morgan",
        "Kelly", "Howard", "Ward", "Cox", "Diaz", "Richardson",
        "Wood", "Watson", "Brooks", "Bennett", "Gray", "Price",
    ]
    first_names = [
        "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael",
        "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan",
        "Joseph", "Jessica", "Thomas", "Sarah", "Christopher", "Karen",
        "Charles", "Lisa", "Daniel", "Nancy", "Matthew", "Betty", "Anthony",
        "Margaret", "Mark", "Sandra", "Steven", "Ashley", "Paul", "Dorothy",
        "Andrew", "Kimberly", "Joshua", "Emily", "Kenneth", "Donna",
    ]

    for dept, total_sections in sorted(dept_sections.items()):
        teachers_needed = max(1, math.ceil(total_sections / 6))
        courses_in_dept = dept_courses[dept]
        specialties = courses_in_dept[:6]

        is_rotation_dept = dept.lower() in ("rotation",)
        is_seminar_dept = dept.lower() == "seminar"

        for i in range(teachers_needed):
            last = last_names[(teacher_id - 1) % len(last_names)]
            first = first_names[(teacher_id - 1) % len(first_names)]
            name = f"{last}, {first}"

            if name in data.teachers:
                name = f"{last}, {first} {teacher_id}"

            certs = []
            for spec in specialties:
                if "ap " in spec.lower() or spec.lower().startswith("ap "):
                    certs.append(f"AP {spec}")
                if "honor" in spec.lower():
                    certs.append(f"Honors {spec}")

            max_tp = 6
            prep = 1
            if is_rotation_dept:
                max_tp = 5
                prep = 2
            if is_seminar_dept:
                max_tp = 6

            data.teachers[name] = Teacher(
                name=name,
                department=dept,
                subject_specialties=specialties,
                certifications=certs,
                max_teaching_periods=max_tp,
                required_prep_periods=prep,
                is_rotation_teacher=is_rotation_dept,
                notes="Auto-generated" + (" Both pools" if is_rotation_dept else ""),
            )
            teacher_id += 1


def _add_default_constraints(data: ScheduleData):
    data.constraints = [
        Constraint("Rotation Period", "Girls 9th Grade", "Section A = P1, Section B = P2", "Built-in", "LOCKED"),
        Constraint("Rotation Period", "Boys 10th Grade", "Section A = P3, Section B = P5B", "Built-in", "LOCKED"),
        Constraint("Lunch Time", "All 9-10 students", "P5A", "Built-in", "LOCKED"),
        Constraint("Lunch Time", "All 11-12 students", "P5B", "Built-in", "LOCKED"),
        Constraint("SEM Period", "All", "P4 — Seminar by grade", "Built-in", "LOCKED"),
    ]


# ── XLSX PARSER (INPUT_TEMPLATES.xlsx) ──────────────────────────────────

def _parse_periods(val: str) -> list[Period]:
    if not val or val.lower() == "all":
        return list(ALL_PERIODS)
    period_map = {p.value.upper(): p for p in Period}
    result = []
    for part in val.replace(",", " ").split():
        part = part.strip().upper()
        if part in period_map:
            result.append(period_map[part])
    return result or list(ALL_PERIODS)


def _split_list(val: str) -> list[str]:
    if not val:
        return []
    return [x.strip() for x in val.replace(";", ",").split(",") if x.strip()]


def _find_header_row(ws, expected_headers: list[str]) -> int:
    for row_idx in range(1, min(ws.max_row + 1, 10)):
        values = [_str(ws.cell(row=row_idx, column=c).value).lower()
                  for c in range(1, ws.max_column + 1)]
        matches = sum(1 for h in expected_headers if any(h in v for v in values))
        if matches >= len(expected_headers) // 2:
            return row_idx
    return 0


def _col_map(ws, header_row: int) -> dict[str, int]:
    mapping = {}
    for c in range(1, ws.max_column + 1):
        val = _str(ws.cell(row=header_row, column=c).value).lower()
        if val:
            mapping[val] = c
    return mapping


def _get(ws, row: int, col_map: dict, *keys: str) -> str:
    for key in keys:
        for col_name, col_idx in col_map.items():
            if key in col_name:
                return _str(ws.cell(row=row, column=col_idx).value)
    return ""


def parse_students_xlsx(ws) -> dict[str, Student]:
    header_row = _find_header_row(ws, ["student id", "last name", "grade", "gender"])
    if not header_row:
        raise ValueError("Cannot find header row in Student Selections sheet")

    cmap = _col_map(ws, header_row)
    students = {}

    for row in range(header_row + 1, ws.max_row + 1):
        sid = _get(ws, row, cmap, "student id", "id")
        if not sid:
            continue

        last_name = _get(ws, row, cmap, "last name", "last")
        first_name = _get(ws, row, cmap, "first name", "first")
        grade = _parse_grade(_get(ws, row, cmap, "grade"))
        gender = _parse_gender(_get(ws, row, cmap, "gender", "sex"))

        if not gender or grade == 0:
            continue

        courses = []
        for col_idx in range(1, ws.max_column + 1):
            col_header = _str(ws.cell(row=header_row, column=col_idx).value).lower()
            if "course" in col_header:
                course_val = _str(ws.cell(row=row, column=col_idx).value)
                if course_val:
                    courses.append(course_val)

        students[sid] = Student(
            student_id=sid, last_name=last_name, first_name=first_name,
            grade=grade, gender=gender, course_requests=courses,
        )

    return students


def parse_teachers_xlsx(ws) -> dict[str, Teacher]:
    header_row = _find_header_row(ws, ["teacher name", "department"])
    if not header_row:
        raise ValueError("Cannot find header row in Teacher Roster sheet")

    cmap = _col_map(ws, header_row)
    teachers = {}

    for row in range(header_row + 1, ws.max_row + 1):
        name = _get(ws, row, cmap, "teacher name", "name")
        if not name:
            continue

        dept = _get(ws, row, cmap, "department", "dept")
        specialties = _split_list(_get(ws, row, cmap, "subject", "specialt"))
        certs = _split_list(_get(ws, row, cmap, "certification", "cert"))
        max_tp = _int(_get(ws, row, cmap, "max teach", "max period"), 6)
        prep = _int(_get(ws, row, cmap, "prep", "required prep"), 1)
        constraints = _get(ws, row, cmap, "constraint", "special")
        notes = _get(ws, row, cmap, "note")
        is_rotation = "rotation" in constraints.lower() or "rotation" in dept.lower()

        teachers[name] = Teacher(
            name=name, department=dept, subject_specialties=specialties,
            certifications=certs, max_teaching_periods=max_tp,
            required_prep_periods=prep, special_constraints=constraints,
            notes=notes, is_rotation_teacher=is_rotation,
        )

    return teachers


def parse_rooms_xlsx(ws) -> dict[str, Room]:
    header_row = _find_header_row(ws, ["room number", "room type", "capacity"])
    if not header_row:
        raise ValueError("Cannot find header row in Room Inventory sheet")

    cmap = _col_map(ws, header_row)
    rooms = {}

    for row in range(header_row + 1, ws.max_row + 1):
        number = _get(ws, row, cmap, "room number", "room")
        if not number:
            continue
        rtype = _get(ws, row, cmap, "room type", "type")
        cap = _int(_get(ws, row, cmap, "capacity", "cap"), 30)
        features = _get(ws, row, cmap, "feature", "special")
        avail = _parse_periods(_get(ws, row, cmap, "available", "period"))
        notes = _get(ws, row, cmap, "note")

        rooms[number] = Room(
            number=number, room_type=rtype, capacity=cap,
            special_features=features, available_periods=avail, notes=notes,
        )

    return rooms


def parse_constraints_xlsx(ws) -> list[Constraint]:
    header_row = _find_header_row(ws, ["constraint", "subject", "detail"])
    if not header_row:
        raise ValueError("Cannot find header row in Constraints sheet")

    cmap = _col_map(ws, header_row)
    constraints = []

    for row in range(header_row + 1, ws.max_row + 1):
        ctype = _get(ws, row, cmap, "constraint type", "type")
        if not ctype:
            continue
        subject = _get(ws, row, cmap, "subject", "teacher")
        detail = _get(ws, row, cmap, "detail")
        approval = _get(ws, row, cmap, "approval")
        status = _get(ws, row, cmap, "status")
        constraints.append(Constraint(
            constraint_type=ctype, subject_teacher=subject,
            detail=detail, approval_required_from=approval, status=status,
        ))

    return constraints


def load_input_file(filepath: str | Path) -> ScheduleData:
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"Input file not found: {filepath}")

    if filepath.suffix.lower() == ".csv":
        return load_student_requests_csv(filepath)

    wb = openpyxl.load_workbook(filepath, data_only=True)
    data = ScheduleData()

    sheet_map = {}
    for name in wb.sheetnames:
        lower = name.lower()
        if "student" in lower or "selection" in lower:
            sheet_map["students"] = name
        elif "course" in lower or "catalog" in lower:
            sheet_map["courses"] = name
        elif "teacher" in lower or "roster" in lower:
            sheet_map["teachers"] = name
        elif "room" in lower or "inventory" in lower:
            sheet_map["rooms"] = name
        elif "constraint" in lower:
            sheet_map["constraints"] = name

    if "students" in sheet_map:
        data.students = parse_students_xlsx(wb[sheet_map["students"]])
    if "teachers" in sheet_map:
        data.teachers = parse_teachers_xlsx(wb[sheet_map["teachers"]])
    if "rooms" in sheet_map:
        data.rooms = parse_rooms_xlsx(wb[sheet_map["rooms"]])
    if "constraints" in sheet_map:
        data.constraints = parse_constraints_xlsx(wb[sheet_map["constraints"]])

    if "courses" in sheet_map:
        ws = wb[sheet_map["courses"]]
        header_row = _find_header_row(ws, ["course code", "course name", "department"])
        if header_row:
            cmap = _col_map(ws, header_row)
            for row in range(header_row + 1, ws.max_row + 1):
                code = _get(ws, row, cmap, "course code", "code")
                if not code:
                    continue
                name = _get(ws, row, cmap, "course name", "name")
                dept = _get(ws, row, cmap, "department", "dept")
                grade = _parse_grade(_get(ws, row, cmap, "grade"))
                gender_str = _get(ws, row, cmap, "gender", "restriction")
                gender = _parse_gender(gender_str) if gender_str else None
                min_sec = _int(_get(ws, row, cmap, "min section", "sections"), 1)
                cap = _int(_get(ws, row, cmap, "capacity", "cap"), 24)
                flag_str = _get(ws, row, cmap, "honor", "ap", "flag")
                flag = _parse_course_flag(flag_str) if flag_str else CourseFlag.REGULAR

                data.courses[code] = Course(
                    code=code, name=name, department=dept, grade_level=grade,
                    gender_restriction=gender, min_sections=min_sec,
                    standard_capacity=cap, flag=flag,
                )

    _compute_enrollment_counts(data)
    return data


def _compute_enrollment_counts(data: ScheduleData):
    for course in data.courses.values():
        course.enrollment_count = 0
    for student in data.students.values():
        for req in student.course_requests:
            if req in data.courses:
                data.courses[req].enrollment_count += 1
