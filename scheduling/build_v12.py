"""Rebuild grid_v12 from grid_v9 by replaying the 37 changes applied in
the co-optimization session. Source of truth: the Changes Log sheet of
OLSM_Grid_Snapshot_1.xlsx.

Sequence:
  Pre-session lunch fixes (10) -- moved sections off their wrong-grade
    lunch slot.
  Pre-session strategic swaps (4) -- two sections swap periods.
  Pre-session "user image" moves (5) -- the v10 edits I derived
    independently; the other session adopted them.
  Round 1 - religion co-opt (6).
  Round 2 - English/Spanish co-opt (1).
  Round 3 - history/science co-opt (3).
  Round 4 - other co-opt (8).
Total: 37 grid changes.

(Round 5 was a final student-placement re-solve with no grid changes.)
"""
import copy
import csv

PERIODS = ["1st","2nd","3rd","4th","5A","5B","6th","7th","8th"]

# Each change is one of:
#   "MOVE":  (teacher, course, from_period, to_period)  -- the cell content
#            at from_period (matching course) is moved verbatim to to_period.
#            from_period becomes PREP.
#   "KILL":  (teacher, course, period)
#            cell at period (matching course) becomes PREP.
#   "SWAP":  (teacher, period_a, period_b)
#            cells at the two periods swap verbatim.

CHANGES = [
    # ---- Pre-session lunch fixes ----
    ("MOVE", "Abisaid, Joseph",            "G English 9",        "5A", "8th"),
    ("MOVE", "Gischia, Nicolas",           "G English 10",       "5A", "6th"),
    ("MOVE", "Jarvie, Laura",              "English 9 B",        "5A", "2nd"),
    ("MOVE", "Keller, Miki",               "G World Lit",        "5A", "8th"),
    ("MOVE", "Klein, Kevin",               "G Sacraments",       "5A", "8th"),
    ("MOVE", "Robinson, Andrew",           "G World Hist",       "5A", "8th"),
    ("MOVE", "Brugger, Mandy",             "G Physics",          "5B", "7th"),
    ("MOVE", "Claravino, Don",             "World Relig B",      "5B", "6th"),
    ("MOVE", "Clouse Replacement",         "Genetics",           "5B", "6th"),
    ("MOVE", "Skellet Replacement",        "G Jesus Redeem",     "5B", "8th"),
    # ---- Pre-session strategic swaps (period_a, period_b) ----
    ("SWAP", "Skellet Replacement",        "1st", "8th"),  # G Sacred Scrip <-> G Jesus Redeem
    ("SWAP", "Robinson, Andrew",           "1st", "8th"),  # World Hist B <-> G World Hist
    ("SWAP", "Keller, Miki",               "1st", "8th"),  # Amer Lit B <-> G World Lit
    ("SWAP", "Abisaid, Joseph",            "6th", "8th"),  # G College Comp <-> G English 9
    # ---- Pre-session "user image" moves (matches my v10) ----
    ("MOVE", "Sheena, Marcus",             "G Jesus Redeem",     "5A", "6th"),
    ("MOVE", "Furlong, Michael",           "Sacred Scrip B",     "2nd","3rd"),
    ("KILL", "Johnson, Tara",              "G Architecture",     "8th"),
    ("MOVE", "Simone, Carla",              "Spanish 1 B",        "2nd","7th"),
    ("MOVE", "Jeffery, Keith",             "PE/Health B",        "2nd","7th"),
    # ---- Round 1: Religion co-optimization ----
    ("MOVE", "Kenrick, Hannah",            "Adv Liturgy B",      "6th","5A"),
    ("MOVE", "Skellet Replacement",        "G Sacred Scrip",     "8th","5B"),
    ("MOVE", "Claravino, Don",             "World Relig B",      "6th","5A"),
    ("MOVE", "Rapal, Denny",               "Sacraments B",       "1st","5A"),
    ("MOVE", "Rapal, Denny",               "Jesus Redeem B",     "7th","1st"),
    ("MOVE", "Sheena, Marcus",             "G Jesus Redeem",     "3rd","5B"),
    # ---- Round 2: English/Spanish ----
    ("MOVE", "Weaver, Austin",             "G AP Amer Lit",      "5A","6th"),
    # ---- Round 3: History/Science ----
    ("MOVE", "LeButt, Christian",          "Hon Chem B",         "7th","8th"),
    ("MOVE", "Loudermilk, Robin",          "Bio B",              "8th","6th"),
    ("MOVE", "Silvester, Darrin",          "Econ B",             "6th","7th"),
    # ---- Round 4: Other (Computer Science triangle + 5 more) ----
    ("MOVE", "Anwar, Meysa",               "Computer Science B", "2nd","8th"),
    ("MOVE", "Anwar, Meysa",               "Computer Science G", "3rd","5B"),
    # NOTE: the next move below comes AFTER the P2 -> P8 above; by the
    # time we apply it the P8 cell is now Computer Science B (just moved).
    # We then move "Computer Science B" from P8 -> P3 (the now-empty slot).
    ("MOVE", "Anwar, Meysa",               "Computer Science B", "8th","3rd"),
    ("MOVE", "Aronoff, Dawn",              "B Personal Finance", "3rd","8th"),
    ("MOVE", "Haller, Nancy",              "Business B",         "6th","5A"),
    ("MOVE", "NEW HIRE Math (Anson Replacement)",
                                            "Statistics B",       "6th","5A"),
    ("MOVE", "ADMIN PLACEHOLDER 5",        "G PE/Health",        "5A","3rd"),
    ("MOVE", "ADMIN PLACEHOLDER 6",        "G PE/Health",        "6th","1st"),
]


def find_teacher_row(rows, teacher):
    for i in range(2, len(rows)):
        name = rows[i][0].strip().strip("~").strip()
        if name == teacher:
            return i
    return None


def apply_changes(grid_path_in: str, grid_path_out: str):
    with open(grid_path_in, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header = rows[1]
    pcol = {p: header.index(p) for p in PERIODS}
    new = copy.deepcopy(rows)
    new[0][0] = "OLSM Master Schedule v12 — co-optimized (37 grid changes)"

    applied, warnings = [], []
    for ch in CHANGES:
        kind = ch[0]
        teacher = ch[1]
        rid = find_teacher_row(new, teacher)
        if rid is None:
            warnings.append(f"teacher not found: {teacher}")
            continue
        if kind == "MOVE":
            course, p_from, p_to = ch[2], ch[3], ch[4]
            before = new[rid][pcol[p_from]]
            if course not in before:
                warnings.append(f"expected {course!r} at {teacher} {p_from}; "
                                f"found {before!r}; skipping")
                continue
            new[rid][pcol[p_to]] = before
            new[rid][pcol[p_from]] = "PREP"
            applied.append(f"  MOVE  {teacher:<35} {p_from:>3} -> {p_to:<3} "
                           f"{course}")
        elif kind == "KILL":
            course, p = ch[2], ch[3]
            before = new[rid][pcol[p]]
            if course not in before:
                warnings.append(f"expected {course!r} at {teacher} {p}; "
                                f"found {before!r}; skipping")
                continue
            new[rid][pcol[p]] = "PREP"
            applied.append(f"  KILL  {teacher:<35} {p:>3}        {course}")
        elif kind == "SWAP":
            p_a, p_b = ch[2], ch[3]
            new[rid][pcol[p_a]], new[rid][pcol[p_b]] = (
                new[rid][pcol[p_b]], new[rid][pcol[p_a]])
            applied.append(f"  SWAP  {teacher:<35} {p_a} <-> {p_b}")

    with open(grid_path_out, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(new)

    print(f"Applied {len(applied)} / {len(CHANGES)} changes:")
    print("\n".join(applied))
    if warnings:
        print(f"\nWARNINGS ({len(warnings)}):")
        for w in warnings:
            print(f"  {w}")
    return new


if __name__ == "__main__":
    apply_changes("grid_v9.csv", "grid_v12_rebuilt.csv")

    # Diff against the canonical grid_v12.csv (from the xlsx)
    import csv as _csv
    with open("grid_v12_rebuilt.csv") as f: rebuilt = list(_csv.reader(f))
    with open("grid_v12.csv") as f:         canon   = list(_csv.reader(f))
    diffs = 0
    for r in range(len(rebuilt)):
        if r >= len(canon):
            diffs += 1; continue
        for c in range(len(rebuilt[r])):
            a = (rebuilt[r][c] or "").strip()
            b = (canon[r][c]   if c < len(canon[r]) else "").strip()
            if a != b:
                diffs += 1
                if diffs <= 15:
                    print(f"  DIFF  R{r} C{c}: rebuilt={a!r}  canonical={b!r}")
    print(f"\nReproducibility: {diffs} cell differences vs the canonical "
          f"grid_v12.csv from the xlsx.")
