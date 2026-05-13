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
