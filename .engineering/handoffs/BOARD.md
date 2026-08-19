# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**PR #14 MERGED (2026-08-19 ~18:04): #12 delivered — pin guard exhaustive over the full 166-entry surface.** Names-not-counts snapshots per (manifest, field), generated off the tree; keyed diff failures; the doc's step-3 table is the single surface authority; `yarn upstream:watch` rider landed. Hold-back declaration mechanism deferred until first use (ruling on #12). Gate flake datum posted to #16 (class reaches desktop-plugins.spec.ts). Lane C FREE; all merged worktrees cleaned (registry: issue-16 only).

**PR #15 MERGED (2026-08-19 ~17:48): #13 delivered — profile.spec.ts win32 budget 10s→45s, derivation measured.** The resolver's measurement REFUTED the RM's issue framing (the PR #10 red was a ≥14x external-load stall on a sub-second test, not a headroom problem) — verified and ruled, issue closed on the corrected basis. RM reviewed inline (1-file +12/−1 diff fully read + empirically re-run: 18/18, 14.37s) — proportionality precedent: sub-agent axes are for diffs the RM can't hold whole. New: **#16** (marginal 5s budgets: desktop-plugins ~7.4x, market-pnpm-integration, electron-runtime). Lane A FREE.

**PR #10 MERGED (2026-08-19 ~17:02): #9 item 2 + CI contract doc delivered (closes nothing by design).** Root `test` reaches `dsh-preset-parametria`; verify-layout guards are segment-exact and driven by ONE workspace list; AGENTS.md carries the CI contract with corrected fork-parent attribution. #3 stays open on the owner's two ordered steps (fork Actions opt-in → branch protection). New: **#13** (now closed via PR #15).

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, fresh session, cjjmaster).
- **Lane A (general, `claude/*`)**: **BUSY — RM-spawned gen-3 on #16** (marginal budgets, measure-first per PR #15 pattern; branch `claude/issue-16-marginal-budgets`). Expected-touch: the three named spec files + at most workspace vitest configs. Disjoint vs Lane C fix cycle.
- **Lane B (parametria-harness, `pm/*`)**: FREE — gen-2 completed #2 (PR #8 merged). Remaining queue (#1 pending-live, #5/#6/#7 owner-gated, #9 items 1+3).
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-2 completed #12 (PR #14 merged). Next natural slice: none until a bump trigger or #12-class follow-up.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE.

## Second run harvested (weaker model, 2026-08-19)

`gemini-3.6-flash` solo built a 119-node cabinet in 9.9 min (vs 20+8 min for run 1) but SKIPPED the per-increment validation discipline; its subagent died with an opaque `Error: subagent run failed` (empty transcript — new harness finding, scoped into #1); orchestrator self-validated via in-context image reads. First A/B datum + protocol implications recorded in `.engineering/research/model-comparison-first-datum.md`, commented onto #6 and #1. RM recommendation pending owner: validator pin = `google/gemini-3.6-flash` (pi-ai route, `input: [text, image]`).

## Queue (open GitHub issues, RM-triaged; DELIVERED today: #2→PR8, #4→PR11, #13→PR15, #9-item-2→PR10)

- **#16 [Lane A] Marginal 5s test budgets** — IN PROGRESS (gen-3; now also owns the desktop-plugins flake datum from PR #14's gate).
- **#1 [Lane B] Vision routing** — structural half landed in PR #8; stays open PENDING-LIVE (first real run must show `subagent_validator` on `parametria-vision` + the opaque `subagent run failed` finding scoped here).
- **#5 [Lane B] Cost/timing report** — gated on owner price seeds. **#6 [Lane B] Model A/B protocol** — first datum recorded; buildable after #5's seeds. **#7 [Lane B] Skill-root consolidation** — gated on owner canonicalization OK.
- **#9 [Lane B] PR #8 follow-ups** — item 2 done (PR #10); items 1 (evidence/sandbox plumbing) + 3 (mount observation, pending-live) remain. **#3 [owner] CI required-checks** — see owner items.
- **[skill, outside repo] SK-1** (SKILL.md L115 vs L298 contradiction) + **SK-2** (node-catalog regeneration) — need a landing surface ruling (owner item).

## Owner items (batched, non-blocking)

- **Fork Actions event triggers are DORMANT, then branch protection (#3, re-scoped — TWO steps in order)**: `workflow_dispatch` runs the inherited `ci.yml` green on all five jobs, but `pull_request` events produce NO run (PRs #10/#11 rollups empty) — consistent with GitHub's fork Actions opt-in, needs the operator to enable Actions/workflow runs in the fork's Actions tab FIRST. Only then: branch protection (RM recommendation: ruleset requiring `check` + `desktop-windows` on PRs, bypass for direct docs pushes) — requiring checks that never arrive would make master unmergeable. Approve both and the RM applies step 2; #3 closes then.

- **Vision model/route for the validator pin** (#1): must be a `dsh-llm-pi-ai` route (deepseek adapter has no modality config). Name the provider + model to pin.
- **Price table seeds** (#5): per-model $/Mtok (uncached-input / cacheRead / cacheWrite / output) for the models you want costed.
- **Skill-root canonicalization** (#7): OK to make the preset-local copy in this repo canonical and retire/sync-target `~/.claude/skills` + `~/.agents/skills` copies? (Coordinates with your sync-skills fleet flow.)
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` (also reads `OPENAI_API_KEY` from other skills' `.env`s). Recommend rotating the Pinecone key and moving it to `scripts/.env`. Flagging only — the skill folder is outside this repo's fleet surface.
- **SK-2 landing surface**: node-catalog regeneration belongs to the Parametria app (suquo-systems-rust fleet) — file it there?
