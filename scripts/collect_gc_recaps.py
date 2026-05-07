#!/usr/bin/env python3
"""Run the published Nimble "GameChanger Game Recap" agent and write CSV.

The agent is published in Nimble as `gc_game_recap_2026_05_07_byci0oy1` and
returns one recap row per game (date, teams, score, winner, location,
innings, summary, highlights).

Modes:
  recap   Run the agent on a single recap URL.
  team    Walk a team schedule URL, find every completed game, build its
          /recap URL, run the agent on each, and aggregate to CSV.

Usage:
  export NIMBLE_API_KEY=...
  python scripts/collect_gc_recaps.py recap \\
      --url "https://web.gc.com/teams/.../schedule/<game-uuid>/recap" \\
      --out recaps.csv

  python scripts/collect_gc_recaps.py team \\
      --url "https://web.gc.com/teams/<team-id>/<slug>/schedule" \\
      --out recaps.csv

Both endpoints we hit (https://sdk.nimbleway.com/v1/agents/run and
.../v1/extract) require an active Nimble API key with Web Data API access.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

NIMBLE_AGENT_ID = "gc_game_recap_2026_05_07_byci0oy1"
NIMBLE_AGENT_RUN_URL = "https://sdk.nimbleway.com/v1/agents/run"
NIMBLE_EXTRACT_URL = "https://sdk.nimbleway.com/v1/extract"
REQUEST_TIMEOUT_S = 180

RECAP_FIELDS = [
    "url",
    "game_date",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
    "winner",
    "location",
    "innings",
    "game_summary",
    "highlights",
]

GAME_UUID_RE = re.compile(
    r"/schedule/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
)
SCHEDULE_URL_RE = re.compile(
    r"^(https?://web\.gc\.com/teams/[^/]+/[^/]+)/schedule/?$"
)
COMPLETED_HINT_RE = re.compile(
    r"(final|completed|\bw\s*\d+\s*-\s*\d+|\bl\s*\d+\s*-\s*\d+|\bt\s*\d+\s*-\s*\d+)",
    re.IGNORECASE,
)


def post_json(url: str, body: dict, api_key: str) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{url} -> {e.code}: {msg}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"{url} -> network error: {e}") from None


def run_agent(api_key: str, target_url: str) -> dict:
    return post_json(
        NIMBLE_AGENT_RUN_URL,
        {"agent": NIMBLE_AGENT_ID, "params": {"url": target_url}},
        api_key,
    )


def fetch_schedule_text(api_key: str, schedule_url: str) -> str:
    payload = post_json(
        NIMBLE_EXTRACT_URL,
        {"url": schedule_url, "render": True},
        api_key,
    )
    for path in (
        ("data", "markdown"),
        ("data", "html_content"),
        ("data", "html"),
        ("markdown",),
        ("html",),
    ):
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


def find_completed_recap_urls(schedule_url: str, page_text: str) -> list[str]:
    m = SCHEDULE_URL_RE.match(schedule_url.rstrip("/"))
    if not m:
        raise ValueError(f"Unexpected schedule URL shape: {schedule_url}")
    base = m.group(1)
    out: list[str] = []
    lines = page_text.splitlines()
    for i, line in enumerate(lines):
        for u in GAME_UUID_RE.finditer(line):
            window = " ".join(lines[max(0, i - 3): i + 4])
            if not COMPLETED_HINT_RE.search(window):
                continue
            recap = f"{base}/schedule/{u.group(1)}/recap"
            if recap not in out:
                out.append(recap)
    return out


def unwrap(payload: dict) -> dict:
    """Pull the actual result dict out of the agent response envelope."""
    for path in (("data",), ("result",), ("output",), ("results",)):
        node: Any = payload
        for key in path:
            if isinstance(node, dict) and key in node:
                node = node[key]
            else:
                node = None
                break
        if isinstance(node, dict):
            return node
    return payload


def to_row(target_url: str, payload: dict) -> dict:
    data = unwrap(payload)
    row = {f: data.get(f, "") for f in RECAP_FIELDS}
    row["url"] = target_url
    if isinstance(row["highlights"], list):
        row["highlights"] = " | ".join(str(h) for h in row["highlights"])
    if isinstance(row["game_summary"], list):
        row["game_summary"] = " | ".join(str(s) for s in row["game_summary"])
    return row


def write_csv(rows: list[dict], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RECAP_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def cmd_recap(args: argparse.Namespace, api_key: str) -> None:
    payload = run_agent(api_key, args.url)
    if args.raw:
        Path(args.raw).write_text(json.dumps(payload, indent=2))
    write_csv([to_row(args.url, payload)], args.out)
    print(f"Wrote 1 recap to {args.out}")


def cmd_team(args: argparse.Namespace, api_key: str) -> None:
    text = fetch_schedule_text(api_key, args.url)
    if args.dump_schedule:
        Path(args.dump_schedule).write_text(text)
    urls = find_completed_recap_urls(args.url, text)
    if not urls:
        sys.exit(
            "No completed games detected in schedule. Re-run with "
            "--dump-schedule to inspect what Nimble returned."
        )
    print(f"Found {len(urls)} completed games")
    rows: list[dict] = []
    for u in urls:
        try:
            payload = run_agent(api_key, u)
        except RuntimeError as e:
            print(f"  skip {u}: {e}", file=sys.stderr)
            continue
        rows.append(to_row(u, payload))
        print(f"  {u} ok")
    write_csv(rows, args.out)
    print(f"Wrote {len(rows)} recaps to {args.out}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    p_recap = sub.add_parser("recap", help="Run agent on a single recap URL")
    p_recap.add_argument("--url", required=True)
    p_recap.add_argument("--out", default=Path("recaps.csv"), type=Path)
    p_recap.add_argument("--raw", help="Optional path to dump raw agent JSON")
    p_recap.set_defaults(func=cmd_recap)

    p_team = sub.add_parser("team", help="Walk a schedule URL and run the agent for every completed game")
    p_team.add_argument("--url", required=True)
    p_team.add_argument("--out", default=Path("recaps.csv"), type=Path)
    p_team.add_argument("--dump-schedule", help="Optional path to dump the rendered schedule text")
    p_team.set_defaults(func=cmd_team)

    args = parser.parse_args()
    api_key = os.environ.get("NIMBLE_API_KEY")
    if not api_key:
        sys.exit("NIMBLE_API_KEY is not set")
    try:
        args.func(args, api_key)
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
