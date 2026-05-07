#!/usr/bin/env python3
"""Collect play-by-play data for a GameChanger (gc.com) game and write CSV.

Usage:
    NIMBLE_API_KEY=... python scripts/collect_gc_plays.py \
        --url https://web.gc.com/games/<game-id> \
        --out plays.csv

Requires the Nimble CLI:
    npm i -g @nimble-way/nimble-cli

The script shells out to `nimble extract`, asks Nimble to return the
play-by-play table for the game, and flattens the JSON response into CSV.
If gc.com changes its layout (or the game is private), Nimble's extraction
may return fewer fields — adjust FIELDS below or pass --fields on the CLI.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_FIELDS = [
    "inning",
    "half",
    "batter",
    "pitcher",
    "result",
    "rbi",
    "score_away",
    "score_home",
    "description",
]

EXTRACTION_PROMPT = (
    "Extract every play from the play-by-play feed on this GameChanger "
    "game page. For each play return: inning (number), half (top|bottom), "
    "batter (full name), pitcher (full name), result (e.g. single, strikeout), "
    "rbi (number), score_away (number), score_home (number), and a short "
    "description. Return a JSON array under the key 'plays'."
)


def run_nimble(url: str) -> dict:
    if not os.environ.get("NIMBLE_API_KEY"):
        sys.exit("NIMBLE_API_KEY is not set")
    cmd = [
        "nimble", "extract",
        "--url", url,
        "--format", "json",
        "--prompt", EXTRACTION_PROMPT,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"nimble extract failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def find_plays(payload: dict) -> list[dict]:
    if isinstance(payload, list):
        return payload
    for key in ("plays", "data", "result", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]
        if isinstance(payload.get(key), dict):
            inner = find_plays(payload[key])
            if inner:
                return inner
    return []


def write_csv(plays: list[dict], fields: list[str], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for play in plays:
            writer.writerow({k: play.get(k, "") for k in fields})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="gc.com game URL")
    parser.add_argument("--out", default="plays.csv", type=Path)
    parser.add_argument(
        "--fields",
        default=",".join(DEFAULT_FIELDS),
        help="Comma-separated CSV columns",
    )
    parser.add_argument(
        "--raw",
        type=Path,
        help="Optional path to also dump the raw Nimble JSON response",
    )
    args = parser.parse_args()

    payload = run_nimble(args.url)
    if args.raw:
        args.raw.write_text(json.dumps(payload, indent=2))

    plays = find_plays(payload)
    if not plays:
        sys.exit("No plays found in Nimble response — check --raw output")

    fields = [f.strip() for f in args.fields.split(",") if f.strip()]
    write_csv(plays, fields, args.out)
    print(f"Wrote {len(plays)} plays to {args.out}")


if __name__ == "__main__":
    main()
