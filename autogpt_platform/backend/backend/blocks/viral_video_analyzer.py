"""
Viral video analyzer block.

Analyzes short-form video ads (TikTok / Reels / Shorts style) and produces a
structured report with hook/retention scores, weak-moment timestamps, and
concrete editing recommendations. Optionally compares 2-4 cuts side by side
and picks a winner.

Inspired by the TRIBE Review MVP (which uses Meta's TRIBE v2 neural model).
This block uses a multimodal LLM to do the analysis from textual context
(transcript, scene description, metadata). A `TRIBE` engine value is reserved
for a future external endpoint and currently raises NotImplementedError.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, model_validator

from backend.blocks.llm import (
    TEST_CREDENTIALS,
    TEST_CREDENTIALS_INPUT,
    AIBlockBase,
    AICredentials,
    AICredentialsField,
    AIStructuredResponseGeneratorBlock,
    LlmModel,
)
from backend.data.block import BlockCategory, BlockOutput, BlockSchema
from backend.data.model import APIKeyCredentials, SchemaField
from backend.util import json


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


class ViralVideoAnalyzerBlock(AIBlockBase):
    """Analyze a short-form video ad and return a structured performance report."""

    class Input(BlockSchema):
        credentials: AICredentials = AICredentialsField()
        model: LlmModel = SchemaField(
            title="LLM Model",
            default=LlmModel.GPT4O,
            description=(
                "Multimodal LLM used to analyze the video context. "
                "Gemini 2.5 Pro / Flash work well for long transcripts."
            ),
            advanced=False,
        )
        analysis_engine: AnalysisEngine = SchemaField(
            title="Analysis Engine",
            default=AnalysisEngine.LLM,
            description=(
                "`llm` runs the analysis through the selected LLM. "
                "`tribe` is reserved for an external TRIBE v2 inference endpoint "
                "and is not yet implemented."
            ),
        )
        tribe_endpoint_url: str = SchemaField(
            title="TRIBE Endpoint URL",
            default="",
            description=(
                "URL of an external TRIBE v2 inference service. "
                "Only used when analysis_engine = tribe."
            ),
            advanced=True,
        )

        video_url: str = SchemaField(
            default="",
            description="URL of the primary video to analyze (informational).",
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
                "recommendations. Optionally compares 2-4 cuts."
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
        raise NotImplementedError(
            "TRIBE inference engine is not implemented in this block. "
            "Wire `tribe_endpoint_url` to a hosted TRIBE v2 service first."
        )

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
