# PILOT TEST PLAN — Walking-Time Measurement Protocol

**Why this exists now:** every other blocker is an export someone can pull from Blackbaud or facilities. **Walking times cannot be exported — they have to be walked.** This is the long pole. Start it while the data requests are in flight.

**Do not design the release schedule from assumptions.** The brief's travel-priority hypothesis (Library farthest → Health/PE shortest) is explicitly labeled an assumption. This protocol tests it.

---

## Phase 0 — Empty-building baseline *(can run immediately, no students)*

**Purpose:** establish the floor — the physically fastest possible journey. Everything else is this plus friction.

**Who:** 2 staff with stopwatches. **When:** any time campus is empty.

For each candidate origin (one representative room per building, per floor):

| Segment | Start trigger | Stop trigger |
|---|---|---|
| S1 Classroom → corridor | Rise from seat | Cross classroom threshold |
| S2 Corridor → stairhead | Cross threshold | Reach top step |
| S3 Stair descent | First step | Exit stairwell at ground |
| S4 Ground → building exit door | Exit stairwell | Cross exterior door |
| S5 Outdoor walk | Cross exterior door | Reach chapel door |
| S6 Chapel entry → seated | Cross chapel threshold | Seated in assigned pew |

**Record every segment separately.** A single door-to-door number cannot be re-planned when a route changes; segment times can.

Walk each origin **3 times** at a deliberate, unhurried adult pace. Record all three.

**Deliverable:** `baseline_times.csv` — origin, floor, segment, trial 1/2/3.

---

## Phase 1 — Single-building trials *(one building at a time, real students)*

Run these on four separate days. Never combine buildings in Phase 1 — you are isolating each building's internal friction.

| Day | Building | What you're measuring |
|---|---|---|
| 1 | **BAC** | North vs. East door split; stair loading |
| 2 | **Prep** | 3-door split (N1, N2, South); this is the most complex building |
| 3 | **Library + Science Center** | The hypothesized longest routes |
| 4 | **Health/PE** | The hypothesized shortest route |

**Protocol per day:**
1. Students report to third-hour rooms at 8:25 as in the real model.
2. Phones into backpacks, backpacks stay, room secured — **run the real procedure**, and time it. This step is routinely underestimated.
3. Release on a single announced cue.
4. Students walk to the chapel, sit anywhere in their grade's rough area, then return.

**Observers — minimum 2 per building, plus 1 per stairwell and 1 per exterior door.**

### What each observer records

| Post | Measurements |
|---|---|
| **In-classroom** | Cue → last student out the door. **Also record phone/backpack compliance time separately.** |
| **Stairwell** | Time first and last student through. Note any stop-and-go. **Flag any moment the stair reaches standstill — that is the binding constraint, not average speed.** |
| **Exterior door** | Count students through in 15-second buckets. Gives you true door throughput, in students/minute. |
| **Chapel door** | First arrival, last arrival, and 15-second bucket counts. |
| **Chapel interior** | Time from threshold to fully seated for the last student in each group. |

### Critical instruction for observers

**Time the LAST student, not the first.** The schedule is set by the slowest normal student, not the fastest. Also note — separately — any student who is genuinely exceptional (injury, crutches, mobility device) so they can be excluded from the percentile math and handled by the exception procedure instead of inflating everyone's schedule.

---

## Phase 2 — Combined arrival *(all buildings, arrival only)*

First test where routes actually intersect. **The single most important thing to capture here is not time — it is where the streams collide.**

Station observers at every route intersection identified in Phase 1. At each, record:
- Peak simultaneous population
- Whether either stream **stopped** (a stop is a design failure, log the exact time)
- Which two origins were involved

Run this **twice**: once with a naive simultaneous release, once with a staggered release built from Phase 1 data. The delta tells you what the stagger is worth.

---

## Phase 3 — Dismissal

Dismissal is a different problem and usually the harder one — 800+ students leave at once, whereas arrival is naturally staggered by walking distance.

Test **parallel** dismissal across all five chapel doors, not sequential. Measure:
- Chapel clearance time (convocation end → last student out)
- Time to last student back inside their third-hour classroom
- **Percentage back by 9:15 / 9:17 / 9:20** — the actual acceptance criterion

---

## Phase 4 — Full cycle, 8:25 → 9:20

End-to-end dress rehearsal. **Pass criteria:**

| Metric | Target |
|---|---|
| All students seated before convocation start | 100% |
| Students back in third-hour room by 9:17 | ≥ 95% |
| Students back by 9:20 | 100% |
| Route intersections reaching standstill | 0 |
| Stairwells reaching standstill | 0 |

**If any stairwell or intersection hits standstill, the design fails regardless of whether the clock targets were met.** A standstill under normal conditions is a crush risk under abnormal ones.

---

## How to use the measurements

Once Phases 0–1 are complete, compute per origin:

- first arrival, **median**, 90th, **95th percentile**, last normal arrival
- **Schedule on the 95th percentile.** Never the median, never the fastest.
- Exclude flagged mobility exceptions from the percentile; handle them via exception procedure.

The 95th-percentile classroom-to-seat time per origin is what generates the staggered release table. Longest 95th percentile releases first.

---

## Weather

Run at least one Phase-1 trial **in rain** if at all possible. Wet conditions add coat time, slower walking, and wet-floor caution at every entry vestibule. A schedule tuned only to clear weather will fail the first wet day. If a rain trial isn't possible before launch, build an explicit foul-weather stagger with added margin and validate it the first time weather hits.

---

## Recording template

One row per group per trial:

```
date, phase, origin_room, building, floor, n_students, weather,
t_cue, t_last_out_classroom, t_last_out_stairwell, t_last_out_building,
t_first_at_chapel, t_last_at_chapel, t_last_seated,
intersections_congested, standstill_events, notes
```

Return trip: same structure, reversed.

---

## Staffing

**Pilot — deliberately overstaffed.** Every stairwell, every exterior door, every chapel door, every route intersection, plus 2 roving. Observers are there to *measure*, not just supervise; a pilot without measurement is a waste of a morning.

**Permanent — sustainable.** Third-hour teachers are the anchors (they already take attendance and know who's present, per §15 of the brief). Add fixed posts only where Phase 1–3 data proves congestion: likely the busiest stairwell, the highest-volume chapel door, and any intersection that showed queuing. **Let the data set the permanent post list** — don't staff every position forever out of caution, it won't hold.
