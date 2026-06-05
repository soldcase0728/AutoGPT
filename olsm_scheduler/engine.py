"""9-step OLSM schedule build engine — inside-out construction."""

from __future__ import annotations

import math
import random
from collections import defaultdict
from datetime import datetime
from typing import Optional

from .models import (
    ALL_PERIODS, ApprovalRequest, Course, CourseFlag, Gender,
    GIRLS_ROTATION_PERIODS, BOYS_ROTATION_PERIODS,
    LUNCH_9_10, LUNCH_11_12, Period, ScheduleData, Section,
    SEM_PERIOD, SlotType, Student, TEACHING_PERIODS, Teacher,
)
from .validators import run_checkpoint, format_checkpoint_report


class BuildEngine:
    def __init__(self, data: ScheduleData):
        self.data = data
        self.reports: list[str] = []
        self._section_counter = 0

    def _next_section_id(self, course_code: str, label: str = "") -> str:
        self._section_counter += 1
        suffix = f"-{label}" if label else ""
        return f"{course_code}{suffix}-S{self._section_counter}"

    def _find_teacher_for_course(self, course: Course,
                                 exclude: set[str] | None = None) -> Optional[Teacher]:
        exclude = exclude or set()
        candidates = []

        tcm = getattr(self.data, "_teacher_course_map", {})
        course_name_map = getattr(self.data, "_student_to_roster_course", {})
        roster_name = course_name_map.get(course.code, course.code)
        exact_teachers = tcm.get(roster_name, [])

        for tname in exact_teachers:
            if tname in exclude or tname not in self.data.teachers:
                continue
            t = self.data.teachers[tname]
            load = t.teaching_period_count()
            has_capacity = load < t.max_teaching_periods or t.overload_approved
            if has_capacity:
                return t

        course_lower = course.code.lower()
        course_name_lower = course.name.lower()
        stripped = course_lower.replace("g ", "").replace(" b", "").replace("hon ", "").replace("ap ", "").strip()
        course_keywords = {w for w in stripped.split() if len(w) > 2}
        course_keywords |= {w for w in course_name_lower.split() if len(w) > 2}

        for t in self.data.teachers.values():
            if t.name in exclude:
                continue
            if t.is_rotation_teacher and not course.is_rotation:
                if t.teaching_period_count() >= t.max_teaching_periods:
                    continue

            spec_text = " ".join(t.subject_specialties).lower()
            cert_text = " ".join(t.certifications).lower()
            dept_lower = t.department.lower().split("/")[0].strip()

            spec_match = any(
                kw in spec_text for kw in course_keywords
            ) if course_keywords else False

            dept_match = False
            course_dept = course.department.lower().split("/")[0].strip()
            if course_dept and dept_lower:
                dept_match = course_dept == dept_lower or course_dept in dept_lower or dept_lower in course_dept

            cert_match = False
            if course.is_ap:
                cert_match = any("ap" in c.lower() for c in t.certifications)
            if course.is_honors:
                cert_match = any("honor" in c.lower() for c in t.certifications) or dept_match

            if spec_match or dept_match or cert_match:
                avail = len(t.available_periods())
                load = t.teaching_period_count()
                has_capacity = load < t.max_teaching_periods or t.overload_approved
                priority = 10 if spec_match else (5 if cert_match else 1)
                score = priority * 100 + avail * 10 - load + (1000 if has_capacity else 0)
                candidates.append((score, t))

        candidates.sort(key=lambda x: -x[0])
        for _, t in candidates:
            if t.teaching_period_count() < t.max_teaching_periods or t.overload_approved:
                return t
        return candidates[0][1] if candidates else None

    def _find_best_period(self, teacher: Teacher, course: Course,
                          preferred: list[Period] | None = None) -> Optional[Period]:
        valid = course.valid_periods()
        available = set(teacher.available_periods())
        candidates = valid & available
        candidates.discard(SEM_PERIOD)

        if not candidates:
            return None

        if preferred:
            for p in preferred:
                if p in candidates:
                    return p

        period_load = defaultdict(int)
        for sec in self.data.sections.values():
            if sec.period:
                period_load[sec.period] += 1

        best = min(candidates, key=lambda p: period_load.get(p, 0))
        return best

    def _place_section(self, course: Course, teacher: Teacher,
                       period: Period, label: str = "",
                       capacity: int | None = None) -> Section:
        cap = capacity or course.standard_capacity
        sec_id = self._next_section_id(course.code, label)
        section = Section(
            section_id=sec_id,
            course_code=course.code,
            section_label=label,
            teacher_name=teacher.name,
            period=period,
            capacity=cap,
            original_capacity=course.standard_capacity,
        )
        if cap > course.standard_capacity:
            section.capacity_expanded = True

        self.data.sections[sec_id] = section
        teacher.schedule[period] = SlotType.TEACHING
        teacher.assigned_classes[period] = course.code
        return section

    def run_full_build(self) -> list[str]:
        steps = [
            (0, "Intake & Validation", self.step_0_intake),
            (1, "Lock Rotation Pools", self.step_1_rotation),
            (2, "Lock Lunches, SEM, Labs", self.step_2_constraints),
            (3, "Place Single-Section Classes", self.step_3_single_section),
            (4, "Place AP & Honors Classes", self.step_4_ap_honors),
            (5, "Place 9-10 Grade Core", self.step_5_core_910),
            (6, "Place 11-12 Grade Core", self.step_6_core_1112),
            (7, "Place Multi-Section Electives", self.step_7_electives),
            (8, "Assign Students to Sections", self.step_8_student_assignment),
            (9, "Full Validation", self.step_9_validation),
        ]

        for step_num, step_name, step_fn in steps:
            print(f"\n{'='*60}")
            print(f"STEP {step_num}: {step_name}")
            print(f"{'='*60}")

            step_fn()

            entries = run_checkpoint(self.data, step_num)
            report = format_checkpoint_report(step_num, step_name, entries, self.data)
            self.reports.append(report)
            print(report)

            failures = [e for e in entries if e.result == "FAIL"]
            self.data.step_completed[step_num] = len(failures) == 0

            if failures and step_num < 9:
                print(f"WARNING: Step {step_num} has {len(failures)} failures. Continuing build...")

        return self.reports

    # ── STEP 0: INTAKE ──────────────────────────────────────────────────

    def step_0_intake(self):
        print(f"  Students loaded: {len(self.data.students)}")
        print(f"  Courses loaded: {len(self.data.courses)}")
        print(f"  Teachers loaded: {len(self.data.teachers)}")
        print(f"  Rooms loaded: {len(self.data.rooms)}")
        print(f"  Constraints loaded: {len(self.data.constraints)}")

        by_grade_gender = defaultdict(int)
        for s in self.data.students.values():
            by_grade_gender[(s.grade, s.gender.value)] += 1
        for (grade, gender), count in sorted(by_grade_gender.items()):
            print(f"    Grade {grade} {gender}: {count}")

        for constraint in self.data.constraints:
            if constraint.constraint_type.lower() == "teacher overload" and "approved" in constraint.status.lower():
                for tname in self.data.teachers:
                    if any(part in tname.lower() for part in constraint.subject_teacher.lower().split(",")):
                        self.data.teachers[tname].overload_approved = True
                        self.data.teachers[tname].max_teaching_periods = 7
                        print(f"  Overload approved: {tname}")

            if "capacity expansion" in constraint.constraint_type.lower() and "approved" in constraint.status.lower():
                self.data.approval_requests.append(ApprovalRequest(
                    action_type="Capacity Expansion",
                    subject=constraint.subject_teacher,
                    detail=constraint.detail,
                    approval_authority=constraint.approval_required_from,
                    status="APPROVED",
                ))

    # ── STEP 1: ROTATION POOLS ──────────────────────────────────────────

    def step_1_rotation(self):
        girls_rot_code = None
        boys_rot_code = None
        for code, course in self.data.courses.items():
            if course.is_rotation:
                if course.gender_restriction == Gender.GIRLS:
                    girls_rot_code = code
                else:
                    boys_rot_code = code

        if not girls_rot_code and not boys_rot_code:
            for code in self.data.courses:
                lower = code.lower()
                if "grammar" in lower and "genre" in lower:
                    if code.startswith("G "):
                        girls_rot_code = code
                    else:
                        boys_rot_code = code

        if girls_rot_code:
            self.data.courses[girls_rot_code].flag = CourseFlag.ROTATION
        if boys_rot_code:
            self.data.courses[boys_rot_code].flag = CourseFlag.ROTATION

        print(f"  Girls rotation course: {girls_rot_code}")
        print(f"  Boys rotation course: {boys_rot_code}")

        girls_pool: list[Teacher] = []
        boys_pool: list[Teacher] = []

        if self.data.girls_rotation_teachers:
            for tname in self.data.girls_rotation_teachers:
                if tname in self.data.teachers:
                    girls_pool.append(self.data.teachers[tname])
        if self.data.boys_rotation_teachers:
            for tname in self.data.boys_rotation_teachers:
                if tname in self.data.teachers:
                    boys_pool.append(self.data.teachers[tname])

        if not girls_pool or not boys_pool:
            rotation_teachers = [t for t in self.data.teachers.values() if t.is_rotation_teacher]
            for t in rotation_teachers:
                pools = [p.lower() for p in t.rotation_pools]
                if "girls" in pools or not pools:
                    if t not in girls_pool:
                        girls_pool.append(t)
                if "boys" in pools or not pools:
                    if t not in boys_pool:
                        boys_pool.append(t)

        if girls_rot_code:
            g_course = self.data.courses[girls_rot_code]
            needed = g_course.required_sections()
            teachers_needed = max(needed, len(girls_pool), 1)

            if not girls_pool:
                for t in self.data.teachers.values():
                    if t.department.lower() in ("english", "language arts"):
                        girls_pool.append(t)
                        if len(girls_pool) >= teachers_needed:
                            break

            self.data.girls_rotation_teachers = [t.name for t in girls_pool[:teachers_needed]]

            for t in girls_pool[:teachers_needed]:
                for p in [Period.P1, Period.P2]:
                    if p not in t.schedule:
                        t.schedule[p] = SlotType.ROTATION
                        t.assigned_classes[p] = girls_rot_code
                print(f"  Girls rotation: {t.name} → P1+P2")

            for label, period in [("A", Period.P1), ("B", Period.P2)]:
                for i, tname in enumerate(self.data.girls_rotation_teachers):
                    sec_id = self._next_section_id(girls_rot_code, f"{label}-T{i+1}")
                    self.data.sections[sec_id] = Section(
                        section_id=sec_id, course_code=girls_rot_code,
                        section_label=label, teacher_name=tname,
                        period=period, capacity=g_course.standard_capacity,
                    )

        if boys_rot_code:
            b_course = self.data.courses[boys_rot_code]
            needed = b_course.required_sections()
            teachers_needed = max(needed, len(boys_pool), 1)

            if not boys_pool:
                for t in self.data.teachers.values():
                    if t.department.lower() in ("english", "language arts"):
                        boys_pool.append(t)
                        if len(boys_pool) >= teachers_needed:
                            break

            self.data.boys_rotation_teachers = [t.name for t in boys_pool[:teachers_needed]]

            for t in boys_pool[:teachers_needed]:
                for p in [Period.P3, Period.P5B]:
                    if p not in t.schedule:
                        t.schedule[p] = SlotType.ROTATION
                        t.assigned_classes[p] = boys_rot_code
                if t.lunch_period == Period.P5B:
                    t.schedule[Period.P5A] = SlotType.LUNCH
                    t.lunch_period = Period.P5A
                    print(f"  Lunch shift: {t.name} P5B → P5A")
                print(f"  Boys rotation: {t.name} → P3+P5B")

            for label, period in [("A", Period.P3), ("B", Period.P5B)]:
                for i, tname in enumerate(self.data.boys_rotation_teachers):
                    sec_id = self._next_section_id(boys_rot_code, f"{label}-T{i+1}")
                    self.data.sections[sec_id] = Section(
                        section_id=sec_id, course_code=boys_rot_code,
                        section_label=label, teacher_name=tname,
                        period=period, capacity=b_course.standard_capacity,
                    )

    # ── STEP 2: CONSTRAINTS ─────────────────────────────────────────────

    def step_2_constraints(self):
        for t in self.data.teachers.values():
            if SEM_PERIOD not in t.schedule:
                t.schedule[SEM_PERIOD] = SlotType.SEM
                t.assigned_classes[SEM_PERIOD] = "Seminar"

        seminar_courses = [c for c in self.data.courses.values()
                          if "seminar" in c.code.lower()]
        for sem_course in seminar_courses:
            needed = sem_course.required_sections()
            used_teachers: set[str] = set()
            for i in range(needed):
                teacher = self._find_teacher_for_course(sem_course, exclude=used_teachers)
                if not teacher:
                    for t in self.data.teachers.values():
                        if t.name not in used_teachers and SEM_PERIOD in t.schedule:
                            teacher = t
                            break
                if teacher:
                    sec_id = self._next_section_id(sem_course.code, str(i + 1))
                    self.data.sections[sec_id] = Section(
                        section_id=sec_id, course_code=sem_course.code,
                        section_label=str(i + 1), teacher_name=teacher.name,
                        period=SEM_PERIOD, capacity=sem_course.standard_capacity,
                    )
                    used_teachers.add(teacher.name)
            print(f"  Seminar: {sem_course.code} — {needed} sections at P4")

        for t in self.data.teachers.values():
            has_lunch = any(s == SlotType.LUNCH for s in t.schedule.values())
            if has_lunch:
                continue

            if t.lunch_period and t.lunch_period not in t.schedule:
                t.schedule[t.lunch_period] = SlotType.LUNCH
                t.assigned_classes[t.lunch_period] = "LUNCH"
                continue

            if t.lunch_period:
                continue

            if t.name in self.data.boys_rotation_teachers:
                lunch_p = Period.P5A
            elif t.department.lower() in ("test prep", "test prep/rotation"):
                lunch_p = Period.P5A
            else:
                lunch_p = Period.P5A if Period.P5A not in t.schedule else Period.P5B

            if lunch_p not in t.schedule:
                t.schedule[lunch_p] = SlotType.LUNCH
                t.lunch_period = lunch_p
                t.assigned_classes[lunch_p] = "LUNCH"
            else:
                for alt in [Period.P5B, Period.P5A]:
                    if alt not in t.schedule:
                        t.schedule[alt] = SlotType.LUNCH
                        t.lunch_period = alt
                        t.assigned_classes[alt] = "LUNCH"
                        break

        placed = 0
        for t in self.data.teachers.values():
            placed += 1
        print(f"  SEM locked for all {placed} teachers at P4")
        lunches = sum(1 for t in self.data.teachers.values() if t.lunch_period)
        print(f"  Lunch assigned: {lunches}/{len(self.data.teachers)} teachers")

    # ── STEP 3: SINGLE-SECTION ──────────────────────────────────────────

    def step_3_single_section(self):
        single_courses = [c for c in self.data.courses.values()
                          if c.min_sections == 1 and c.enrollment_count > 0
                          and not c.is_rotation and "seminar" not in c.code.lower()]
        single_courses.sort(key=lambda c: len(c.valid_periods()))

        placed = 0
        for course in single_courses:
            existing = self.data.sections_for_course(course.code)
            if any(s.period is not None for s in existing):
                placed += 1
                continue

            teacher = self._find_teacher_for_course(course)
            if not teacher:
                print(f"  WARNING: No teacher found for {course.code}")
                continue

            period = self._find_best_period(teacher, course)
            if not period:
                print(f"  WARNING: No valid period for {course.code} with {teacher.name}")
                continue

            self._place_section(course, teacher, period, "1")
            placed += 1
            print(f"  Placed: {course.code} → {teacher.name} @ {period.value}")

        print(f"  Total single-section placed: {placed}/{len(single_courses)}")

    # ── STEP 4: AP & HONORS ─────────────────────────────────────────────

    def step_4_ap_honors(self):
        ap_courses = [c for c in self.data.courses.values()
                      if c.is_ap_or_honors and c.enrollment_count > 0
                      and not c.is_rotation]
        ap_courses.sort(key=lambda c: (-c.enrollment_count, len(c.valid_periods())))

        placed = 0
        for course in ap_courses:
            existing = [s for s in self.data.sections_for_course(course.code) if s.period is not None]
            needed = course.required_sections() - len(existing)
            if needed <= 0:
                placed += len(existing)
                continue

            used_teachers: set[str] = set()
            for _ in range(needed):
                teacher = self._find_teacher_for_course(course, exclude=used_teachers)
                if not teacher:
                    teacher = self._find_teacher_for_course(course)
                if not teacher:
                    print(f"  WARNING: No teacher for {course.code}")
                    break

                period = self._find_best_period(teacher, course)
                if not period:
                    print(f"  WARNING: No period for {course.code} with {teacher.name}")
                    break

                sec_num = len(existing) + 1
                self._place_section(course, teacher, period, str(sec_num))
                used_teachers.add(teacher.name)
                existing.append(self.data.sections_for_course(course.code)[-1])
                placed += 1
                print(f"  Placed: {course.code} sec {sec_num} → {teacher.name} @ {period.value}")

        print(f"  Total AP/Honors sections placed: {placed}")

    # ── STEP 5: 9-10 CORE ──────────────────────────────────────────────

    def step_5_core_910(self):
        core_courses = [c for c in self.data.courses.values()
                        if c.grade_level in (9, 10) and c.enrollment_count > 0
                        and not c.is_rotation]
        core_courses.sort(key=lambda c: (-c.enrollment_count, len(c.valid_periods())))

        placed = 0
        for course in core_courses:
            existing = [s for s in self.data.sections_for_course(course.code) if s.period is not None]
            needed = course.required_sections() - len(existing)
            if needed <= 0:
                placed += len(existing)
                continue

            used_teachers: set[str] = {s.teacher_name for s in existing}
            for i in range(needed):
                teacher = self._find_teacher_for_course(course, exclude=used_teachers)
                if not teacher:
                    teacher = self._find_teacher_for_course(course)
                if not teacher:
                    print(f"  WARNING: No teacher for {course.code}")
                    break

                period = self._find_best_period(teacher, course)
                if not period:
                    print(f"  WARNING: No period for {course.code} with {teacher.name}")
                    break

                sec_num = len(existing) + i + 1
                self._place_section(course, teacher, period, str(sec_num))
                used_teachers.add(teacher.name)
                placed += 1

        print(f"  Total 9-10 core sections placed: {placed}")

    # ── STEP 6: 11-12 CORE ─────────────────────────────────────────────

    def step_6_core_1112(self):
        core_courses = [c for c in self.data.courses.values()
                        if c.grade_level in (11, 12) and c.enrollment_count > 0
                        and not c.is_rotation]
        core_courses.sort(key=lambda c: (-c.enrollment_count, len(c.valid_periods())))

        placed = 0
        for course in core_courses:
            existing = [s for s in self.data.sections_for_course(course.code) if s.period is not None]
            needed = course.required_sections() - len(existing)
            if needed <= 0:
                placed += len(existing)
                continue

            used_teachers: set[str] = {s.teacher_name for s in existing}
            for i in range(needed):
                teacher = self._find_teacher_for_course(course, exclude=used_teachers)
                if not teacher:
                    teacher = self._find_teacher_for_course(course)
                if not teacher:
                    print(f"  WARNING: No teacher for {course.code}")
                    break

                period = self._find_best_period(teacher, course)
                if not period:
                    print(f"  WARNING: No period for {course.code} with {teacher.name}")
                    break

                sec_num = len(existing) + i + 1
                self._place_section(course, teacher, period, str(sec_num))
                used_teachers.add(teacher.name)
                placed += 1

        print(f"  Total 11-12 core sections placed: {placed}")

    # ── STEP 7: ELECTIVES ──────────────────────────────────────────────

    def step_7_electives(self):
        remaining = [c for c in self.data.courses.values()
                     if c.enrollment_count > 0 and not c.is_rotation]
        actually_remaining = []
        for c in remaining:
            existing = [s for s in self.data.sections_for_course(c.code) if s.period is not None]
            needed = c.required_sections() - len(existing)
            if needed > 0:
                actually_remaining.append(c)
        remaining = actually_remaining
        remaining.sort(key=lambda c: (-c.enrollment_count, len(c.valid_periods())))

        placed = 0
        for course in remaining:
            existing = [s for s in self.data.sections_for_course(course.code) if s.period is not None]
            needed = course.required_sections() - len(existing)
            if needed <= 0:
                continue
            for i in range(needed):
                teacher = self._find_teacher_for_course(course)
                if not teacher:
                    if "pe" in course.name.lower() or "health" in course.name.lower():
                        placeholder = Teacher(
                            name=f"ADMIN_PLACEHOLDER_PE_{self._section_counter}",
                            department="PE",
                            subject_specialties=["PE", "Health", "Physical Education"],
                            max_teaching_periods=6,
                        )
                        placeholder.schedule[SEM_PERIOD] = SlotType.SEM
                        placeholder.schedule[Period.P5A] = SlotType.LUNCH
                        placeholder.lunch_period = Period.P5A
                        self.data.teachers[placeholder.name] = placeholder
                        teacher = placeholder
                    else:
                        for t in self.data.teachers.values():
                            if t.teaching_period_count() < t.max_teaching_periods and len(t.available_periods()) > 0:
                                teacher = t
                                break
                        if not teacher:
                            print(f"  WARNING: No teacher for {course.code}")
                            break

                period = self._find_best_period(teacher, course)
                if not period:
                    print(f"  WARNING: No period for {course.code}")
                    break

                cap = 30 if ("pe" in course.name.lower() or "gym" in course.name.lower()) else course.standard_capacity
                sec_num = len(existing) + i + 1
                self._place_section(course, teacher, period, str(sec_num), capacity=cap)
                placed += 1

        print(f"  Total elective sections placed: {placed}")

    # ── STEP 8: STUDENT ASSIGNMENT ──────────────────────────────────────

    def step_8_student_assignment(self):
        for s in self.data.students.values():
            s.schedule[s.lunch_period] = "LUNCH"

        seminar_courses = {c.code: c for c in self.data.courses.values()
                          if "seminar" in c.code.lower()}
        if seminar_courses:
            print(f"  Placing Seminar courses at P4 for all students...")
            for s in self.data.students.values():
                for req in s.course_requests:
                    if "seminar" in req.lower() and req in self.data.courses:
                        s.schedule[SEM_PERIOD] = req
                        secs = self.data.sections_for_course(req)
                        for sec in secs:
                            if sec.period == SEM_PERIOD and not sec.is_full:
                                sec.enrolled_students.append(s.student_id)
                                break
                        else:
                            if secs:
                                secs[0].enrolled_students.append(s.student_id)
                        break
                else:
                    s.schedule[SEM_PERIOD] = "SEM"
        else:
            for s in self.data.students.values():
                s.schedule[SEM_PERIOD] = "SEM"

        girls_rot_code = None
        boys_rot_code = None
        for code, course in self.data.courses.items():
            if course.is_rotation:
                if course.gender_restriction == Gender.GIRLS:
                    girls_rot_code = code
                else:
                    boys_rot_code = code

        g9_girls = self.data.students_by_grade_gender(9, Gender.GIRLS)
        b10_boys = self.data.students_by_grade_gender(10, Gender.BOYS)

        self._assign_rotation(g9_girls, "Girls", GIRLS_ROTATION_PERIODS, girls_rot_code)
        self._assign_rotation(b10_boys, "Boys", BOYS_ROTATION_PERIODS, boys_rot_code)

        assignment_order = [
            (9, Gender.GIRLS, "9th-grade girls"),
            (10, Gender.BOYS, "10th-grade boys"),
            (9, Gender.BOYS, "9th-grade boys"),
            (10, Gender.GIRLS, "10th-grade girls"),
            (11, Gender.GIRLS, "11th-grade girls"),
            (11, Gender.BOYS, "11th-grade boys"),
            (12, Gender.GIRLS, "12th-grade girls"),
            (12, Gender.BOYS, "12th-grade boys"),
        ]

        total_assigned = 0
        total_conflicts = 0
        for grade, gender, label in assignment_order:
            students = self.data.students_by_grade_gender(grade, gender)
            assigned, conflicts = self._assign_courses(students, label)
            total_assigned += assigned
            total_conflicts += conflicts

        self._fill_prep_periods()
        print(f"  Total course assignments: {total_assigned}")
        print(f"  Total conflicts: {total_conflicts}")

    def _assign_rotation(self, students: list[Student], pool_name: str,
                         periods: set[Period], rot_code: str | None = None):
        if not students or not rot_code:
            print(f"  {pool_name} rotation: skipped (no rotation course found)")
            return

        random.shuffle(students)
        half = len(students) // 2
        section_a = students[:half]
        section_b = students[half:]

        period_list = sorted(periods, key=lambda p: p.value)
        p_a, p_b = period_list[0], period_list[1]

        rot_sections_a = [s for s in self.data.sections.values()
                          if s.course_code == rot_code and s.section_label == "A"]
        rot_sections_b = [s for s in self.data.sections.values()
                          if s.course_code == rot_code and s.section_label == "B"]

        for i, student in enumerate(section_a):
            student.rotation_section = "A"
            student.rotation_subcohort = (i % 4) + 1
            student.schedule[p_a] = rot_code
            for sec in rot_sections_a:
                if student.student_id not in sec.enrolled_students:
                    sec.enrolled_students.append(student.student_id)
                    break

        for i, student in enumerate(section_b):
            student.rotation_section = "B"
            student.rotation_subcohort = (i % 4) + 1
            student.schedule[p_b] = rot_code
            for sec in rot_sections_b:
                if student.student_id not in sec.enrolled_students:
                    sec.enrolled_students.append(student.student_id)
                    break

        print(f"  {pool_name} rotation: Section A={len(section_a)}, Section B={len(section_b)}")

    def _assign_courses(self, students: list[Student], label: str) -> tuple[int, int]:
        assigned = 0
        conflicts = 0

        for student in students:
            unplaced_requests = []
            for course_code in student.course_requests:
                if course_code not in self.data.courses:
                    continue
                already_has = any(
                    v == course_code for v in student.schedule.values()
                )
                if already_has:
                    continue
                unplaced_requests.append(course_code)

            sections_by_course: dict[str, list[Section]] = {}
            for cc in unplaced_requests:
                secs = [s for s in self.data.sections_for_course(cc) if s.period is not None]
                sections_by_course[cc] = secs

            sorted_requests = sorted(unplaced_requests,
                                     key=lambda cc: len([s for s in sections_by_course.get(cc, [])
                                                         if s.period not in student.schedule and not s.is_full]))

            for course_code in sorted_requests:
                sections = sections_by_course.get(course_code, [])

                best_section = None
                best_score = -1
                for sec in sections:
                    if sec.period is None or sec.period in student.schedule:
                        continue
                    if sec.is_full:
                        score = -1
                    else:
                        score = sec.available_seats
                    if score > best_score:
                        best_score = score
                        best_section = sec

                if best_section and best_score >= 0:
                    student.schedule[best_section.period] = course_code
                    best_section.enrolled_students.append(student.student_id)
                    assigned += 1
                    continue

                overflow_sec = None
                for sec in sections:
                    if sec.period is None or sec.period in student.schedule:
                        continue
                    if sec.enrollment < sec.capacity + 5:
                        overflow_sec = sec
                        break

                if overflow_sec:
                    student.schedule[overflow_sec.period] = course_code
                    overflow_sec.enrolled_students.append(student.student_id)
                    assigned += 1
                    if not overflow_sec.capacity_expanded:
                        overflow_sec.capacity_expanded = True
                        self.data.approval_requests.append(ApprovalRequest(
                            action_type="Capacity Expansion",
                            subject=overflow_sec.section_id,
                            detail=f"Expanded for student {student.full_name}",
                            approval_authority="Department Head",
                        ))
                    overflow_sec.capacity = max(overflow_sec.capacity, overflow_sec.enrollment)
                    continue

                student.conflicts.append(f"Cannot place {course_code}: no section fits")
                conflicts += 1

        print(f"  {label}: {assigned} assignments, {conflicts} conflicts")
        return assigned, conflicts

    def _fill_prep_periods(self):
        for t in self.data.teachers.values():
            if t.has_prep():
                continue
            if t.required_prep_periods == 0:
                continue
            for p in TEACHING_PERIODS:
                if p not in t.schedule:
                    t.schedule[p] = SlotType.PREP
                    t.assigned_classes[p] = "PREP"
                    break

    # ── STEP 9: VALIDATION ──────────────────────────────────────────────

    def step_9_validation(self):
        total = len(self.data.students)
        complete = sum(1 for s in self.data.students.values() if s.is_schedule_complete())
        conflict_students = sum(1 for s in self.data.students.values() if s.conflicts)

        print(f"  Students with complete schedules: {complete}/{total}")
        print(f"  Students with conflicts: {conflict_students}")
        print(f"  Total sections created: {len(self.data.sections)}")
        print(f"  Total audit entries: {len(self.data.audit_log)}")

        g9 = self.data.students_by_grade_gender(9, Gender.GIRLS)
        b10 = self.data.students_by_grade_gender(10, Gender.BOYS)
        g_rot = sum(1 for s in g9 if s.rotation_section)
        b_rot = sum(1 for s in b10 if s.rotation_section)
        print(f"  Girls rotation coverage: {g_rot}/{len(g9)}")
        print(f"  Boys rotation coverage: {b_rot}/{len(b10)}")
