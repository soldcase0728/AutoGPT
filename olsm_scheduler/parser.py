"""Parse OLSM input Excel files into data models."""

from __future__ import annotations

import openpyxl
from pathlib import Path
from typing import Optional

from .models import (
    Course, CourseFlag, Constraint, Gender, GradeLevel,
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
    val = val.strip().upper()
    if val in ("G", "GIRLS", "GIRL", "F"):
        return Gender.GIRLS
    if val in ("B", "BOYS", "BOY", "M"):
        return Gender.BOYS
    return None


def _parse_grade(val) -> int:
    s = _str(val).lower().replace("th", "").replace("grade", "").strip()
    try:
        return int(s)
    except ValueError:
        for num in ("9", "10", "11", "12"):
            if num in s:
                return int(num)
        return 0


def _parse_course_flag(val: str) -> CourseFlag:
    val = val.strip().lower()
    if "ap" in val:
        return CourseFlag.AP
    if "honor" in val:
        return CourseFlag.HONORS
    if "college" in val:
        return CourseFlag.COLLEGE
    if "rotation" in val:
        return CourseFlag.ROTATION
    return CourseFlag.REGULAR


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


def parse_students(ws) -> dict[str, Student]:
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
        gender_str = _get(ws, row, cmap, "gender", "sex")
        gender = _parse_gender(gender_str)

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
            student_id=sid,
            last_name=last_name,
            first_name=first_name,
            grade=grade,
            gender=gender,
            course_requests=courses,
        )

    return students


def parse_courses(ws) -> dict[str, Course]:
    header_row = _find_header_row(ws, ["course code", "course name", "department"])
    if not header_row:
        raise ValueError("Cannot find header row in Course Catalog sheet")

    cmap = _col_map(ws, header_row)
    courses = {}

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
        flag = _parse_course_flag(flag_str)

        courses[code] = Course(
            code=code,
            name=name,
            department=dept,
            grade_level=grade,
            gender_restriction=gender,
            min_sections=min_sec,
            standard_capacity=cap,
            flag=flag,
        )

    return courses


def parse_teachers(ws) -> dict[str, Teacher]:
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
            name=name,
            department=dept,
            subject_specialties=specialties,
            certifications=certs,
            max_teaching_periods=max_tp,
            required_prep_periods=prep,
            special_constraints=constraints,
            notes=notes,
            is_rotation_teacher=is_rotation,
        )

    return teachers


def parse_rooms(ws) -> dict[str, Room]:
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
            number=number,
            room_type=rtype,
            capacity=cap,
            special_features=features,
            available_periods=avail,
            notes=notes,
        )

    return rooms


def parse_constraints(ws) -> list[Constraint]:
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
            constraint_type=ctype,
            subject_teacher=subject,
            detail=detail,
            approval_required_from=approval,
            status=status,
        ))

    return constraints


def load_input_file(filepath: str | Path) -> ScheduleData:
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"Input file not found: {filepath}")

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
        data.students = parse_students(wb[sheet_map["students"]])
    if "courses" in sheet_map:
        data.courses = parse_courses(wb[sheet_map["courses"]])
    if "teachers" in sheet_map:
        data.teachers = parse_teachers(wb[sheet_map["teachers"]])
    if "rooms" in sheet_map:
        data.rooms = parse_rooms(wb[sheet_map["rooms"]])
    if "constraints" in sheet_map:
        data.constraints = parse_constraints(wb[sheet_map["constraints"]])

    _compute_enrollment_counts(data)
    return data


def _compute_enrollment_counts(data: ScheduleData):
    for course in data.courses.values():
        course.enrollment_count = 0

    for student in data.students.values():
        for req in student.course_requests:
            if req in data.courses:
                data.courses[req].enrollment_count += 1
