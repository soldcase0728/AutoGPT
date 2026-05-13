# Scheduling constraints

Running list of hard/soft rules captured from the user. These will be
translated into Timefold constraint streams when the solver model is set up.

## Hard constraints

### H1. Gender-separated sections
- Courses prefixed with `G ` are **girls-only**; same course name without
  prefix is **boys-only**. The two cannot share a section.
- Rule holds across all academic courses in the request data.
- **Confirmed exceptions (likely co-ed):** Choir I, AP Art and Design,
  Band I, Band II. *(pending user confirmation)*

### H2. Lunch periods are off-limits
- **Period 5A**: lunch for all 9th and 10th graders → no classes scheduled.
- **Period 5B**: lunch for all 11th and 12th graders → no classes scheduled.
- Equivalent statement: a 9th/10th grader cannot be assigned a class at 5A;
  an 11th/12th grader cannot be assigned a class at 5B.

## Soft constraints / preferences
*(to be added)*

## Open questions
- Two students with blank gender field: Cayden Atisha, Jax Atisha (16
  request rows). Default → Male, or hold for correction?
- Confirm fine-arts co-ed exceptions listed under H1.

## v10 grid decisions (applied 2026-05-13)
Five section edits, no new staff, no new sections:
1. **Sheena G Jesus Redeem 5A → 6th** (Sheena's PREP). Fixes lunch-period
   bug; concurrent with Skellet's full P6 section. +10 girls projected.
2. **Furlong Sacred Scrip B 2nd → 3rd** (Furlong's PREP). User said
   "kill" but the deeper data shows P3 captures ~18 boys waitlisted for
   Sacred Scrip B — flagged the deviation. +18 boys projected.
3. **Johnson G Architecture 8th → KILL.** No requests; 22 phantom seats
   removed; Johnson gains a PREP.
4. **Simone Spanish 1 B 2nd → 7th** (Simone's PREP). 18 boys waitlisted
   for Spanish I are free at P7. +18 boys projected.
5. **Jeffery PE/Health B 2nd → 7th** (Jeffery's PREP). 18 boys are free
   at P7 of the 26 PE/Health B waitlist. +17 boys (cap) projected.

Projected total: **+63 placements** (lower bound; full CP re-solve would
likely gain more). v9 complete-schedule rate 30% → v10 ~38%.

## Side bucket — capacity-locked
- **College Psyc**: 33 students (23 B + 10 G) cannot be solved by moves
  alone. Bone is the only teacher and both sections are 25/25. Requires
  a new section / cross-trained teacher / accepted gap.

## v12 grid — POST CO-OPTIMIZATION (2026-05-13, single source of truth)

**Headline:** 5,363 / 5,871 placements = **91.3% fulfillment**.
583 / 847 students with complete schedules (**68.8%**, +144 vs v9).
508 waitlist entries remain (Bob's orphan list).

This grid is the result of a parallel co-optimization session that
searched section→period assignments and student→section assignments
*jointly* (the lever I'd labelled #3 — letting the solver also move
sections, not just place students into a fixed grid).

### Provenance
- Canonical artifact: `scheduling/grid_v12.csv` (extracted from
  `OLSM_Grid_Snapshot_1.xlsx` → `Grid` sheet). PII-gitignored.
- Decision trail: `scheduling/changes_log.csv` (37 moves, from
  `Changes Log` sheet). PII-safe; could be tracked.
- Reproducer: `scheduling/build_v12.py` -- replays the 37 moves on
  `grid_v9.csv`. Documentary, not bit-perfect (cell fill counts differ
  because the canonical has post-solve counts).

### 37 grid changes summarized

**Pre-session lunch fixes (10).** Sections previously placed at a
period that was lunch for their target grade were moved off. (Applied
before v9 baseline in our timeline, so already incorporated.)

**Pre-session strategic swaps (4).** Teacher cells swapped P1↔P8 or
P6↔P8 to align gender/grade groupings:
  - Skellet Replacement: G Sacred Scrip ↔ G Jesus Redeem
  - Robinson: World Hist B ↔ G World Hist
  - Keller: Amer Lit B ↔ G World Lit
  - Abisaid: G College Comp ↔ G English 9

**v10 moves (5) — adopted from this repo:** Sheena 5A→6th, Furlong
2nd→3rd, Johnson kill, Simone 2nd→7th, Jeffery 2nd→7th.

**Round 1 — religion co-opt (6).** The clever 5A/5B grade-band insight:
senior religion at 5A (where 9-10 are at lunch), 9-10 religion at 5B
(where 11-12 are at lunch).
  - Kenrick Adv Liturgy B   6th → 5A
  - Skellet G Sacred Scrip  8th → 5B
  - Claravino World Relig B 6th → 5A
  - Rapal Sacraments B      1st → 5A
  - Rapal Jesus Redeem B    7th → 1st
  - Sheena G Jesus Redeem   3rd → 5B

**Round 2 — English/Spanish (1).** Weaver G AP Amer Lit 5A → 6th.

**Round 3 — History/Science (3).** LeButt Hon Chem B 7th→8th,
Loudermilk Bio B 8th→6th, Silvester Econ B 6th→7th.

**Round 4 — Capacity/Other (8).**
  - Anwar Computer Science triangle: B 2nd→8th, G 3rd→5B, B 8th→3rd
  - Aronoff B Personal Finance 3rd → 8th
  - Haller Business B          6th → 5A
  - NEW HIRE Math Statistics B 6th → 5A
  - ADMIN PLACEHOLDER 5 G PE/Health 5A → 3rd
  - ADMIN PLACEHOLDER 6 G PE/Health 6th → 1st

**Round 5** was a student-placement re-solve with no grid changes;
gained +72 complete schedules by re-optimizing assignments within the
v12 grid.

### Outcome by round
| Stage | Fulfillment | Complete |
|---|---:|---:|
| OR-tools v9 baseline | 86.8% | 439 (51.8%) |
| + R1 religion | 87.9% | 451 (53.2%) |
| + R2 Eng/Span | 88.2% | 482 (56.9%) |
| + R3 hist/sci | 89.3% | 496 (58.6%) |
| + R4 other | 90.9% | 511 (60.3%) |
| + R5 polish | **91.3%** | **583 (68.8%)** |

### Open work
- 508 waitlist entries to triage (Bob's orphan list). Still need the
  post-R5 student offer + waitlist files to drive the per-student
  catalog at the v12 state.
- Adds still on the table: G Nursing/Nutrition at P1 (~13 girls), a
  third College Psyc section (~33 students), Statistics B successor
  for displaced seniors if curriculum allows.
The school will NOT offer these electives. All sections killed, requests
for these courses go to the orphan bucket:

- **Grammar B** (Grammar and Genre Studies) — both sections:
  Schop P7 (was 13/13) and Keller P2 (was 9/12). 22 displaced boys.
  105 Grammar request rows now orphaned (plus 94 G Grammar already
  orphaned since there was no G section to begin with).
- **Math Analysis** — Clouse P7 (was 10/10). 10 displaced seniors.
  20 request rows now orphaned (10 B + 10 G).
- **Statistics B** (plain, NOT AP Stats) — both sections:
  Clouse P6 (was 18/20) and NEW HIRE Math P6 (was 20/20).
  38 displaced seniors. 56 request rows now orphaned (40 B + 16 G).
- **Creative Writing** — no current section, request rows orphaned.
  9 request rows (8 B + 1 G).
- **History by Hollywood** — no current section, 19 request rows
  orphaned (including 5 combined "Women in Leadership / History by
  Hollywood").

Total request rows newly classified as orphaned: ~209.
Total seats removed from grid: 75.
Total teacher periods freed (could be re-deployed): 5
  - Schop P7, Keller P2, Clouse P6, Clouse P7, NEW HIRE Math P6.

Same-model v9 vs v10 vs v11 comparison:
  v9  grid: 4,891 placements / 139 complete
  v10 grid: 4,976 placements / 173 complete  (+85 / +34)
  v11 grid: 4,966 placements / 166 complete  (-10 / -7 vs v10)

Solver re-routed ~60 of the 70 displaced students into other classes
they wanted, so the net cost of the curriculum cuts is small (-10
placements).
