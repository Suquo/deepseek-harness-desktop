# Purpose-building the harness for /suquo-systems-parametria — synthesis & plan

**Date:** 2026-08-19 · **Author:** RM (AA generation) · **Inputs:** two parallel research reports (appendices in this folder): [harness extension surfaces](harness-extension-surfaces.md) · [skill workflow profile](skill-workflow-profile.md). Owner priorities (ruled 2026-08-19): **cost + speed per definition are the top-line metrics; per-step build telemetry is valuable; model-swap cost/performance comparison is high value.**

## Headline findings

1. **Everything we need composes without forking upstream** (consistent with ADR H-0001). The mechanisms: a desktop **profile** (`$DSH_HOME/profiles/parametria/` — plugin deps + `dsh.profile.bundles` + `cordis.patch.yml`) and a custom **agent preset** (a directory with `agent.cordis.yml`, mountable skills, subagent tool rows).
2. **The vision-blind validator has an exact upstream answer.** A preset can carry a second `dsh-tool-subagent` row (`toolName: subagent_validator`) whose `agentOptions: { provider, model }` pins a vision-capable model for validator children, independent of the session model. Per-call model selection does NOT exist (documented limitation) — per-instance pinning is the supported shape. Complement: `dsh-llm-pi-ai` per-model `input` modalities make image-to-text-model refusals LOUD pre-attach; `dsh-llm-deepseek` has no modality config, so the vision route should be a pi-ai route.
3. **Cost/speed telemetry is 80% built upstream — the missing 20% is money.** Per-step tokens ride `assistant/message` (`usage`), model/provider provenance rides `request/context`, wall-times (`llmMs`, `ttftMs`, `decodeMs`, `toolMs`) come from the `sessionStats` projection, and everything is queryable via `ctx.sessionQuery`. There is **no monetary cost accounting anywhere** (grep-verified; explicit non-goal upstream) — a price table joined to the `tokenUsage` projection is ours to build. Caveats: `dsh-session-stats` is mounted only in the web-app bundle today (mount it in our profile); mid-run model switches invalidate provider cache, so A/B comparisons use uncached-input + output tokens, not billed totals.
4. **Model A/B is supported with provenance.** `/model` (session.selectModel) switches at the next prompt-assembly boundary; per-step override exists via the `agent/request` waterfall; every switch appends a fresh `request/context` record, so per-model attribution of tokens/timing is exact.
5. **The skill is compensating for 22 harness weaknesses** (W1–W22 in the skill report). The big structural ones a purpose-built harness should absorb: vision routing (W1/W2), image-context accumulation that forces the orchestrator/validator pattern (W3), shell-escaping and argv-length detours (W7/W8), dev-server lifecycle & readiness (W10/W11), DOM-puppetry screenshots (W12), silent owner drift (W13/W14), and the dual-skill-root divergence (W21 — the loaded skill executes the OTHER copy's scripts).

## Target architecture (three increments)

### Increment 1 — Parametria agent preset + profile (issues #1, #2)
A `parametria` agent preset directory (shipped-`cordis`-preset pattern):
- **Preset-local skill root**: `skills/suquo-systems-parametria/SKILL.md` mounted via preset-scoped `dsh-skill-filesystem` (`customSkillDirs: !!js … new URL('skills/', baseUrl)`) — the skill travels with the preset, killing the W21 dual-root problem (preset copy becomes canonical; retrospective self-edits get a review surface because the preset lives in this repo).
- **Two subagent tool rows**: general `subagent` + `subagent_validator` pinned to a vision-capable pi-ai route. Landmines (documented): a child joining nothing gets zero tools (validators inherit the preset's toolset — scope with `toolFilter`); `dsh-tool-subagent-report` stays host-plane (second agent-plane mount throws); service rows in presets must sit in an `isolate` group or mount is rejected.
- **Desktop profile** `parametria`: mounts the preset, `dsh-session-stats` (not in the default composition), persona, permission preset, sandbox policy for node/uv/playwright.
- Patch semantics: id-targeted patches REPLACE whole config (no deep merge) — restate kept fields.

### Increment 2 — Cost & per-step telemetry report (owner priority 1+2)
A desktop-owned host plugin (`parametria-run-report`):
- Joins `tokenUsage` + `sessionStats` projections with `request/context` model records via `ctx.sessionQuery`; segments a run into skill phases by tool-call markers (build-definition/screenshot calls bracket increments).
- **Price table config** (per provider/model, per bucket: uncached input / cacheRead / cacheWrite / output) — ours; upstream records the four disjoint buckets already.
- Output: per-run + per-increment cost, wall-time, model attribution; surfaced as a web route/slot (renderer can't read Host services directly — no Electron IPC bridge exists or is wanted) and as a file dump next to the session export.

### Increment 3 — First-class Parametria tools (cost/speed lever)
The skill burns tokens and wall-time on bash round-trips (W7 shell escaping, W8 argv limits, W10 dev-server checks, W12 DOM puppetry). A `parametria-tools` host plugin can register real tools via `ctx.tools.register` (build-definition from a file spec, screenshot-with-readiness-probe, inspect-definition) — fewer tokens per increment, fewer failure classes, and clean per-increment telemetry markers for Increment 2. Candidate follow-up: harness-managed dev-server lifecycle with readiness probe.

## Out of scope for the harness (stays in skill/app land)
- Node-catalog staleness (W5/W6) → live schema introspection belongs to the Parametria app; SK-2 stands.
- App DOM defects the screenshot script works around (W12's root causes) → suquo-systems-rust issues.
- **Hazard, owner attention:** `scripts/query-grasshopper-kb.py` hardcodes a Pinecone API key in source (and reads `OPENAI_API_KEY` from other skills' `.env`s). Recommend rotation + move to `scripts/.env`.

## Decision points for the owner (batched, non-blocking)
1. Which vision-capable model/route for the validator pin (pi-ai route required for modality declarations).
2. Preset-local skill copy becomes canonical (W21) — requires retiring `~/.claude/skills/...` and `~/.agents/skills/...` copies or making them sync targets.
3. Price table seed values (per-model $/Mtok in/out/cache) for Increment 2.
