# DATA AUDIT — Morning Convocation Logistics

**Date:** 2026-08-09
**Status:** ⛔ **Design BLOCKED.** Population is established; routing is not.

---

## 1. Files used

| File | Date | What it gave us | What it does NOT contain |
|---|---|---|---|
| `730_2026_Master_Schedule.pdf` | 7/30/2026 | Teacher × period × course × enrollment count | **No room. No building. No floor.** |
| `course_worklist.csv` | 7/21/2026 | Student → course, grade, gender, enrollment status | **No period. No section. No teacher. No room.** |
| `72126_grid.pdf` | 7/21/2026 | Superseded earlier master schedule | Same omissions |
| Book catalogs v4–v9, vendor quotes, bookstore inventory | Jul–Aug | Textbook work only | Nothing logistical |

**Searched for and NOT FOUND anywhere:** campus map, site plan, chapel floor plan, room list, room→building map, floor assignments, door schedules, occupancy certificate, walking-time studies, prior convocation data.

---

## 2. Student population — MEASURED

| Metric | Value | Source |
|---|---:|---|
| Unique students in worklist | **853** | `course_worklist.csv`, distinct student names |
| Students enrolled in a 3rd-period class | **827** | Sum of 7/30 grid 3rd-period `E:` values |
| **Students with NO 3rd-period class** | **26** | 853 − 827 |
| 3rd-period sections | **52** | 7/30 grid |

⚠️ **The 26 students without a third-hour class have no anchor classroom.** The entire operating model assumes every student has a third-hour room to start in, store a backpack in, and return to. These 26 need an assigned holding room before the model works. *(Some portion may be data artifacts — see §4.)*

### Grade distribution — CALCULATED, not measured

| Grade | Est. students at 3rd period |
|---|---:|
| 9 | 196 |
| 10 | 202 |
| 11 | 221 |
| 12 | 208 |
| **Total** | **827** |

**Method:** the master schedule gives section headcounts but not the grade of the students in them. Grade was apportioned by applying each course's grade mix from `course_worklist.csv` to that course's section headcount. **These are estimates with roughly ±3–5 students of uncertainty per grade.** They are adequate for sizing chapel grade territories; they are **not** adequate for assigning individual pews.

---

## 3. ⛔ Blockers — what cannot be produced and why

| Required output | Status | Blocking data |
|---|---|---|
| `STUDENT_ROUTING.csv` (one row per student) | **IMPOSSIBLE** | No student→section link |
| Room / building / floor columns | **IMPOSSIBLE** | No room data in any file |
| `THIRD_HOUR_ORIGIN_MATRIX` by building | **BLOCKED** | No room→building map |
| Building exit assignments | **BLOCKED** | Depends on room/floor |
| Campus routes & `CAMPUS_FLOW_PLAN.html` | **BLOCKED** | No campus map or distances |
| Chapel door loading | **BLOCKED** | No chapel plan, no door widths |
| `SEATING_CHART` (pew-level) | **BLOCKED** | No chapel seating plan |
| `RELEASE_SCHEDULE.md` (minute:second) | **BLOCKED** | No walking-time measurements |
| 95th-percentile travel times | **BLOCKED** | Zero timed data exists |

### 3.1 The critical break: student → section

`course_worklist.csv` records that a student takes **"G Spanish I"** — but that course runs as **three separate sections** at three periods under two teachers. Nothing in any file says which one a given student sits in.

Without that link there is no way to say *"Isabella Mittlestat, 3rd hour, Room ___, Building ___"* — which is the first column of every downstream deliverable.

**This one export unblocks roughly 60% of the project.**

### 3.2 The second break: rooms and buildings

The master schedule is a **teacher × period** view. Blackbaud also publishes a **room view** of the same master schedule. That export carries the room number, which then needs a room→building→floor lookup (typically a facilities spreadsheet, not in the SIS).

Your brief supplies building *door* counts (BAC: 2, Prep: 3) but no way to map any classroom to any building.

### 3.3 The third break: no measured walking data

The brief correctly demands 95th-percentile times and warns that *"a stated 3:30 door-to-seat time that excludes two or three flights of stairs is NOT sufficient."* Agreed — and there is currently **no timed data at all**, at any percentile, for any route. The travel-priority hypothesis (Library farthest → Health/PE shortest) is stated in the brief as an assumption and **remains completely unvalidated**.

Release timing cannot be modeled from assumption. It must be walked and timed.

---

## 4. Data-quality problems found

| # | Issue | Impact |
|---|---|---|
| 1 | **26 students have no 3rd-period class** | No anchor classroom. Needs roster reconciliation + holding room. |
| 2 | **7/30 grid may be stale.** A student was reported in 4th-hour Honors Chemistry; the 7/30 grid shows no such section (all chem teachers have seminar duty at 4th). | If the grid moved after 7/30, every headcount here shifts. **Confirm the current grid before building on this.** |
| 3 | **Worklist is 9 days older than the grid** (7/21 vs 7/30) and disagrees — e.g. regular World History: 116 in worklist vs 123 on grid. | Grade estimates carry that drift. |
| 4 | **`Morgan, Kim — G Nursing/Nutrition (E:20)` column position ambiguous** in the PDF; reads as 4th period but may be 3rd. | ±20 students in the 3rd-hour population. Excluded from the 827 pending confirmation. |
| 5 | **`TA Honors Engineering Science` sections show E:0** (Maynard, 3 slots) | Phantom sections or TA placeholders — confirm they carry no students. |
| 6 | **4 "Z Teacher" placeholders** (Math, Business, Spanish, English) — unfilled hires | Business/Math/Spanish teach 3rd-hour sections (46 students). **No named adult anchor** for those rooms, which the supervision model in §15 depends on. |
| 7 | **15 of 52 third-hour rooms are mixed-grade** | See §5 — this is a design constraint, not an error. |

---

## 5. ⚠️ Structural finding: 15 rooms split across grades

**"Travel by geography, sit by grade"** works cleanly only when a classroom holds one grade. It does not here.

| Third-hour room | n | Grade split |
|---|---:|---|
| Kostoff — Genetics | 21 | gr12: 15, gr11: 6 |
| Maynard — Honors Engineering | 20 | gr12: 12, gr11: 8 |
| Cruz — Pre Calculus | 19 | gr12: 12, gr11: 7 |
| Wloch — AP Chemistry | 19 | gr11: 11, gr12: 8 |
| Z Teacher — G Accounting/Business | 19 | gr11: 15, gr12: 4 |
| Sturgill — G Anatomy | 18 | gr11: 12, gr12: 6 |
| Larson — G Pre-Calculus | 17 | gr12: 10, gr11: 7 |
| Keller — Spanish II | 16 | gr10: 14, gr9: 1, gr11: 1 |
| Naszradi — G Honors Algebra II | 15 | gr10: 10, gr11: 5 |
| Buchanan — G PE | 14 | gr10: 8, gr11: 6 |
| Hendrick — G Honors Geometry | 12 | gr9: 7, gr10: 5 |
| Howard — G Forensics/Debate | 8 | gr10: 6, gr12: 1, gr11: 1 |
| Richards — G AP Spanish | 7 | gr11: 4, gr12: 3 |
| Howard — Forensics/Debate | 6 | gr12: 3, gr11: 2, gr10: 1 |
| *(+1 more)* | | |

**Consequence:** roughly **200 students** walk to the chapel with one room-group but must split into two or three grade sections on arrival, then re-merge for the return trip. This directly stresses priority #6 (minimum chapel interior cross-traffic).

Mitigation options, to decide once seating geometry is known:
- **(a)** Split at the chapel threshold — each room-group fans to its grade sections at the door. Costs interior cross-traffic.
- **(b)** Split at the classroom door — the group walks as 2–3 sub-files from the start. Costs a little supervision, protects the interior.
- **(c)** Seat these rooms in "seam" pews at grade boundaries, so an 11/12 mixed room sits astride the 11–12 line. Elegant, but constrains the seating map.

**(b) and (c) are likely the answer.** Cannot be settled without the chapel plan.

---

## 6. ⚠️ Capacity flag

Per §9 of the brief, capacity is priority #1 and must not be solved by inventing seats.

| | |
|---|---|
| Student body | **853** |
| Prior preliminary estimate of student seats | ~898 (**explicitly not a legal occupancy determination**) |
| Nominal margin | **45 seats (5.3%)** |

**This margin is too thin to accept on an unverified number.** It does not yet account for faculty/staff seating, presiders, accessible seating and companion seats, or required aisle clearances — any of which could push actual usable student capacity below 853.

**Required before proceeding:** the chapel's approved occupancy load from the certificate of occupancy or fire marshal, plus a seat count from the actual floor plan.

If verified student capacity lands under ~853 + faculty, the single-assembly model fails and the design must change (split convocation, overflow with livestream, etc.). **Flagging now rather than discovering it in a pilot.**

---

## 7. What I need to unblock — in priority order

| # | Item | Source | Unblocks |
|---|---|---|---|
| **1** | **Student schedule export** — one row per student per course with **period, section, teacher, room** | Blackbaud SIS → Schedules → student schedule export | `STUDENT_ROUTING.csv`, real grade counts, all per-student assignment |
| **2** | **Master schedule ROOM view** — same grid you sent, exported by room | Blackbaud → Master Schedule → room mode | Room for all 52 third-hour sections |
| **3** | **Room → building → floor lookup** | Facilities / registrar spreadsheet | Origin matrix, exit assignment, stagger design |
| **4** | **Chapel floor plan** — pews, seats/pew, aisles, all 5 doors w/ clear widths | Facilities / architect drawings | Seating chart, door loading, interior flow |
| **5** | **Chapel approved occupancy** | Certificate of occupancy / fire marshal | Priority-#1 safety gate (§6 above) |
| **6** | **Campus site plan** with building footprints + walking paths | Facilities | Routes, campus flow plan |
| **7** | **Timed walking trials** — see `PILOT_TEST_PLAN.md` | Must be physically measured | Release schedule, all percentile timing |

**Items 1–3 are the big unlock.** With those I can deliver the origin matrix, per-student routing, exit assignments, and staggered release logic. Items 4–6 finish the chapel and route design. Item 7 is the only one that cannot be exported from a system — **it has to be walked with a stopwatch**, and I've written the protocol for it.

---

## 8. Delivered in this pass

| File | Contents |
|---|---|
| `THIRD_HOUR_ORIGIN_MATRIX.csv` | All 52 third-hour sections: teacher, course, headcount, estimated grade split. **Room/Building/Floor columns present and deliberately blank** — populate from items 2–3 and the matrix completes itself. |
| `THIRD_HOUR_ORIGIN_MATRIX_BY_BUILDING.csv` | The Grade × Origin table from §17 of the brief, with grade totals filled and building rows marked blocked. |
| `DATA_AUDIT.md` | This file. |

**Not produced, by design:** seating chart, door loading, release schedule, campus flow, routing. Producing any of them now would mean inventing rooms, buildings, distances, and chapel geometry — which the brief explicitly forbids, and which would be worse than useless because it would look authoritative.
