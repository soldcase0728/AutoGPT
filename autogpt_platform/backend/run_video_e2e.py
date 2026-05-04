"""End-to-end test script for the viral video analyzer pipeline.

Runs:  VideoToBriefBlock -> ViralVideoAnalyzerBlock -> ViralVideoReportPDFBlock

Usage:
    cd autogpt_platform/backend
    poetry install
    poetry run prisma generate          # one-time
    ANTHROPIC_API_KEY='sk-ant-...' \\
        poetry run python run_video_e2e.py <video-url-or-path> [--platform tiktok]

The video argument can be:
    - an https:// URL (use `?dl=1` for Dropbox share links)
    - a data: URI
    - a path relative to the execution media folder

Edit GOAL / AUDIENCE / PLATFORM below for sharper analyzer output.
"""

import argparse
import asyncio
import os
import sys

from pydantic import SecretStr

from backend.data.block import get_blocks  # noqa: F401  resolves circular import
from backend.blocks.llm import LlmModel
from backend.blocks.viral_video_analyzer import (
    AnalysisEngine,
    TargetPlatform,
    ViralVideoAnalyzerBlock,
    VideoToBriefBlock,
    _render_report_pdf,
)
from backend.data.model import APIKeyCredentials


# --- Edit these for sharper results ------------------------------------------
GOAL = ""  # one sentence: what the ad is selling / what success looks like
AUDIENCE = ""  # one sentence: who the ad is for
DEFAULT_PLATFORM = TargetPlatform.GENERIC
# -----------------------------------------------------------------------------


def _build_credentials() -> APIKeyCredentials:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ERROR: ANTHROPIC_API_KEY is not set in the environment.")
    return APIKeyCredentials(
        id="11111111-1111-4111-9111-111111111111",
        provider="anthropic",
        api_key=SecretStr(api_key),
        title="anthropic",
        expires_at=None,
    )


async def main(video: str, platform: TargetPlatform) -> int:
    creds = _build_credentials()
    cred_input = {
        "provider": creds.provider,
        "id": creds.id,
        "type": creds.type,
        "title": creds.title,
    }
    ctx = {"graph_exec_id": "local-exec-001", "user_id": "local-user-001"}

    print(f"=== Step 1/3: VideoToBriefBlock on {video}")
    brief: dict = {}
    async for k, v in VideoToBriefBlock().run(
        VideoToBriefBlock.Input(
            video=video,
            credentials=cred_input,
            model=LlmModel.CLAUDE_4_SONNET,
            frame_count=8,
            frame_max_dim=720,
        ),
        credentials=creds,
        **ctx,
    ):
        brief[k] = v
    print(
        f"   duration={brief['duration_seconds']:.1f}s  "
        f"frames_sampled={brief['frames_sampled']}"
    )

    print("=== Step 2/3: ViralVideoAnalyzerBlock")
    out: dict = {}
    async for k, v in ViralVideoAnalyzerBlock().run(
        ViralVideoAnalyzerBlock.Input(
            credentials=cred_input,
            model=LlmModel.CLAUDE_4_SONNET,
            analysis_engine=AnalysisEngine.LLM,
            video_url=video,
            transcript=brief["transcript"],
            video_description=brief["video_description"],
            duration_seconds=brief["duration_seconds"],
            goal=GOAL,
            target_audience=AUDIENCE,
            platform=platform,
        ),
        credentials=creds,
    ):
        out[k] = v

    rep = out["report"]
    print(
        f"   overall={out['overall_score']}/100  "
        f"hook={out['hook_score']}/100  "
        f"retention={out['retention_score']}/100  "
        f"clarity={rep.get('clarity_score', '?')}/100"
    )

    print("=== Step 3/3: ViralVideoReportPDFBlock")
    pdf_path = "/tmp/viral_report.pdf"
    pdf_bytes = _render_report_pdf(rep, "Video analysis", "")
    with open(pdf_path, "wb") as f:
        f.write(pdf_bytes)
    print(f"   PDF: {pdf_path} ({len(pdf_bytes)} bytes)")

    print("\n--- Summary ---")
    print(rep.get("summary", ""))
    if out["weak_moments"]:
        print("\n--- Weak moments ---")
        for m in out["weak_moments"]:
            ts = m.get("timestamp_seconds", "?")
            print(f"  t={ts}s  {m.get('issue', '')}")
            if m.get("suggested_fix"):
                print(f"          fix: {m['suggested_fix']}")
    if out["recommendations"]:
        print("\n--- Recommendations ---")
        for i, r in enumerate(out["recommendations"], 1):
            print(f"  {i}. {r}")

    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the viral video analyzer pipeline."
    )
    parser.add_argument("video", help="Video URL, data URI, or relative path.")
    parser.add_argument(
        "--platform",
        choices=[p.value for p in TargetPlatform],
        default=DEFAULT_PLATFORM.value,
        help="Target platform (default: %(default)s).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    sys.exit(asyncio.run(main(args.video, TargetPlatform(args.platform))))
