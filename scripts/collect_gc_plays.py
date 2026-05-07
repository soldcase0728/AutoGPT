#!/usr/bin/env python3
"""Collect GameChanger (gc.com) play-by-play data via Nimble.

Modes:
  team    Walk a team schedule URL, find every completed game, fetch each
          game's plays page, and write all plays to one CSV.
  game    Fetch a single game's plays.
  probe   Fetch a URL and dump the raw Nimble response so the parsing
          heuristics below can be tuned to whatever gc.com is actually
          serving.

Usage:
  export NIMBLE_API_KEY=...
  python scripts/collect_gc_plays.py team \
      --url https://web.gc.com/teams/<team-id>/<slug>/schedule \
      --out plays.csv

  python scripts/collect_gc_plays.py game \
      --url https://web.gc.com/games/<game-id> --out plays.csv

  python scripts/collect_gc_plays.py probe \
      --url <any-url> --out probe.json

Requires the Nimble CLI:
  npm i -g @nimble-way/nimble-cli

The parsing logic in find_completed_games() and parse_plays() is best-effort
against gc.com's rendered markup. Tune those two functions once `probe`
output is in hand — the rest of the pipeline (Nimble fetch, CSV write,
team-level orchestration) does not depend on the exact HTML shape.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

GC_GAME_RE = re.compile(r"/games/([A-Za-z0-9]+)")
GC_GAME_URL = "https://web.gc.com/games/{game_id}"
GC_GAME_PLAYS_URL = "https://web.gc.com/games/{game_id}/plays"

COMPLETED_RE = re.compile(
    r"(final|completed|\bw\s*\d+\s*-\s*\d+|\bl\s*\d+\s*-\s*\d+|\bt\s*\d+\s*-\s*\d+)",
    re.IGNORECASE,
)

INNING_RE = re.compile(
    r"\b(top|bottom|t|b)\s*(?:of\s+)?(?:the\s+)?(\d+)(?:st|nd|rd|th)?\b",
    re.IGNORECASE,
)
SCORE_RE = re.compile(r"\b(\d+)\s*-\s*(\d+)\b")
RBI_RE = re.compile(r"(\d+)\s*RBI", re.IGNORECASE)
PLAY_RESULT_RE = re.compile(
    r"\b(strikeout|strike\s*out|walk|single|double|triple|home\s*run|"
    r"hit\s+by\s+pitch|sacrifice|sac\s+fly|sac\s+bunt|grounded\s+out|"
    r"flied\s+out|popped\s+out|lined\s+out|line\s*out|ground\s*out|"
    r"fly\s*out|pop\s*out|fielder'?s\s+choice|stole|caught\s+stealing|"
    r"reached\s+on\s+error|wild\s+pitch|passed\s+ball|balk)\b",
    re.IGNORECASE,
)

PLAY_FIELDS = [
    "game_id",
    "game_url",
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


def nimble_extract(url: str, *, render: bool = True) -> dict:
    if not os.environ.get("NIMBLE_API_KEY"):
        sys.exit("NIMBLE_API_KEY is not set")
    cmd = [
        "nimble", "extract",
        "--url", url,
        "--format", "json",
        "--markdown-backend", "full_page",
    ]
    if render:
        cmd.append("--render")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"nimble extract failed for {url}: {proc.stderr.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"raw": proc.stdout}


def page_text(payload: dict) -> str:
    """Pull the most useful text representation out of a Nimble payload.

    Nimble has put rendered content under several keys across versions;
    walk the common ones and fall back to a JSON dump.
    """
    candidates: list[tuple[str, ...]] = [
        ("data", "markdown"),
        ("data", "html_content"),
        ("data", "html"),
        ("data", "content"),
        ("markdown",),
        ("html_content",),
        ("html",),
        ("content",),
        ("raw",),
    ]
    for path in candidates:
        node: Any = payload
        for key in path:
            if isinstance(node, dict) and key in node:
                node = node[key]
            else:
                node = None
                break
        if isinstance(node, str) and node.strip():
            return node
    return json.dumps(payload)


def find_completed_games(schedule_payload: dict) -> list[dict]:
    """Return [{'game_id': ..., 'context': ...}, ...] for completed games."""
    text = page_text(schedule_payload)
    games: dict[str, str] = {}
    lines = text.splitlines()
    for i, line in enumerate(lines):
        for m in GC_GAME_RE.finditer(line):
            game_id = m.group(1)
            window = " ".join(lines[max(0, i - 3): i + 4])
            if COMPLETED_RE.search(window):
                games.setdefault(game_id, window.strip())
    return [{"game_id": gid, "context": ctx} for gid, ctx in games.items()]


def parse_plays(game_id: str, plays_payload: dict) -> list[dict]:
    """Best-effort parse of a plays page into structured rows.

    Heuristics:
      * Track the most recent inning header (e.g. "Top of the 1st").
      * For each subsequent line that contains a play-result keyword,
        emit a row with whatever score / RBI we can pick out of the line.

    Refine once a real probe sample is available — the gc.com plays feed
    is React-rendered, so it may also be worth using
    `nimble extract --network-capture` to grab the underlying JSON API
    response directly and skip text parsing entirely.
    """
    text = page_text(plays_payload)
    rows: list[dict] = []
    inning = ""
    half = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = INNING_RE.search(line)
        if m and len(line) <= 40:
            half_token = m.group(1).lower()
            half = "top" if half_token in ("top", "t") else "bottom"
            inning = m.group(2)
            continue
        if not PLAY_RESULT_RE.search(line):
            continue
        score = SCORE_RE.search(line)
        rbi = RBI_RE.search(line)
        result = PLAY_RESULT_RE.search(line)
        rows.append({
            "game_id": game_id,
            "game_url": GC_GAME_URL.format(game_id=game_id),
            "inning": inning,
            "half": half,
            "batter": "",
            "pitcher": "",
            "result": result.group(1).lower() if result else "",
            "rbi": rbi.group(1) if rbi else "",
            "score_away": score.group(1) if score else "",
            "score_home": score.group(2) if score else "",
            "description": line,
        })
    return rows


def write_csv(rows: list[dict], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PLAY_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def cmd_probe(args: argparse.Namespace) -> None:
    payload = nimble_extract(args.url, render=not args.no_render)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {args.out} ({args.out.stat().st_size} bytes)")


def cmd_game(args: argparse.Namespace) -> None:
    m = GC_GAME_RE.search(args.url)
    if not m:
        sys.exit(f"Could not extract game id from URL: {args.url}")
    game_id = m.group(1)
    payload = nimble_extract(GC_GAME_PLAYS_URL.format(game_id=game_id))
    rows = parse_plays(game_id, payload)
    write_csv(rows, args.out)
    print(f"Wrote {len(rows)} plays for game {game_id} to {args.out}")


def cmd_team(args: argparse.Namespace) -> None:
    schedule = nimble_extract(args.url)
    if args.dump_schedule:
        Path(args.dump_schedule).write_text(json.dumps(schedule, indent=2))
        print(f"Dumped schedule payload to {args.dump_schedule}")
    games = find_completed_games(schedule)
    if not games:
        sys.exit(
            "No completed games detected. Run `probe` against the schedule "
            "URL and inspect the output, then tune find_completed_games()."
        )
    print(f"Found {len(games)} completed games: "
          f"{', '.join(g['game_id'] for g in games)}")
    all_rows: list[dict] = []
    for game in games:
        plays_url = GC_GAME_PLAYS_URL.format(game_id=game["game_id"])
        try:
            payload = nimble_extract(plays_url)
        except SystemExit as e:
            print(f"  skip {game['game_id']}: {e}", file=sys.stderr)
            continue
        rows = parse_plays(game["game_id"], payload)
        print(f"  {game['game_id']}: {len(rows)} plays")
        all_rows.extend(rows)
    write_csv(all_rows, args.out)
    print(f"Wrote {len(all_rows)} total plays across "
          f"{len(games)} games to {args.out}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    p_team = sub.add_parser("team", help="Fetch all completed games from a schedule")
    p_team.add_argument("--url", required=True)
    p_team.add_argument("--out", default=Path("plays.csv"), type=Path)
    p_team.add_argument("--dump-schedule", help="Optional path to save raw schedule JSON")
    p_team.set_defaults(func=cmd_team)

    p_game = sub.add_parser("game", help="Fetch one game's plays")
    p_game.add_argument("--url", required=True)
    p_game.add_argument("--out", default=Path("plays.csv"), type=Path)
    p_game.set_defaults(func=cmd_game)

    p_probe = sub.add_parser("probe", help="Dump raw Nimble response for a URL")
    p_probe.add_argument("--url", required=True)
    p_probe.add_argument("--out", default=Path("probe.json"), type=Path)
    p_probe.add_argument("--no-render", action="store_true")
    p_probe.set_defaults(func=cmd_probe)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
