# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**AA-GENERATION BOOTED (2026-08-19, cjjmaster, `/loop /repo-manager` — first chartered RM generation, continuing in the bootstrap session's context).**

- **Boot reconciliation:** gh default repo initially resolved to the anywhere-labs PARENT (fixed: `gh repo set-default Suquo/deepseek-harness-desktop`); parent repo is highly active (~20 open PRs, 2.0.x bug wave) — Lane C watch data. Fork had issues DISABLED + master 2 ahead unpushed.
- **Owner rulings (2026-08-19, in-session, recorded):** (1) Issues ENABLED on the fork + seed queue FILED (#1 vision routing · #2 Parametria profile · #3 CI · #4 upstream watch; labels `parametria-harness`/`ci`/`upstream` created). (2) **STANDING PUSH AUTHORITY to origin granted** — bootstrap commits pushed (`e84f95abf8`); never push to the anywhere-labs `upstream` remote. (3) **PRODUCT PRIORITIES: cost + speed per definition are the TOP-LINE metrics; per-step build telemetry is valuable; model-swap cost/performance comparison is high value** — telemetry/metering surfaces are first-class in the harness plan.
- **RESEARCH COMPLETE + SYNTHESIZED (same generation):** both reports landed and persisted to `.engineering/research/` (synthesis + 2 appendices). Headlines: everything needed composes without forking (preset + profile); vision-validator fix = second `dsh-tool-subagent` row with `agentOptions` model pin + pi-ai `input` modalities for loud refusal; telemetry is 80% upstream (tokens/model/timing in the session log + projections), **money is ours to build**; model A/B supported with exact provenance (`request/context`). Issues updated (#1, #2 comments) and filed: **#5 cost/timing report · #6 model A/B protocol · #7 skill-root consolidation (W21)**. Queue order for Lane B: #2 → #1 → #5 → #6, #7 rides #2.

**FLEET BOOTSTRAPPED (2026-08-19, cjjmaster; operator appointed the RM in-session and ran `/loop /repo-manager`).**

- Engineering scaffold committed (`e74eaca3fb`): `.engineering/` (config, ADR ledger `H-NNNN`, H-0001 fork strategy) — then this fleet layer (charters, board, launchers, AGENTS.md fleet table).
- **App verified running from source**: `corepack yarn install` + `corepack yarn dev` → Electron shell up, Host Web UI serving on ephemeral loopback (verified HTTP 200). Environment lesson recorded: Electron stdout doesn't flush through pipes — verify liveness by process + port, not log tail.
- **First Parametria run harvested** (session export `Downloads/dsh-session-session-60658537-…`): APW-1200-0900-0600 workbench delivered (94 nodes, fully parametric, dimensions verified arithmetically via `inspect-definition`). Two learnings were written into `SKILL.md` by the run agent — **both verified landed** (vision-capability prerequisite ~L521; `transform.rotate` axis/OCCT re-confirmation ~L298). Residual found during verification: SKILL.md ~L115 still carries the old blanket "do NOT use transform.rotate (OCCT: No)" rule that L298 now contradicts → SK-1 below.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AA generation LIVE (`/loop /repo-manager`, this session, cjjmaster).
- **Lane A (general, `claude/*`)**: FREE — no generation, no branches.
- **Lane B (parametria-harness, `pm/*`)**: **BUSY — RM-spawned agent-mode gen-1 on #2** (branch `pm/issue-2-parametria-profile`), spawned 2026-08-19 after the operator's build green-light. Expected-touch: new preset dir at repo root + root package.json + .engineering docs. #7 rides; #1 seam wired placeholder-only.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE.

## Second run harvested (weaker model, 2026-08-19)

`gemini-3.6-flash` solo built a 119-node cabinet in 9.9 min (vs 20+8 min for run 1) but SKIPPED the per-increment validation discipline; its subagent died with an opaque `Error: subagent run failed` (empty transcript — new harness finding, scoped into #1); orchestrator self-validated via in-context image reads. First A/B datum + protocol implications recorded in `.engineering/research/model-comparison-first-datum.md`, commented onto #6 and #1. RM recommendation pending owner: validator pin = `google/gemini-3.6-flash` (pi-ai route, `input: [text, image]`).

## Queue (RM-triaged; not yet filed as GitHub issues — filing is the first RM generation's call with the operator)

1. **[parametria-harness / Lane B] Vision-aware subagent model routing.** First-run finding: validator subagents inherit the session model; on text-only `deepseek-v4-flash` every image read failed while capture commands succeeded — *a failure mode that looks like success*. The skill now guards this; the HARNESS should solve it structurally: compose agent presets / model routing so validator-class subagents get a vision-capable model (upstream plugins in play: `dsh-agent-presets`, `dsh-agent-default-model`, `dsh-subagent`). This is the seed feature of the Parametria work profile.
2. **[parametria-harness / Lane B] Parametria work profile.** Define the desktop profile composition for Parametria runs (skill availability, model config, permission preset) so a run doesn't depend on hand-arranged session state.
3. **[ci / Lane A] Stand up CI** (GitHub Actions: `corepack yarn check` on PR) — until then, "required CI" = the full local gate pasted in the PR body (charter rule).
4. **[upstream / Lane C] Upstream watch cadence.** Current pin `0.1.0-rc.7` (`99f6f02fec`) = latest release at bootstrap; anywhere-labs `upstream` remote last merged at `3352bd1b20`. Establish the release-watch tick and the pin-bump eval protocol per the standing goal.
5. **[skill, outside this repo] SK-1: reconcile SKILL.md ~L115 vs ~L298** — the old blanket `transform.rotate` prohibition contradicts the re-confirmed guidance; a future run reading L115 first re-imports the confusion the run agent just resolved. (Skill lives at `~\.agents\skills\suquo-systems-parametria\`; not versioned here — needs its own landing surface, RM to raise with operator.)
6. **[skill, outside this repo] SK-2: node-catalog refresh.** `references/node-catalog.md` is provably stale (`transform.rotate` inputs + OCCT flag); a regeneration pass from the live app would retire the whole staleness class instead of patching entries one by one.

## Owner items (batched, non-blocking)

- **Vision model/route for the validator pin** (#1): must be a `dsh-llm-pi-ai` route (deepseek adapter has no modality config). Name the provider + model to pin.
- **Price table seeds** (#5): per-model $/Mtok (uncached-input / cacheRead / cacheWrite / output) for the models you want costed.
- **Skill-root canonicalization** (#7): OK to make the preset-local copy in this repo canonical and retire/sync-target `~/.claude/skills` + `~/.agents/skills` copies? (Coordinates with your sync-skills fleet flow.)
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` (also reads `OPENAI_API_KEY` from other skills' `.env`s). Recommend rotating the Pinecone key and moving it to `scripts/.env`. Flagging only — the skill folder is outside this repo's fleet surface.
- **SK-2 landing surface**: node-catalog regeneration belongs to the Parametria app (suquo-systems-rust fleet) — file it there?
