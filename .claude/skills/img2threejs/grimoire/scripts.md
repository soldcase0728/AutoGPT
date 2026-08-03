# Scripts Cheatsheet

All scripts are pure Python 3.10+ **standard library** — no pip install, no PIL/numpy, no
Playwright/Chromium. PNG read/write is done via `struct`/`zlib`. Run from the skill root so
paths resolve as `forge/<name>.py`. Non-zero exit = a gate failed; read the printed reasons.

Division of labor: **scripts enforce structure and package evidence; they never score visuals.**
The acceptance score always comes from the agent's own vision inspecting the comparison sheet.

## state.py and next.py

- `state.py init --state .img2threejs/state.json --reference IMG [--profile generic|cs2|character]`
  creates the local mandatory checklist. It refuses to overwrite existing state.
- `state.py status --state .img2threejs/state.json [--json]` reports the current step and loop limits.
- `state.py mark STEP... --state .img2threejs/state.json --evidence PATH` records completed evidence.
  Use `--status skipped --reason "..."` only when a step is genuinely not applicable.
- `next.py --state .img2threejs/state.json [spec.json]` is the mandatory start/resume gate. It
  derives correction counts from `reviewHistory` and exits 3 at the per-pass or total hard ceiling.

Defaults are 3 `refine-spec`/`refine-code` decisions per pass and 6 total. These are safety limits,
not targets; stop earlier on success, repeated defects, oscillation, or plateau.

The pass checklist is executable in dependency order: generate, render, Tier 1, multi-angle,
`orchestrate_passes.py check`, profile-specific review, AI review, then sync. The CS2 profile runs:

`stage4_review/cs2_review.py --manifest cs2-intake.json --metrics cs2-review-inputs.json --scene forge/tests/fixtures/knife_review_scene.json --out cs2-review.json`

The character profile requires the reconstruction/likeness contracts, landmark evidence, and an
explicit stylized-versus-projection route decision before pre-spec authoring.
Every profile also records a reference-suitability verdict, a projection-route decision, and a
material/PBR evidence decision. A non-applicable conditional gate must be skipped with a reason.

## stage1_intake/probe_image.py
`stage1_intake/probe_image.py <image>` — image type, dimensions, aspect ratio, obvious technical
issues. Metadata only; not a substitute for visual inspection.

## stage2_spec/new_pre_spec_assessment.py
`stage2_spec/new_pre_spec_assessment.py "Name" [--image IMG] [--complexity simple|moderate|complex|ultra-complex] --out assessment.json [--force]`
Emits a pre-spec assessment + `qualityContract` skeleton. Refine `--complexity` after looking at
the image. See `intake/quality_contract.md` for the scoring axes and contract checklist.

## stage2_spec/new_sculpt_spec.py
`stage2_spec/new_sculpt_spec.py "Name" [--image IMG] [--assessment assessment.json] --out object-sculpt-spec.json [--force]`
Starter `ObjectSculptSpec` (schema 2.0). With `--assessment` it seeds from the completed gate.
Always replace generic starter `featureReviewTargets` with real identity-defining systems.

## stage2_spec/validate_sculpt_spec.py
`stage2_spec/validate_sculpt_spec.py spec.json [--json] [--strict-quality]`
Normal: checks required fields, score ranges, material refs, component IDs, parent links,
transforms, primitive names (warnings allowed). `--strict-quality`: promotes quality warnings to
errors — blocks code gen when the spec is too shallow for its contract (min macro/meso/micro
counts, material layers, repetition systems, review viewpoints, non-generic feature targets,
material-pass locality, lighting-pass real lights). Fix per `intake/quality_contract.md`.

## stage3_build/orchestrate_passes.py
- `status spec.json` — current unlocked pass + required evidence.
- `check spec.json --pass-id <pass>` — non-zero unless that pass is unlocked or already done.
- `sync spec.json --in-place` — recompute `sculptPipeline` from `reviewHistory`.

Ordered passes: `blockout → structural-pass → form-refinement → material-pass → lighting-pass →
interaction-pass → optimization-pass`. A pass unlocks only after the prior pass has a review with
`action=continue` backed by a render screenshot, a comparison sheet, a global AI-vision score ≥
threshold (default 0.7), and every critical feature ≥ its own threshold.

## stage3_build/generate_threejs_factory.py
`stage3_build/generate_threejs_factory.py spec.json --out src/createObjectModel.ts [--pass-id PASS] [--force]`
Emits a TypeScript Three.js `Group` factory for the **current unlocked pass only**. Passing a
future `--pass-id` fails until earlier passes are reviewed `continue`. Output exposes
`root.userData.sculptRuntime` (nodes/meshes/sockets/colliders/destructionGroups) — hand-refine it.
Use `--force` for the next pass only after preserving valid hand refinements in the spec.
Do not regenerate after `refine-code`; edit the existing artifact. Regenerate with `--force` after
`refine-spec` or when advancing to a new pass.

## stage4_review/make_comparison_sheet.py
`stage4_review/make_comparison_sheet.py --reference IMG --render SHOT --out cmp.png [--panel-width N] [--panel-height N] [--gutter N] [--json]`
Aligns + packages one side-by-side sheet. It does **not** compute an acceptance score — inspect
`cmp.png` with agent vision and write the score back via `stage4_review/append_review.py`.

## stage4_review/append_review.py
`stage4_review/append_review.py spec.json --pass-id PASS --fidelity 0-1 --action continue|refine-spec|refine-code|request-input|stop --summary "..." [evidence flags] --in-place`
Evidence flags: `--matched --mismatches --spec-fixes --code-fixes --evidence --reference-screenshot
--render-screenshot --comparison-image --ai-vision-score 0-1 --layer-scores-json '{...}'
--feature-reviews-json f.json --ai-vision-notes "..." --visual-threshold 0-1 --camera-view NAME
--require-screenshot-files`. Layer keys: `silhouetteProportion, componentStructure, formDetail,
materialSurface, lightingCamera`. Records one self-correction entry into `reviewHistory`.

## stage1_intake/extract_pbr_evidence.py
`stage1_intake/extract_pbr_evidence.py <crop> --out-dir DIR --material-id ID [--target-threshold 0.7] [--size N]
[--palette-size N] [--spec spec.json --in-place | --out-spec p.json] [--report r.json]
[--allow-low-confidence] [--multi-view-reference]`
Extracts reference-derived evidence: albedo palette, de-lit albedo, roughness estimate, height,
normal, AO. **Inference, not inverse rendering** — pixels include baked lighting. Exits non-zero
and refuses to patch the spec when confidence < `--target-threshold` (default 0.7) unless
`--allow-low-confidence`. Treat sub-threshold as `request-input`/`refine-spec`, not a pass.

## _shared/feature_acceptance_policy.py
Internal helper imported by the orchestrator/validator (`feature_gate_failures`,
`feature_review_policy`). Enforces the ≤5 critical / ≤3 important feature-tier policy. Not a CLI.
