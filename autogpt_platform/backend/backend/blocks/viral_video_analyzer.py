"""
Viral video analyzer + PDF report blocks.

`ViralVideoAnalyzerBlock` produces a structured short-form-video performance
report - hook/retention scores, weak-moment timestamps, and concrete editing
recommendations - using one of two engines:

  - `llm`:    sends textual context (transcript, scene description, brief) to
              a multimodal LLM via `AIStructuredResponseGeneratorBlock`.
  - `tribe`:  POSTs the same context to an external TRIBE v2 inference service
              and expects a JSON response with the same fields.

`ViralVideoReportPDFBlock` renders a report dict (typically the `report`
output of the analyzer) to a PDF file. Inspired by the `pdf_report.py` layer
of the TRIBE Review MVP.

`VideoToBriefBlock` turns a video file (URL, data URI, or local path) into
the textual brief the analyzer expects: transcript (on-screen text) and
scene-by-scene description with timestamps. Uses moviepy for frame sampling
and Anthropic Claude vision in a single multimodal call.
"""

import base64
import io
import logging
from enum import Enum
from typing import Any

import anthropic
from fpdf import FPDF
from pydantic import BaseModel, SecretStr, model_validator

from backend.blocks.llm import (
    TEST_CREDENTIALS,
    TEST_CREDENTIALS_INPUT,
    AIBlockBase,
    AICredentials,
    AICredentialsField,
    AIStructuredResponseGeneratorBlock,
    LlmModel,
)
from backend.data.block import Block, BlockCategory, BlockOutput, BlockSchema
from backend.data.model import APIKeyCredentials, SchemaField
from backend.util import json
from backend.util.file import get_exec_file_path, store_media_file
from backend.util.request import Requests
from backend.util.type import MediaFileType

logger = logging.getLogger(__name__)


class AnalysisEngine(str, Enum):
    LLM = "llm"
    TRIBE = "tribe"


class TargetPlatform(str, Enum):
    TIKTOK = "tiktok"
    INSTAGRAM_REELS = "instagram_reels"
    YOUTUBE_SHORTS = "youtube_shorts"
    GENERIC = "generic"


class VideoCut(BaseModel):
    label: str = ""
    video_url: str = ""
    transcript: str = ""
    description: str = ""


_REPORT_FORMAT: dict[str, str] = {
    "summary": "One-paragraph overall assessment of the video's viral potential.",
    "overall_score": "Integer 0-100 estimating overall short-form ad strength.",
    "hook_score": "Integer 0-100 rating the first 3 seconds (attention capture).",
    "retention_score": "Integer 0-100 estimating viewer retention through the cut.",
    "clarity_score": "Integer 0-100 rating message clarity and CTA strength.",
    "weak_moments": (
        "Array of objects: "
        "{timestamp_seconds: number, issue: string, suggested_fix: string}. "
        "Identify the specific seconds where viewers are most likely to drop off."
    ),
    "strong_moments": (
        "Array of objects: {timestamp_seconds: number, why: string}. "
        "Moments that are working and should be preserved or amplified."
    ),
    "recommendations": (
        "Array of short, concrete editing suggestions a creator can act on "
        "immediately (re-cut, re-shoot, change copy, etc.)."
    ),
    "comparison": (
        "Object {winner: string, reasoning: string, per_cut_notes: object} "
        "when multiple cuts were provided; otherwise null."
    ),
}


def _cut_payload(cut: VideoCut) -> dict[str, str]:
    return {
        "label": cut.label,
        "video_url": cut.video_url,
        "transcript": cut.transcript,
        "description": cut.description,
    }


class ViralVideoAnalyzerBlock(AIBlockBase):
    """Analyze a short-form video ad and return a structured performance report."""

    class Input(BlockSchema):
        credentials: AICredentials = AICredentialsField()
        model: LlmModel = SchemaField(
            title="LLM Model",
            default=LlmModel.GPT4O,
            description=(
                "Multimodal LLM used to analyze the video context. "
                "Gemini 2.5 Pro / Flash work well for long transcripts. "
                "Ignored when analysis_engine = tribe."
            ),
            advanced=False,
        )
        analysis_engine: AnalysisEngine = SchemaField(
            title="Analysis Engine",
            default=AnalysisEngine.LLM,
            description=(
                "`llm` runs the analysis through the selected LLM. "
                "`tribe` POSTs the context to an external TRIBE v2 inference "
                "service at `tribe_endpoint_url`."
            ),
        )
        tribe_endpoint_url: str = SchemaField(
            title="TRIBE Endpoint URL",
            default="",
            description=(
                "Base URL of an external TRIBE v2 inference service. "
                "The block POSTs to `{url}/analyze`. "
                "Required when analysis_engine = tribe."
            ),
            advanced=True,
        )
        tribe_api_key: SecretStr = SchemaField(
            title="TRIBE API Key",
            default=SecretStr(""),
            description=(
                "Optional bearer token sent as `Authorization: Bearer ...` "
                "to the TRIBE endpoint."
            ),
            advanced=True,
        )
        tribe_timeout_seconds: int = SchemaField(
            title="TRIBE Timeout (s)",
            default=600,
            description="Request timeout for the TRIBE endpoint.",
            advanced=True,
            ge=1,
        )

        video_url: str = SchemaField(
            default="",
            description="URL of the primary video to analyze.",
        )
        transcript: str = SchemaField(
            default="",
            description="Verbatim transcript of the video's spoken/on-screen text.",
        )
        video_description: str = SchemaField(
            default="",
            description=(
                "Scene-by-scene description of the video "
                "(visuals, cuts, on-screen captions, pacing)."
            ),
        )
        duration_seconds: float = SchemaField(
            default=0.0,
            description="Video duration in seconds (helps calibrate timestamps).",
        )

        goal: str = SchemaField(
            default="",
            description="What the ad is selling and what success looks like.",
        )
        target_audience: str = SchemaField(
            default="",
            description="Who the ad is for (demographics, interests, pain points).",
        )
        platform: TargetPlatform = SchemaField(
            default=TargetPlatform.GENERIC,
            description="Target platform - shapes recommendations.",
        )

        comparison_cuts: list[VideoCut] = SchemaField(
            default_factory=list,
            description=(
                "Optional 1-3 alternate cuts to compare against the primary video. "
                "When provided, the report will include a `comparison` section "
                "with a winner and per-cut notes."
            ),
        )

        @model_validator(mode="after")
        def _require_some_context(self):
            if not (self.video_url or self.transcript or self.video_description):
                raise ValueError(
                    "Provide at least one of: video_url, transcript, video_description."
                )
            if len(self.comparison_cuts) > 3:
                raise ValueError("comparison_cuts supports up to 3 alternate cuts.")
            if (
                self.analysis_engine == AnalysisEngine.TRIBE
                and not self.tribe_endpoint_url
            ):
                raise ValueError(
                    "tribe_endpoint_url is required when analysis_engine = tribe."
                )
            return self

    class Output(BlockSchema):
        report: dict[str, Any] = SchemaField(
            description="Full structured analysis report."
        )
        overall_score: int = SchemaField(description="Overall score 0-100.")
        hook_score: int = SchemaField(description="Hook (first 3s) score 0-100.")
        retention_score: int = SchemaField(description="Retention score 0-100.")
        weak_moments: list[dict[str, Any]] = SchemaField(
            description="Timestamped weak moments with suggested fixes."
        )
        recommendations: list[str] = SchemaField(
            description="Flat list of concrete editing suggestions."
        )
        comparison_winner: str = SchemaField(
            description="Label of the winning cut when comparing, else empty."
        )
        prompt: list = SchemaField(description="Prompt sent to the language model.")
        error: str = SchemaField(description="Error message if the analysis failed.")

    def __init__(self):
        super().__init__(
            id="e8255ac1-af5f-4a7a-9f83-9e521bb0185d",
            description=(
                "Analyzes a short-form video ad and returns hook/retention "
                "scores, weak-moment timestamps, and concrete editing "
                "recommendations. Optionally compares 2-4 cuts. "
                "Supports an LLM engine and an external TRIBE v2 endpoint."
            ),
            categories={BlockCategory.AI, BlockCategory.MARKETING},
            input_schema=ViralVideoAnalyzerBlock.Input,
            output_schema=ViralVideoAnalyzerBlock.Output,
            test_input={
                "credentials": TEST_CREDENTIALS_INPUT,
                "model": LlmModel.GPT4O,
                "transcript": "Tired of slow mornings? Try BrewBot.",
                "video_description": (
                    "0-1s: close-up of yawning person. "
                    "1-3s: BrewBot logo whoosh. "
                    "3-12s: product demo. "
                    "12-15s: CTA card 'Order today'."
                ),
                "duration_seconds": 15.0,
                "goal": "Drive BrewBot pre-orders from coffee enthusiasts.",
                "target_audience": "Remote workers 25-40 who buy specialty coffee.",
                "platform": TargetPlatform.TIKTOK,
            },
            test_credentials=TEST_CREDENTIALS,
            test_output=[
                ("report", dict),
                ("overall_score", 72),
                ("hook_score", 60),
                ("retention_score", 75),
                ("weak_moments", list),
                ("recommendations", list),
                ("comparison_winner", ""),
                ("prompt", list),
            ],
            test_mock={
                "_analyze_with_llm": lambda *args, **kwargs: {
                    "summary": "Solid demo with a weak hook.",
                    "overall_score": 72,
                    "hook_score": 60,
                    "retention_score": 75,
                    "clarity_score": 80,
                    "weak_moments": [
                        {
                            "timestamp_seconds": 0.5,
                            "issue": "Yawn opener fails to stop the scroll.",
                            "suggested_fix": "Lead with the product reveal and a bold claim.",
                        }
                    ],
                    "strong_moments": [
                        {"timestamp_seconds": 3.0, "why": "Clear product reveal."}
                    ],
                    "recommendations": [
                        "Move the BrewBot reveal to 0s.",
                        "Add a punchier CTA caption.",
                    ],
                    "comparison": None,
                },
            },
        )

    def _build_cut_block(self, cut: VideoCut, index: int) -> str:
        header = f"## Cut {index}: {cut.label or f'cut_{index}'}"
        parts = [header]
        if cut.video_url:
            parts.append(f"- video_url: {cut.video_url}")
        if cut.transcript:
            parts.append(f"- transcript:\n{cut.transcript}")
        if cut.description:
            parts.append(f"- scene description:\n{cut.description}")
        return "\n".join(parts)

    def _build_user_prompt(self, input_data: "ViralVideoAnalyzerBlock.Input") -> str:
        sections: list[str] = []

        meta_lines = [f"- platform: {input_data.platform.value}"]
        if input_data.duration_seconds:
            meta_lines.append(f"- duration_seconds: {input_data.duration_seconds}")
        if input_data.goal:
            meta_lines.append(f"- goal: {input_data.goal}")
        if input_data.target_audience:
            meta_lines.append(f"- target_audience: {input_data.target_audience}")
        sections.append("# Brief\n" + "\n".join(meta_lines))

        primary = VideoCut(
            label="primary",
            video_url=input_data.video_url,
            transcript=input_data.transcript,
            description=input_data.video_description,
        )
        sections.append("# Primary cut\n" + self._build_cut_block(primary, 0))

        if input_data.comparison_cuts:
            comparison_blocks = [
                self._build_cut_block(cut, idx + 1)
                for idx, cut in enumerate(input_data.comparison_cuts)
            ]
            sections.append("# Comparison cuts\n" + "\n\n".join(comparison_blocks))
            sections.append(
                "Pick a winner across all cuts and explain why in `comparison`."
            )
        else:
            sections.append("Set `comparison` to null (only one cut provided).")

        return "\n\n".join(sections)

    async def _analyze_with_llm(
        self,
        input_data: "ViralVideoAnalyzerBlock.Input",
        credentials: APIKeyCredentials,
    ) -> dict[str, Any]:
        sys_prompt = (
            "You are an expert short-form video performance analyst. "
            "Given a brief and a description of one or more video cuts, predict "
            "viewer behaviour and produce a structured report. Be concrete, "
            "reference timestamps in seconds, and prefer specific edits over "
            "vague advice. When data is missing, infer conservatively and say so "
            "in the summary."
        )

        llm_input = AIStructuredResponseGeneratorBlock.Input(
            prompt=self._build_user_prompt(input_data),
            sys_prompt=sys_prompt,
            expected_format=_REPORT_FORMAT,
            model=input_data.model,
            credentials=input_data.credentials,
        )

        llm_block = AIStructuredResponseGeneratorBlock()
        result = await llm_block.run_once(
            llm_input, "response", credentials=credentials
        )
        self.merge_llm_stats(llm_block)
        return result

    async def _analyze_with_tribe(
        self, input_data: "ViralVideoAnalyzerBlock.Input"
    ) -> dict[str, Any]:
        endpoint = input_data.tribe_endpoint_url.rstrip("/") + "/analyze"
        headers = {"Content-Type": "application/json"}
        api_key = input_data.tribe_api_key.get_secret_value()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        primary = VideoCut(
            label="primary",
            video_url=input_data.video_url,
            transcript=input_data.transcript,
            description=input_data.video_description,
        )
        payload = {
            "platform": input_data.platform.value,
            "duration_seconds": input_data.duration_seconds,
            "goal": input_data.goal,
            "target_audience": input_data.target_audience,
            "primary_cut": _cut_payload(primary),
            "comparison_cuts": [_cut_payload(c) for c in input_data.comparison_cuts],
            "expected_format": _REPORT_FORMAT,
        }

        response = await Requests().post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=input_data.tribe_timeout_seconds,
        )
        if response.status >= 400:
            raise RuntimeError(
                f"TRIBE endpoint returned {response.status}: {response.text[:500]}"
            )

        try:
            body = response.json()
        except Exception as e:
            raise ValueError(f"TRIBE endpoint returned non-JSON: {e}")

        if (
            isinstance(body, dict)
            and "report" in body
            and isinstance(body["report"], dict)
        ):
            return body["report"]
        if isinstance(body, dict):
            return body
        raise ValueError(f"Unexpected TRIBE response shape: {type(body).__name__}")

    async def run(
        self,
        input_data: Input,
        *,
        credentials: APIKeyCredentials,
        **kwargs,
    ) -> BlockOutput:
        if input_data.analysis_engine == AnalysisEngine.TRIBE:
            report = await self._analyze_with_tribe(input_data)
        else:
            report = await self._analyze_with_llm(input_data, credentials)

        if not isinstance(report, dict):
            try:
                report = json.loads(report)
            except Exception as e:
                raise ValueError(f"Analyzer returned non-JSON report: {e}")

        comparison = report.get("comparison") or {}
        winner = comparison.get("winner", "") if isinstance(comparison, dict) else ""

        yield "report", report
        yield "overall_score", int(report.get("overall_score", 0) or 0)
        yield "hook_score", int(report.get("hook_score", 0) or 0)
        yield "retention_score", int(report.get("retention_score", 0) or 0)
        yield "weak_moments", list(report.get("weak_moments", []) or [])
        yield "recommendations", list(report.get("recommendations", []) or [])
        yield "comparison_winner", winner
        yield "prompt", self.prompt


# ---------------------------------------------------------------------------
# PDF report block
# ---------------------------------------------------------------------------


def _ascii_safe(text: str) -> str:
    """fpdf2's default Helvetica fonts are Latin-1 only; strip anything else."""
    return text.encode("latin-1", "replace").decode("latin-1")


def _render_report_pdf(report: dict[str, Any], title: str, subtitle: str) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    def line(h: float, text: str) -> None:
        pdf.multi_cell(0, h, _ascii_safe(text), new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 20)
    line(10, title)
    if subtitle:
        pdf.set_font("Helvetica", "I", 12)
        line(7, subtitle)
    pdf.ln(2)

    summary = str(report.get("summary", "") or "")
    if summary:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Summary", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        line(6, summary)
        pdf.ln(2)

    score_keys = [
        ("Overall", "overall_score"),
        ("Hook", "hook_score"),
        ("Retention", "retention_score"),
        ("Clarity", "clarity_score"),
    ]
    scores = [(label, report.get(key)) for label, key in score_keys]
    scores = [(label, val) for label, val in scores if val is not None]
    if scores:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Scores", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        for label, value in scores:
            pdf.cell(
                0,
                6,
                _ascii_safe(f"  {label}: {value}/100"),
                new_x="LMARGIN",
                new_y="NEXT",
            )
        pdf.ln(2)

    weak_moments = report.get("weak_moments") or []
    if isinstance(weak_moments, list) and weak_moments:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Weak moments", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        for moment in weak_moments:
            if not isinstance(moment, dict):
                continue
            ts = moment.get("timestamp_seconds", "?")
            issue = moment.get("issue", "")
            fix = moment.get("suggested_fix", "")
            pdf.set_font("Helvetica", "B", 11)
            line(6, f"  t={ts}s  {issue}")
            pdf.set_font("Helvetica", "", 11)
            if fix:
                line(6, f"    Fix: {fix}")
        pdf.ln(2)

    strong_moments = report.get("strong_moments") or []
    if isinstance(strong_moments, list) and strong_moments:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Strong moments", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        for moment in strong_moments:
            if not isinstance(moment, dict):
                continue
            ts = moment.get("timestamp_seconds", "?")
            why = moment.get("why", "")
            line(6, f"  t={ts}s  {why}")
        pdf.ln(2)

    recommendations = report.get("recommendations") or []
    if isinstance(recommendations, list) and recommendations:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Recommendations", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        for idx, rec in enumerate(recommendations, start=1):
            line(6, f"  {idx}. {rec}")
        pdf.ln(2)

    comparison = report.get("comparison")
    if isinstance(comparison, dict) and comparison:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Comparison", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        winner = comparison.get("winner", "")
        if winner:
            line(6, f"  Winner: {winner}")
        reasoning = comparison.get("reasoning", "")
        if reasoning:
            line(6, f"  Reasoning: {reasoning}")
        per_cut = comparison.get("per_cut_notes") or {}
        if isinstance(per_cut, dict):
            for label, notes in per_cut.items():
                pdf.set_font("Helvetica", "B", 11)
                line(6, f"  {label}")
                pdf.set_font("Helvetica", "", 11)
                line(6, f"    {notes}")

    output = pdf.output()
    return bytes(output)


class ViralVideoReportPDFBlock(Block):
    """Render a viral-video analysis report (dict) to a PDF file."""

    class Input(BlockSchema):
        report: dict[str, Any] = SchemaField(
            description=(
                "Structured report dict, typically the `report` output of "
                "ViralVideoAnalyzerBlock."
            ),
        )
        title: str = SchemaField(
            default="Viral Video Analysis Report",
            description="Title shown at the top of the PDF.",
        )
        subtitle: str = SchemaField(
            default="",
            description="Optional subtitle (e.g. campaign name, date).",
        )
        return_content: bool = SchemaField(
            default=False,
            description=(
                "If true, return the PDF as a base64 data URI. "
                "Otherwise return a relative path inside the execution's "
                "media folder."
            ),
            advanced=True,
        )

    class Output(BlockSchema):
        pdf_path: MediaFileType = SchemaField(
            description=(
                "PDF file path (relative to execution media folder) or "
                "data URI when return_content = true."
            ),
        )
        error: str = SchemaField(description="Error message if rendering failed.")

    def __init__(self):
        super().__init__(
            id="b9f0c4d1-3e2a-4f8b-9c6e-7a1d5b8e9f02",
            description=(
                "Renders a viral-video analysis report (the `report` output "
                "of ViralVideoAnalyzerBlock) to a PDF file."
            ),
            categories={BlockCategory.MARKETING, BlockCategory.MULTIMEDIA},
            input_schema=ViralVideoReportPDFBlock.Input,
            output_schema=ViralVideoReportPDFBlock.Output,
            test_input={
                "report": {
                    "summary": "Solid demo with a weak hook.",
                    "overall_score": 72,
                    "hook_score": 60,
                    "retention_score": 75,
                    "clarity_score": 80,
                    "weak_moments": [
                        {
                            "timestamp_seconds": 0.5,
                            "issue": "Yawn opener fails to stop the scroll.",
                            "suggested_fix": "Lead with the product reveal.",
                        }
                    ],
                    "strong_moments": [
                        {"timestamp_seconds": 3.0, "why": "Clear product reveal."}
                    ],
                    "recommendations": [
                        "Move the BrewBot reveal to 0s.",
                        "Add a punchier CTA caption.",
                    ],
                    "comparison": None,
                },
                "title": "BrewBot ad - cut A",
                "subtitle": "TikTok 9x16 - 15s",
            },
            test_output=[
                (
                    "pdf_path",
                    lambda v: isinstance(v, str) and v.lower().endswith(".pdf"),
                ),
            ],
            test_mock={
                "_persist_pdf": lambda *args, **kwargs: "viral_report.pdf",
            },
        )

    async def _persist_pdf(
        self,
        pdf_bytes: bytes,
        graph_exec_id: str,
        user_id: str,
        return_content: bool,
    ) -> MediaFileType:
        import base64

        b64 = base64.b64encode(pdf_bytes).decode("ascii")
        data_uri = MediaFileType(f"data:application/pdf;base64,{b64}")
        return await store_media_file(
            graph_exec_id=graph_exec_id,
            file=data_uri,
            user_id=user_id,
            return_content=return_content,
        )

    async def run(
        self,
        input_data: Input,
        *,
        graph_exec_id: str,
        user_id: str,
        **kwargs,
    ) -> BlockOutput:
        pdf_bytes = _render_report_pdf(
            input_data.report, input_data.title, input_data.subtitle
        )
        pdf_path = await self._persist_pdf(
            pdf_bytes,
            graph_exec_id=graph_exec_id,
            user_id=user_id,
            return_content=input_data.return_content,
        )
        yield "pdf_path", pdf_path


# ---------------------------------------------------------------------------
# Video -> brief block
# ---------------------------------------------------------------------------


_BRIEF_PROMPT = (
    "You are preparing a brief for a short-form video performance analyst who "
    "cannot see the video. {n} frames sampled at the timestamps below are "
    "attached, in order. The video is {duration:.2f}s long.\n\n"
    "Timestamps (seconds): {timestamps}\n\n"
    "Return strictly JSON with these exact keys:\n"
    '  "transcript": every piece of on-screen text, captions, lower-thirds, '
    "and CTA copy you can read across the frames, concatenated in time order. "
    'If unreadable, write "(unreadable)".\n'
    '  "video_description": a scene-by-scene description with explicit '
    "timestamps in seconds. One short paragraph per frame, covering subjects, "
    "actions, framing, on-screen graphics, color/mood, and pacing cues.\n\n"
    "Output JSON only - no prose, no markdown fences."
)


class VideoToBriefBlock(Block):
    """Sample frames from a video and use Claude vision to produce a brief."""

    class Input(BlockSchema):
        video: MediaFileType = SchemaField(
            description=(
                "Video to analyze. Accepts a URL, a data URI, or a relative "
                "path inside the execution media folder."
            ),
        )
        credentials: AICredentials = AICredentialsField()
        model: LlmModel = SchemaField(
            title="Vision Model",
            default=LlmModel.CLAUDE_4_SONNET,
            description=(
                "Anthropic vision model used to caption frames. "
                "Must support image input (Claude 3.5+ / 4 Sonnet/Opus)."
            ),
            advanced=False,
        )
        frame_count: int = SchemaField(
            title="Frames",
            default=8,
            description=(
                "Number of evenly-spaced frames to sample. "
                "More frames = richer brief and higher cost."
            ),
            ge=2,
            le=20,
        )
        frame_max_dim: int = SchemaField(
            title="Max frame dimension (px)",
            default=720,
            description=(
                "Frames are resized so neither dimension exceeds this value, "
                "to keep the request payload small."
            ),
            advanced=True,
            ge=128,
            le=2048,
        )
        max_output_tokens: int = SchemaField(
            title="Max output tokens",
            default=2000,
            description="Upper bound on the model's response length.",
            advanced=True,
            ge=200,
        )
        extra_context: str = SchemaField(
            default="",
            description=(
                "Optional extra hints (e.g. brand, language, what to look for) "
                "appended to the prompt."
            ),
            advanced=True,
        )

    class Output(BlockSchema):
        transcript: str = SchemaField(
            description="On-screen text / captions / dialog, concatenated."
        )
        video_description: str = SchemaField(
            description="Scene-by-scene description with timestamps."
        )
        duration_seconds: float = SchemaField(
            description="Video duration in seconds (from the file)."
        )
        frames_sampled: int = SchemaField(
            description="How many frames were actually sent to the model."
        )
        error: str = SchemaField(description="Error message if extraction failed.")

    def __init__(self):
        super().__init__(
            id="4adb5d67-d53d-4af2-ba87-70df261093c5",
            description=(
                "Turns a video file into the transcript + scene description "
                "that ViralVideoAnalyzerBlock expects, by sampling frames and "
                "captioning them with a Claude vision model."
            ),
            categories={BlockCategory.AI, BlockCategory.MULTIMEDIA},
            input_schema=VideoToBriefBlock.Input,
            output_schema=VideoToBriefBlock.Output,
            test_input={
                "credentials": TEST_CREDENTIALS_INPUT,
                "video": "test_clip.mp4",
                "model": LlmModel.CLAUDE_4_SONNET,
                "frame_count": 4,
            },
            test_credentials=TEST_CREDENTIALS,
            test_output=[
                ("transcript", "Order today - 20% off"),
                (
                    "video_description",
                    "0.0s: yawning person. 5.0s: product reveal. 10.0s: CTA.",
                ),
                ("duration_seconds", 15.0),
                ("frames_sampled", 4),
            ],
            test_mock={
                "_localize_video": lambda *args, **kwargs: "/tmp/test_clip.mp4",
                "_extract_frames": lambda *args, **kwargs: (
                    [
                        (0.0, b"\xff\xd8\xff"),
                        (5.0, b"\xff\xd8\xff"),
                        (10.0, b"\xff\xd8\xff"),
                        (14.9, b"\xff\xd8\xff"),
                    ],
                    15.0,
                ),
                "_caption_frames": lambda *args, **kwargs: {
                    "transcript": "Order today - 20% off",
                    "video_description": (
                        "0.0s: yawning person. 5.0s: product reveal. 10.0s: CTA."
                    ),
                },
            },
        )

    def _extract_frames(
        self, local_video_path: str, frame_count: int, max_dim: int
    ) -> tuple[list[tuple[float, bytes]], float]:
        """Sync helper. Returns ([(timestamp_s, jpeg_bytes), ...], duration)."""
        from moviepy.video.io.VideoFileClip import VideoFileClip
        from PIL import Image

        with VideoFileClip(local_video_path) as clip:
            duration = float(clip.duration or 0.0)
            if duration <= 0:
                raise ValueError("Video has no readable duration.")

            n = min(frame_count, max(2, int(duration * 4)))
            timestamps = [duration * i / (n - 1) for i in range(n)]
            timestamps[-1] = max(0.0, min(duration - 0.05, timestamps[-1]))

            frames: list[tuple[float, bytes]] = []
            for t in timestamps:
                frame = clip.get_frame(t)
                img = Image.fromarray(frame)
                img.thumbnail((max_dim, max_dim))
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=82)
                frames.append((float(t), buf.getvalue()))

        return frames, duration

    async def _caption_frames(
        self,
        credentials: APIKeyCredentials,
        model: LlmModel,
        frames: list[tuple[float, bytes]],
        duration: float,
        extra_context: str,
        max_output_tokens: int,
    ) -> dict[str, str]:
        client = anthropic.AsyncAnthropic(
            api_key=credentials.api_key.get_secret_value()
        )

        timestamps = [round(t, 2) for t, _ in frames]
        prompt_text = _BRIEF_PROMPT.format(
            n=len(frames),
            duration=duration,
            timestamps=", ".join(f"{t}" for t in timestamps),
        )
        if extra_context:
            prompt_text += "\n\nAdditional context: " + extra_context

        content: list[dict[str, Any]] = [{"type": "text", "text": prompt_text}]
        for ts, jpeg in frames:
            content.append(
                {
                    "type": "text",
                    "text": f"Frame at t={ts:.2f}s:",
                }
            )
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.b64encode(jpeg).decode("ascii"),
                    },
                }
            )

        response = await client.messages.create(
            model=model.value,
            max_tokens=max_output_tokens,
            messages=[{"role": "user", "content": content}],
        )

        raw = "".join(
            block.text for block in response.content if getattr(block, "text", None)
        ).strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        try:
            parsed = json.loads(raw)
        except Exception as e:
            raise ValueError(f"Vision model returned non-JSON brief: {e}: {raw[:300]}")
        if not isinstance(parsed, dict):
            raise ValueError(f"Expected dict, got {type(parsed).__name__}")
        return {
            "transcript": str(parsed.get("transcript", "") or ""),
            "video_description": str(parsed.get("video_description", "") or ""),
        }

    async def _localize_video(
        self, file: MediaFileType, graph_exec_id: str, user_id: str
    ) -> str:
        local_path_rel = await store_media_file(
            graph_exec_id=graph_exec_id,
            file=file,
            user_id=user_id,
        )
        return get_exec_file_path(graph_exec_id, local_path_rel)

    async def run(
        self,
        input_data: Input,
        *,
        credentials: APIKeyCredentials,
        graph_exec_id: str,
        user_id: str,
        **kwargs,
    ) -> BlockOutput:
        absolute_path = await self._localize_video(
            input_data.video, graph_exec_id=graph_exec_id, user_id=user_id
        )

        frames, duration = self._extract_frames(
            absolute_path, input_data.frame_count, input_data.frame_max_dim
        )

        brief = await self._caption_frames(
            credentials=credentials,
            model=input_data.model,
            frames=frames,
            duration=duration,
            extra_context=input_data.extra_context,
            max_output_tokens=input_data.max_output_tokens,
        )

        yield "transcript", brief["transcript"]
        yield "video_description", brief["video_description"]
        yield "duration_seconds", duration
        yield "frames_sampled", len(frames)
