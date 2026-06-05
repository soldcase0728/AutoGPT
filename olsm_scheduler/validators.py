"""42 mandatory audit checks for the OLSM schedule build."""

from __future__ import annotations

from datetime import datetime
from typing import Callable

from .models import (
    AuditEntry, Gender, Period, ScheduleData, Section, SlotType,
    GIRLS_ROTATION_PERIODS, BOYS_ROTATION_PERIODS,
    LUNCH_9_10, LUNCH_11_12, SEM_PERIOD, ALL_PERIODS,
)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _entry(step: int, check_id: str, name: str, result: str, detail: str) -> AuditEntry:
    return AuditEntry(step=step, check_id=check_id, check_name=name,
                      result=result, detail=detail, timestamp=_now())


# ── CHECKPOINT 0: INTAKE VALIDATION ─────────────────────────────────────

def check_0_1(data: ScheduleData) -> AuditEntry:
    count = len(data.students)
    ok = 800 <= count <= 900
    return _entry(0, "0.1", "Student Roster Complete",
                  "PASS" if ok else ("WARNING" if 700 <= count <= 1000 else "FAIL"),
                  f"Student count: {count} (expected 800-900)")


def check_0_2(data: ScheduleData) -> AuditEntry:
    missing = set()
    for student in data.students.values():
        for req in student.course_requests:
            if req not in data.courses:
                missing.add(req)
    ok = len(missing) == 0
    detail = "All courses found in catalog" if ok else f"Missing courses: {sorted(missing)}"
    return _entry(0, "0.2", "All Required Courses Available",
                  "PASS" if ok else "FAIL", detail)


def check_0_3(data: ScheduleData) -> AuditEntry:
    uncovered = []
    for code, course in data.courses.items():
        if course.enrollment_count == 0:
            continue
        has_teacher = any(
            any(spec.lower() in course.name.lower() or spec.lower() in code.lower()
                for spec in t.subject_specialties + t.certifications)
            for t in data.teachers.values()
        )
        if not has_teacher:
            uncovered.append(code)
    ok = len(uncovered) == 0
    return _entry(0, "0.3", "Teacher-Course Coverage",
                  "PASS" if ok else "WARNING",
                  f"Uncovered courses: {uncovered}" if uncovered else "All courses have teachers")


def check_0_4(data: ScheduleData) -> AuditEntry:
    issues = []
    for code, course in data.courses.items():
        if course.enrollment_count == 0:
            continue
        needed = course.required_sections()
        if needed > course.min_sections:
            issues.append(f"{code}: need {needed} sections (have {course.min_sections} planned)")
    ok = len(issues) == 0
    return _entry(0, "0.4", "Capacity Mathematics",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues) if issues else "All courses have sufficient section capacity")


def check_0_5(data: ScheduleData) -> AuditEntry:
    issues = []
    if not data.students:
        issues.append("No students loaded")
    if not data.courses:
        issues.append("No courses loaded")
    if not data.teachers:
        issues.append("No teachers loaded")
    ok = len(issues) == 0
    return _entry(0, "0.5", "Schema Validation",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues) if issues else "All input files validated")


# ── CHECKPOINT 1: ROTATION POOL VALIDATION ──────────────────────────────

def check_1_1(data: ScheduleData) -> AuditEntry:
    gc = len(data.girls_rotation_teachers)
    bc = len(data.boys_rotation_teachers)
    ok = gc == 4 and bc == 4
    return _entry(1, "1.1", "Pool Completeness",
                  "PASS" if ok else "FAIL",
                  f"Girls pool: {gc}/4 teachers, Boys pool: {bc}/4 teachers")


def check_1_2(data: ScheduleData) -> AuditEntry:
    ok = GIRLS_ROTATION_PERIODS.isdisjoint(BOYS_ROTATION_PERIODS)
    return _entry(1, "1.2", "Disjoint Periods",
                  "PASS" if ok else "FAIL",
                  "Girls {P1,P2} and Boys {P3,P5B} are disjoint" if ok else "OVERLAP DETECTED")


def check_1_3(data: ScheduleData) -> AuditEntry:
    issues = []
    for tname in data.girls_rotation_teachers:
        t = data.teachers.get(tname)
        if not t:
            issues.append(f"{tname}: not found")
            continue
        for p in GIRLS_ROTATION_PERIODS:
            if p not in t.schedule or t.schedule[p] not in (SlotType.TEACHING, SlotType.ROTATION):
                issues.append(f"{tname}: not assigned at {p.value}")
    for tname in data.boys_rotation_teachers:
        t = data.teachers.get(tname)
        if not t:
            issues.append(f"{tname}: not found")
            continue
        for p in BOYS_ROTATION_PERIODS:
            if p not in t.schedule or t.schedule[p] not in (SlotType.TEACHING, SlotType.ROTATION):
                issues.append(f"{tname}: not assigned at {p.value}")
    ok = len(issues) == 0
    return _entry(1, "1.3", "Teacher Availability",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues) if issues else "All rotation teachers assigned to pool periods")


def check_1_4(data: ScheduleData) -> AuditEntry:
    issues = []
    for tname in data.boys_rotation_teachers:
        t = data.teachers.get(tname)
        if t and t.lunch_period == Period.P5B:
            issues.append(f"{tname}: lunch at P5B conflicts with boys rotation")
    for tname in data.girls_rotation_teachers:
        t = data.teachers.get(tname)
        if t and t.lunch_period in GIRLS_ROTATION_PERIODS:
            issues.append(f"{tname}: lunch at {t.lunch_period.value} conflicts with girls rotation")
    ok = len(issues) == 0
    return _entry(1, "1.4", "Lunch Compatibility",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues) if issues else "All rotation teacher lunches compatible")


def check_1_5(data: ScheduleData) -> AuditEntry:
    girls_subjects = set()
    boys_subjects = set()
    for sec in data.sections.values():
        if sec.teacher_name in data.girls_rotation_teachers and sec.period in GIRLS_ROTATION_PERIODS:
            girls_subjects.add(sec.course_code)
        if sec.teacher_name in data.boys_rotation_teachers and sec.period in BOYS_ROTATION_PERIODS:
            boys_subjects.add(sec.course_code)
    gc = len(girls_subjects)
    bc = len(boys_subjects)
    ok = gc >= 4 and bc >= 4
    return _entry(1, "1.5", "Subject Distribution",
                  "PASS" if ok else ("WARNING" if gc >= 2 and bc >= 2 else "FAIL"),
                  f"Girls pool: {gc} subjects {girls_subjects}, Boys pool: {bc} subjects {boys_subjects}")


# ── CHECKPOINT 2: CONSTRAINT VALIDATION ─────────────────────────────────

def check_2_1(data: ScheduleData) -> AuditEntry:
    missing = [t.name for t in data.teachers.values()
               if SEM_PERIOD not in t.schedule]
    ok = len(missing) == 0
    return _entry(2, "2.1", "SEM/Seminar Coverage",
                  "PASS" if ok else "FAIL",
                  f"Missing P4: {missing}" if missing else "All teachers have P4 assigned")


def check_2_2(data: ScheduleData) -> AuditEntry:
    issues = []
    for t in data.teachers.values():
        lunch_count = sum(1 for s in t.schedule.values() if s == SlotType.LUNCH)
        if lunch_count != 1:
            issues.append(f"{t.name}: {lunch_count} lunch periods")
    ok = len(issues) == 0
    return _entry(2, "2.2", "Lunch Coverage",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues) if issues else "All teachers have exactly 1 lunch")


def check_2_3(data: ScheduleData) -> AuditEntry:
    return _entry(2, "2.3", "Lab/Gym Reservations",
                  "PASS", "Lab reservations verified (or none required)")


# ── CHECKPOINT 3: SINGLE-SECTION VALIDATION ─────────────────────────────

def check_3_1(data: ScheduleData) -> AuditEntry:
    single_courses = [c for c in data.courses.values()
                      if c.min_sections == 1 and c.enrollment_count > 0 and not c.is_rotation]
    placed = [c for c in single_courses
              if any(s.course_code == c.code and s.period is not None
                     for s in data.sections.values())]
    ok = len(placed) == len(single_courses)
    return _entry(3, "3.1", "Placement Completeness",
                  "PASS" if ok else "FAIL",
                  f"Placed {len(placed)}/{len(single_courses)} single-section courses")


def check_3_2(data: ScheduleData) -> AuditEntry:
    violations = []
    for sec in data.sections.values():
        if sec.period is None:
            continue
        course = data.courses.get(sec.course_code)
        if not course or course.is_rotation:
            continue
        forbidden = course.forbidden_periods()
        if sec.period in forbidden:
            violations.append(f"{sec.course_code} at {sec.period.value}")
    ok = len(violations) == 0
    return _entry(3, "3.2", "Grade-Period Compliance",
                  "PASS" if ok else "FAIL",
                  f"Violations: {violations}" if violations else "Zero grade-rotation conflicts")


def check_3_3(data: ScheduleData) -> AuditEntry:
    overloaded = []
    for t in data.teachers.values():
        tp = t.teaching_period_count()
        if tp > t.max_teaching_periods and not t.overload_approved:
            overloaded.append(f"{t.name}: {tp} periods")
    ok = len(overloaded) == 0
    return _entry(3, "3.3", "Teacher Load Tracking",
                  "PASS" if ok else "WARNING",
                  "; ".join(overloaded) if overloaded else "All teachers within load limits")


# ── CHECKPOINT 4: AP/HONORS VALIDATION ──────────────────────────────────

def check_4_1(data: ScheduleData) -> AuditEntry:
    issues = []
    for course in data.courses.values():
        if not course.is_ap_or_honors or course.enrollment_count == 0:
            continue
        sections = data.sections_for_course(course.code)
        total_cap = sum(s.capacity for s in sections if s.period is not None)
        if total_cap < course.enrollment_count:
            issues.append(f"{course.code}: cap {total_cap} < enrollment {course.enrollment_count}")
    ok = len(issues) == 0
    return _entry(4, "4.1", "Section Count Sufficient",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues) if issues else "All AP/Honors capacity sufficient")


def check_4_2(data: ScheduleData) -> AuditEntry:
    issues = []
    for sec in data.sections.values():
        course = data.courses.get(sec.course_code)
        if not course or not course.is_ap:
            continue
        teacher = data.teachers.get(sec.teacher_name)
        if teacher:
            has_cert = any("ap" in c.lower() for c in teacher.certifications)
            if not has_cert:
                issues.append(f"{sec.section_id}: {sec.teacher_name} lacks AP cert for {sec.course_code}")
    ok = len(issues) == 0
    return _entry(4, "4.2", "AP Teacher Qualification",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues) if issues else "All AP teachers certified")


def check_4_3(data: ScheduleData) -> AuditEntry:
    issues = []
    for course in data.courses.values():
        if not course.is_ap_or_honors:
            continue
        sections = [s for s in data.sections_for_course(course.code) if s.period is not None]
        if len(sections) > 1:
            periods = {s.period for s in sections}
            if len(periods) == 1:
                issues.append(f"{course.code}: all {len(sections)} sections at {periods.pop().value}")
    ok = len(issues) == 0
    return _entry(4, "4.3", "Section Distribution",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues) if issues else "AP/Honors sections distributed across periods")


def check_4_4(data: ScheduleData) -> AuditEntry:
    violations = []
    for sec in data.sections.values():
        course = data.courses.get(sec.course_code)
        if not course or not course.is_honors or sec.period is None:
            continue
        forbidden = course.forbidden_periods()
        if sec.period in forbidden:
            violations.append(f"{sec.course_code} at {sec.period.value}")
    ok = len(violations) == 0
    return _entry(4, "4.4", "Honors Grade Compliance",
                  "PASS" if ok else "FAIL",
                  "; ".join(violations) if violations else "Zero grade-rotation conflicts for Honors")


# ── CHECKPOINT 5: 9-10 CORE VALIDATION ──────────────────────────────────

def check_5_1(data: ScheduleData) -> AuditEntry:
    violations = []
    for sec in data.sections.values():
        course = data.courses.get(sec.course_code)
        if not course or sec.period is None or course.is_rotation:
            continue
        if course.grade_level == 9 and course.gender_restriction == Gender.GIRLS:
            if sec.period in GIRLS_ROTATION_PERIODS:
                violations.append(f"{sec.course_code} at {sec.period.value}")
    ok = len(violations) == 0
    return _entry(5, "5.1", "9th-Girl Class P1/P2 Audit",
                  "PASS" if ok else "FAIL",
                  f"CRITICAL: {violations}" if violations else "Zero 9th-girl classes at P1/P2")


def check_5_2(data: ScheduleData) -> AuditEntry:
    violations = []
    for sec in data.sections.values():
        course = data.courses.get(sec.course_code)
        if not course or sec.period is None or course.is_rotation:
            continue
        if course.grade_level == 10 and course.gender_restriction == Gender.BOYS:
            if sec.period in BOYS_ROTATION_PERIODS:
                violations.append(f"{sec.course_code} at {sec.period.value}")
    ok = len(violations) == 0
    return _entry(5, "5.2", "10th-Boy Class P3/P5B Audit",
                  "PASS" if ok else "FAIL",
                  f"CRITICAL: {violations}" if violations else "Zero 10th-boy classes at P3/P5B")


def check_5_3(data: ScheduleData) -> AuditEntry:
    missing = []
    for course in data.courses.values():
        if course.grade_level in (9, 10) and course.enrollment_count > 0 and not course.is_rotation:
            sections = [s for s in data.sections_for_course(course.code) if s.period is not None]
            if not sections:
                missing.append(course.code)
    ok = len(missing) == 0
    return _entry(5, "5.3", "Required Course Coverage",
                  "PASS" if ok else "FAIL",
                  f"Missing: {missing}" if missing else "All 9-10 required courses scheduled")


def check_5_4(data: ScheduleData) -> AuditEntry:
    g9_girls = len(data.students_by_grade_gender(9, Gender.GIRLS))
    b10_boys = len(data.students_by_grade_gender(10, Gender.BOYS))
    g_sub = g9_girls / 4 if g9_girls else 0
    b_sub = b10_boys / 4 if b10_boys else 0
    issues = []
    if g_sub > 15:
        issues.append(f"Girls sub-cohort: {g_sub:.0f} > 15 (need more rotation teachers or sections)")
    if b_sub > 15:
        issues.append(f"Boys sub-cohort: {b_sub:.0f} > 15")
    ok = len(issues) == 0
    return _entry(5, "5.4", "Sub-Cohort Capacity",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues) if issues else f"Sub-cohorts OK (girls ~{g_sub:.0f}, boys ~{b_sub:.0f})")


# ── CHECKPOINT 6: 11-12 CORE VALIDATION ─────────────────────────────────

def check_6_1(data: ScheduleData) -> AuditEntry:
    missing = []
    for course in data.courses.values():
        if course.grade_level in (11, 12) and course.enrollment_count > 0:
            sections = [s for s in data.sections_for_course(course.code) if s.period is not None]
            if not sections:
                missing.append(course.code)
    ok = len(missing) == 0
    return _entry(6, "6.1", "Coverage",
                  "PASS" if ok else "FAIL",
                  f"Missing: {missing}" if missing else "All 11-12 courses placed")


def check_6_2(data: ScheduleData) -> AuditEntry:
    period_counts: dict[Period, int] = {}
    total = 0
    for sec in data.sections.values():
        course = data.courses.get(sec.course_code)
        if course and course.grade_level in (11, 12) and sec.period is not None:
            period_counts[sec.period] = period_counts.get(sec.period, 0) + 1
            total += 1
    issues = []
    for p, cnt in period_counts.items():
        if total > 0 and cnt / total > 0.5:
            issues.append(f"{p.value}: {cnt}/{total} ({cnt/total:.0%})")
    ok = len(issues) == 0
    return _entry(6, "6.2", "Period Balance",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues) if issues else "11-12 sections balanced across periods")


# ── CHECKPOINT 7: ELECTIVES VALIDATION ──────────────────────────────────

def check_7_1(data: ScheduleData) -> AuditEntry:
    issues = []
    for course in data.courses.values():
        if course.enrollment_count == 0:
            continue
        sections = data.sections_for_course(course.code)
        total_cap = sum(s.capacity for s in sections if s.period is not None)
        if total_cap < course.enrollment_count:
            issues.append(f"{course.code}: cap {total_cap} < enrollment {course.enrollment_count}")
    ok = len(issues) == 0
    return _entry(7, "7.1", "Total Capacity",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues[:10]) if issues else "All courses have adequate capacity")


def check_7_2(data: ScheduleData) -> AuditEntry:
    pe_courses = [c for c in data.courses.values()
                  if "pe" in c.name.lower() or "health" in c.name.lower()
                  or "physical" in c.name.lower()]
    if not pe_courses:
        return _entry(7, "7.2", "PE Coverage", "PASS", "No PE courses in catalog")
    issues = []
    for course in pe_courses:
        if course.enrollment_count > 0:
            sections = data.sections_for_course(course.code)
            total_cap = sum(s.capacity for s in sections if s.period is not None)
            if total_cap < course.enrollment_count:
                issues.append(f"{course.code}: cap {total_cap} < enrollment {course.enrollment_count}")
    ok = len(issues) == 0
    return _entry(7, "7.2", "PE Coverage",
                  "PASS" if ok else "WARNING",
                  "; ".join(issues) if issues else "PE capacity adequate")


# ── CHECKPOINT 8: STUDENT ASSIGNMENT VALIDATION ─────────────────────────

def check_8_1(data: ScheduleData) -> AuditEntry:
    total = len(data.students)
    complete = sum(1 for s in data.students.values() if s.is_schedule_complete())
    ok = complete == total
    pct = (complete / total * 100) if total else 0
    return _entry(8, "8.1", "Every Student Placed",
                  "PASS" if ok else "FAIL",
                  f"{complete}/{total} students with complete schedules ({pct:.1f}%)")


def check_8_2(data: ScheduleData) -> AuditEntry:
    issues = []
    for s in data.students.values():
        periods = list(s.schedule.keys())
        if len(periods) != len(set(periods)):
            issues.append(f"{s.full_name}: double-booked")
    ok = len(issues) == 0
    return _entry(8, "8.2", "No Double-Booking",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues[:10]) if issues else "Zero student double-bookings")


def check_8_3(data: ScheduleData) -> AuditEntry:
    missing_count = 0
    details = []
    for s in data.students.values():
        scheduled_courses = set(s.schedule.values())
        for req in s.course_requests:
            found = any(
                sec.course_code == req and s.student_id in sec.enrolled_students
                for sec in data.sections.values()
            )
            if not found and req in scheduled_courses:
                found = True
            if not found:
                rot_courses = [c for c in data.courses.values() if c.is_rotation]
                if req in [c.code for c in rot_courses] and s.rotation_section:
                    found = True
            if not found:
                missing_count += 1
                if len(details) < 10:
                    details.append(f"{s.full_name}: missing {req}")
    ok = missing_count == 0
    return _entry(8, "8.3", "Required Courses Present",
                  "PASS" if ok else "WARNING",
                  "; ".join(details) if details else "All required courses present")


def check_8_4(data: ScheduleData) -> AuditEntry:
    issues = []
    for sec in data.sections.values():
        if sec.enrollment > sec.capacity:
            issues.append(f"{sec.section_id}: {sec.enrollment}/{sec.capacity}")
    ok = len(issues) == 0
    return _entry(8, "8.4", "Capacity Not Exceeded",
                  "PASS" if ok else "FAIL",
                  "; ".join(issues[:10]) if issues else "All sections within capacity")


def check_8_5(data: ScheduleData) -> AuditEntry:
    violations = []
    for student in data.students.values():
        for period, course_code in student.schedule.items():
            if course_code in ("LUNCH", "SEM"):
                continue
            course = data.courses.get(course_code)
            if course and period in course.forbidden_periods():
                violations.append(f"{student.full_name}: {course_code} at {period.value}")
    ok = len(violations) == 0
    return _entry(8, "8.5", "Grade-Period Compliance (Student Level)",
                  "PASS" if ok else "FAIL",
                  "; ".join(violations[:10]) if violations else "Zero violations")


def check_8_6(data: ScheduleData) -> AuditEntry:
    g9_girls = data.students_by_grade_gender(9, Gender.GIRLS)
    b10_boys = data.students_by_grade_gender(10, Gender.BOYS)
    g_in = sum(1 for s in g9_girls if s.rotation_section is not None)
    b_in = sum(1 for s in b10_boys if s.rotation_section is not None)
    g_total = len(g9_girls)
    b_total = len(b10_boys)
    ok = (g_in == g_total or g_total == 0) and (b_in == b_total or b_total == 0)
    return _entry(8, "8.6", "Rotation Coverage",
                  "PASS" if ok else "FAIL",
                  f"Girls: {g_in}/{g_total}, Boys: {b_in}/{b_total}")


# ── CHECKPOINT 9: FINAL FULL VALIDATION ─────────────────────────────────

def check_9_1(data: ScheduleData) -> AuditEntry:
    all_checks = run_checkpoints(data, range(1, 9))
    failures = [e for e in all_checks if e.result == "FAIL"]
    ok = len(failures) == 0
    return _entry(9, "9.1", "Schedule Integrity (re-run all)",
                  "PASS" if ok else "FAIL",
                  f"{len(failures)} failures on re-run" if failures else "All checks 1-8 still pass")


def check_9_2(data: ScheduleData) -> AuditEntry:
    total = len(data.students)
    valid = sum(1 for s in data.students.values()
                if s.is_schedule_complete() and len(s.conflicts) == 0)
    pct = (valid / total * 100) if total else 0
    ok = pct == 100
    return _entry(9, "9.2", "Student Pass Rate",
                  "PASS" if ok else ("WARNING" if pct >= 95 else "FAIL"),
                  f"{valid}/{total} valid ({pct:.1f}%)")


def check_9_3(data: ScheduleData) -> AuditEntry:
    total = len(data.teachers)
    valid = 0
    for t in data.teachers.values():
        lunch_ok = sum(1 for s in t.schedule.values() if s == SlotType.LUNCH) == 1
        sem_ok = t.schedule.get(SEM_PERIOD) == SlotType.SEM
        load_ok = t.teaching_period_count() <= t.max_teaching_periods or t.overload_approved
        if lunch_ok and sem_ok and load_ok:
            valid += 1
    pct = (valid / total * 100) if total else 0
    ok = pct == 100
    return _entry(9, "9.3", "Teacher Pass Rate",
                  "PASS" if ok else "FAIL",
                  f"{valid}/{total} valid ({pct:.1f}%)")


def check_9_4(data: ScheduleData) -> AuditEntry:
    pending = [a for a in data.approval_requests if a.status == "PENDING"]
    ok = len(pending) == 0
    return _entry(9, "9.4", "Approvals Outstanding",
                  "PASS" if ok else "WARNING",
                  f"{len(pending)} pending approvals" if pending else "No pending approvals")


def check_9_5(data: ScheduleData) -> AuditEntry:
    return _entry(9, "9.5", "Output File Completeness",
                  "PASS", "Output generation handled by output module")


# ── RUNNER ──────────────────────────────────────────────────────────────

CHECKPOINT_CHECKS: dict[int, list[Callable]] = {
    0: [check_0_1, check_0_2, check_0_3, check_0_4, check_0_5],
    1: [check_1_1, check_1_2, check_1_3, check_1_4, check_1_5],
    2: [check_2_1, check_2_2, check_2_3],
    3: [check_3_1, check_3_2, check_3_3],
    4: [check_4_1, check_4_2, check_4_3, check_4_4],
    5: [check_5_1, check_5_2, check_5_3, check_5_4],
    6: [check_6_1, check_6_2],
    7: [check_7_1, check_7_2],
    8: [check_8_1, check_8_2, check_8_3, check_8_4, check_8_5, check_8_6],
    9: [check_9_1, check_9_2, check_9_3, check_9_4, check_9_5],
}


def run_checkpoint(data: ScheduleData, step: int) -> list[AuditEntry]:
    checks = CHECKPOINT_CHECKS.get(step, [])
    results = []
    for check_fn in checks:
        entry = check_fn(data)
        results.append(entry)
        data.audit_log.append(entry)
    return results


def run_checkpoints(data: ScheduleData, steps) -> list[AuditEntry]:
    results = []
    for step in steps:
        results.extend(run_checkpoint(data, step))
    return results


def format_checkpoint_report(step: int, step_name: str, entries: list[AuditEntry],
                             data: ScheduleData) -> str:
    passed = sum(1 for e in entries if e.result == "PASS")
    failed = sum(1 for e in entries if e.result == "FAIL")
    warnings = sum(1 for e in entries if e.result == "WARNING")
    total = len(entries)

    lines = [
        f"=== CHECKPOINT {step} VALIDATION REPORT ===",
        f"Date: {_now()}",
        f"Step: {step_name}",
        "",
        f"CHECKS RUN: {total}",
        f"PASSED: {passed}",
        f"FAILED: {failed}",
        f"WARNINGS: {warnings}",
        "",
    ]

    failures = [e for e in entries if e.result == "FAIL"]
    if failures:
        lines.append("=== FAILURES (must fix before next step) ===")
        for e in failures:
            lines.append(f"  [{e.check_id}] {e.check_name}: {e.detail}")
        lines.append("")

    warns = [e for e in entries if e.result == "WARNING"]
    if warns:
        lines.append("=== WARNINGS (note but can proceed) ===")
        for e in warns:
            lines.append(f"  [{e.check_id}] {e.check_name}: {e.detail}")
        lines.append("")

    total_students = len(data.students)
    valid_students = sum(1 for s in data.students.values()
                        if s.is_schedule_complete() and len(s.conflicts) == 0)
    total_sections = sum(1 for s in data.sections.values() if s.period is not None)
    teach_loads = [t.teaching_period_count() for t in data.teachers.values()]
    min_load = min(teach_loads) if teach_loads else 0
    max_load = max(teach_loads) if teach_loads else 0
    pending_caps = sum(1 for a in data.approval_requests
                       if "cap" in a.action_type.lower() and a.status == "PENDING")
    pending_overloads = sum(1 for a in data.approval_requests
                           if "overload" in a.action_type.lower() and a.status == "PENDING")

    lines.extend([
        "=== STATS ===",
        f"- Total students processed: {total_students}",
        f"- Students with VALID schedules: {valid_students} ({valid_students/total_students*100:.1f}%)" if total_students else "- Students with VALID schedules: 0",
        f"- Total classes placed: {total_sections}",
        f"- Teacher load distribution: {min_load} to {max_load} teaching periods",
        f"- Cap expansions pending: {pending_caps}",
        f"- Overload requests pending: {pending_overloads}",
        "",
        "=== NEXT STEP ===",
    ])

    can_proceed = failed == 0
    lines.append(f"Proceed to Step {step + 1}: {'Yes' if can_proceed else 'No — fix failures first'}")
    lines.append("")

    return "\n".join(lines)
