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

## v11 grid decisions (applied 2026-05-13) — curriculum cuts
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
