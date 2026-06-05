"""CLI entry point for the OLSM Schedule Build Engine."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .parser import load_input_file, load_student_requests_csv
from .engine import BuildEngine
from .output import generate_all_outputs


def main():
    parser = argparse.ArgumentParser(
        description="OLSM Schedule Build Engine v1.0 — "
                    "Build a complete, validated, conflict-free master schedule.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m olsm_scheduler Student_Requests.csv
  python -m olsm_scheduler Student_Requests.csv --teachers teachers.xlsx
  python -m olsm_scheduler input_data.xlsx -o ./schedule_output
  python -m olsm_scheduler input_data.xlsx --validate-only
        """,
    )
    parser.add_argument(
        "input_file",
        help="Path to input file (.csv Student Requests or .xlsx INPUT_TEMPLATES)",
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="./olsm_output",
        help="Output directory for generated files (default: ./olsm_output)",
    )
    parser.add_argument(
        "--teachers",
        help="Path to teacher roster .xlsx file (when using CSV student input)",
    )
    parser.add_argument(
        "--rooms",
        help="Path to room inventory .xlsx file (when using CSV student input)",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Run only intake validation (Step 0) without building",
    )
    parser.add_argument(
        "--step",
        type=int,
        choices=range(0, 10),
        help="Run only up to this step (0-9)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducible student assignments (default: 42)",
    )
    parser.add_argument(
        "--rotation-girls",
        default="G Grammar and Genre Studies 9",
        help="Girls rotation course name (default: 'G Grammar and Genre Studies 9')",
    )
    parser.add_argument(
        "--rotation-boys",
        default="Grammar and Genre Studies",
        help="Boys rotation course name (default: 'Grammar and Genre Studies')",
    )

    args = parser.parse_args()

    import random
    random.seed(args.seed)

    print("=" * 60)
    print("OLSM SCHEDULE BUILD ENGINE v1.0")
    print("Orchard Lake St. Mary's Preparatory")
    print("=" * 60)

    input_path = Path(args.input_file)
    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    print(f"\nLoading input file: {input_path}")
    try:
        if input_path.suffix.lower() == ".csv":
            data = load_student_requests_csv(
                input_path,
                rotation_girls=args.rotation_girls,
                rotation_boys=args.rotation_boys,
            )
            if args.teachers:
                import openpyxl
                from .parser import parse_teachers_xlsx, _find_header_row
                wb = openpyxl.load_workbook(args.teachers, data_only=True)
                for name in wb.sheetnames:
                    if "teacher" in name.lower() or "roster" in name.lower():
                        data.teachers = parse_teachers_xlsx(wb[name])
                        break
        else:
            data = load_input_file(input_path)
    except Exception as e:
        print(f"ERROR: Failed to parse input file: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"  Students: {len(data.students)}")
    print(f"  Courses: {len(data.courses)}")
    print(f"  Teachers: {len(data.teachers)}")
    print(f"  Rooms: {len(data.rooms)}")
    print(f"  Constraints: {len(data.constraints)}")

    engine = BuildEngine(data)

    if args.validate_only:
        print("\n--- VALIDATE ONLY MODE ---")
        engine.step_0_intake()
        from .validators import run_checkpoint, format_checkpoint_report
        entries = run_checkpoint(data, 0)
        report = format_checkpoint_report(0, "Intake & Validation", entries, data)
        print(report)
        sys.exit(0)

    reports = engine.run_full_build()

    output_dir = Path(args.output_dir)
    generate_all_outputs(data, reports, output_dir)

    total = len(data.audit_log)
    passed = sum(1 for e in data.audit_log if e.result == "PASS")
    failed = sum(1 for e in data.audit_log if e.result == "FAIL")
    warnings = sum(1 for e in data.audit_log if e.result == "WARNING")

    print(f"\n{'=' * 60}")
    print("BUILD COMPLETE")
    print(f"{'=' * 60}")
    print(f"  Audit checks: {total} total, {passed} passed, {failed} failed, {warnings} warnings")
    print(f"  Output files: {output_dir}")

    if failed > 0:
        print(f"\n  WARNING: {failed} audit checks FAILED. Review AUDIT_LOG.xlsx for details.")
        sys.exit(2)
    else:
        print("\n  All audit checks passed. Schedule is ready for review.")


if __name__ == "__main__":
    main()
