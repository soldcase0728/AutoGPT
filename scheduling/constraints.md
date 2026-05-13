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
- Need: period grid (which sections placed at which period) and course
  catalog with per-section capacities and section counts.
