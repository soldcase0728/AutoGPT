"""Data models for the OLSM scheduling engine."""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Optional


class Period(enum.Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"
    P5A = "P5A"
    P5B = "P5B"
    P6 = "P6"
    P7 = "P7"
    P8 = "P8"


ALL_PERIODS: list[Period] = list(Period)
TEACHING_PERIODS: list[Period] = [
    Period.P1, Period.P2, Period.P3,
    Period.P5A, Period.P5B,
    Period.P6, Period.P7, Period.P8,
]

GIRLS_ROTATION_PERIODS = {Period.P1, Period.P2}
BOYS_ROTATION_PERIODS = {Period.P3, Period.P5B}

LUNCH_9_10 = Period.P5A
LUNCH_11_12 = Period.P5B
SEM_PERIOD = Period.P4


class Gender(enum.Enum):
    BOYS = "B"
    GIRLS = "G"


class GradeLevel(enum.Enum):
    GRADE_9 = 9
    GRADE_10 = 10
    GRADE_11 = 11
    GRADE_12 = 12


class CourseFlag(enum.Enum):
    REGULAR = "Regular"
    HONORS = "Honors"
    AP = "AP"
    COLLEGE = "College"
    ROTATION = "Rotation"


class SlotType(enum.Enum):
    TEACHING = "TEACHING"
    LUNCH = "LUNCH"
    SEM = "SEM"
    PREP = "PREP"
    ROTATION = "ROTATION"
    FREE = "FREE"


@dataclass
class Course:
    code: str
    name: str
    department: str
    grade_level: int
    gender_restriction: Optional[Gender]
    min_sections: int
    standard_capacity: int
    flag: CourseFlag = CourseFlag.REGULAR
    enrollment_count: int = 0

    @property
    def is_rotation(self) -> bool:
        return self.flag == CourseFlag.ROTATION

    @property
    def is_ap(self) -> bool:
        return self.flag == CourseFlag.AP

    @property
    def is_honors(self) -> bool:
        return self.flag == CourseFlag.HONORS

    @property
    def is_ap_or_honors(self) -> bool:
        return self.flag in (CourseFlag.AP, CourseFlag.HONORS)

    @property
    def is_single_section(self) -> bool:
        return self.min_sections == 1

    def required_sections(self) -> int:
        if self.enrollment_count == 0:
            return self.min_sections
        import math
        return max(self.min_sections, math.ceil(self.enrollment_count / self.standard_capacity))

    def forbidden_periods(self) -> set[Period]:
        forbidden = {Period.P4}
        if self.grade_level == 9 and self.gender_restriction == Gender.GIRLS:
            forbidden |= GIRLS_ROTATION_PERIODS
        if self.grade_level == 10 and self.gender_restriction == Gender.BOYS:
            forbidden |= BOYS_ROTATION_PERIODS
        if self.grade_level in (9, 10):
            forbidden.add(Period.P5B)
        if self.grade_level in (11, 12):
            forbidden.add(Period.P5A)
        return forbidden

    def valid_periods(self) -> set[Period]:
        return set(ALL_PERIODS) - self.forbidden_periods()


@dataclass
class Teacher:
    name: str
    department: str
    subject_specialties: list[str] = field(default_factory=list)
    certifications: list[str] = field(default_factory=list)
    max_teaching_periods: int = 6
    required_prep_periods: int = 1
    special_constraints: str = ""
    notes: str = ""
    is_rotation_teacher: bool = False
    rotation_pools: list[str] = field(default_factory=list)

    schedule: dict[Period, SlotType] = field(default_factory=dict)
    assigned_classes: dict[Period, str] = field(default_factory=dict)
    lunch_period: Optional[Period] = None
    overload_approved: bool = False

    def available_periods(self) -> list[Period]:
        return [p for p in ALL_PERIODS if p not in self.schedule]

    def teaching_period_count(self) -> int:
        return sum(1 for s in self.schedule.values() if s in (SlotType.TEACHING, SlotType.ROTATION))

    def has_prep(self) -> bool:
        return SlotType.PREP in self.schedule.values()

    def is_double_booked(self) -> bool:
        return False


@dataclass
class Room:
    number: str
    room_type: str
    capacity: int
    special_features: str = ""
    available_periods: list[Period] = field(default_factory=lambda: list(ALL_PERIODS))
    notes: str = ""


@dataclass
class Student:
    student_id: str
    last_name: str
    first_name: str
    grade: int
    gender: Gender
    course_requests: list[str] = field(default_factory=list)

    schedule: dict[Period, str] = field(default_factory=dict)
    rotation_section: Optional[str] = None
    rotation_subcohort: Optional[int] = None
    conflicts: list[str] = field(default_factory=list)

    @property
    def full_name(self) -> str:
        return f"{self.last_name}, {self.first_name}"

    @property
    def is_9th_girl(self) -> bool:
        return self.grade == 9 and self.gender == Gender.GIRLS

    @property
    def is_10th_boy(self) -> bool:
        return self.grade == 10 and self.gender == Gender.BOYS

    @property
    def needs_rotation(self) -> bool:
        return self.is_9th_girl or self.is_10th_boy

    @property
    def lunch_period(self) -> Period:
        return LUNCH_9_10 if self.grade in (9, 10) else LUNCH_11_12

    def available_periods(self) -> list[Period]:
        return [p for p in ALL_PERIODS if p not in self.schedule]

    def is_schedule_complete(self) -> bool:
        return len(self.schedule) == 9


@dataclass
class Section:
    section_id: str
    course_code: str
    section_label: str
    teacher_name: str
    period: Optional[Period] = None
    room: Optional[str] = None
    capacity: int = 24
    enrolled_students: list[str] = field(default_factory=list)
    capacity_expanded: bool = False
    original_capacity: int = 24

    @property
    def enrollment(self) -> int:
        return len(self.enrolled_students)

    @property
    def available_seats(self) -> int:
        return self.capacity - self.enrollment

    @property
    def is_full(self) -> bool:
        return self.enrollment >= self.capacity


@dataclass
class Constraint:
    constraint_type: str
    subject_teacher: str
    detail: str
    approval_required_from: str
    status: str


@dataclass
class ApprovalRequest:
    action_type: str
    subject: str
    detail: str
    approval_authority: str
    status: str = "PENDING"
    timestamp: str = ""


@dataclass
class AuditEntry:
    step: int
    check_id: str
    check_name: str
    result: str  # PASS / FAIL / WARNING
    detail: str
    timestamp: str = ""


@dataclass
class ScheduleData:
    """Central data store for the entire build."""
    students: dict[str, Student] = field(default_factory=dict)
    courses: dict[str, Course] = field(default_factory=dict)
    teachers: dict[str, Teacher] = field(default_factory=dict)
    rooms: dict[str, Room] = field(default_factory=dict)
    constraints: list[Constraint] = field(default_factory=list)
    sections: dict[str, Section] = field(default_factory=dict)
    approval_requests: list[ApprovalRequest] = field(default_factory=list)
    audit_log: list[AuditEntry] = field(default_factory=list)

    girls_rotation_teachers: list[str] = field(default_factory=list)
    boys_rotation_teachers: list[str] = field(default_factory=list)

    step_completed: dict[int, bool] = field(default_factory=dict)

    def students_by_grade_gender(self, grade: int, gender: Gender) -> list[Student]:
        return [s for s in self.students.values()
                if s.grade == grade and s.gender == gender]

    def sections_for_course(self, course_code: str) -> list[Section]:
        return [s for s in self.sections.values() if s.course_code == course_code]

    def teacher_sections(self, teacher_name: str) -> list[Section]:
        return [s for s in self.sections.values() if s.teacher_name == teacher_name]

    def sections_at_period(self, period: Period) -> list[Section]:
        return [s for s in self.sections.values() if s.period == period]
