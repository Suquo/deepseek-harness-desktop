# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**PR #22 MERGED (2026-08-19 ~22:15): #20 delivered as re-scoped — validator is a LEAF** (toolFilter denies all 5 delegation tools incl. ralph/workflow; fence DERIVES the list from upstream classification; refuted-premise comments corrected — gen-5's source refutation of the RM's issue text accepted and ruled). **PR #21 MERGED (2026-08-19 ~21:30): #9 item 1 delivered persona-only per owner ruling** — workspace-local UV_CACHE_DIR + per-call playwright escalation; the danger-full-access preset row REJECTED (acknowledgement dialog is key-gated; owner keeps it), rationale fenced in the preset tests. #9 stays open on the evidence half (separate plugin-shaped slice).

**PR #19 MERGED (2026-08-19 ~20:15): #18 delivered — validator maxDepth 0→1 (the live-run blocker on the vision route).** Grounded at upstream source (absolute child-depth cap; README: 0 forbids delegation); fence executes upstream's own depth functions. New: **#20** (sibling-row depth hole, disclosed in review). **#1 now closes on the owner's NEXT profile run** — the validator should spawn and answer through parametria-vision/gemini-3.6-flash. Harvest of run 1 fully recorded (#1/#6/#9 comments).

**PR #17 MERGED (2026-08-19 ~19:01, admin bypass): #16 delivered — every marginal win32 test budget re-sized from measurement.** Final band: market 20s/1.37x · desktop-plugins 20s/1.50x · lifecycle-events 15s/1.80x · electron-runtime 10s/1.80x — none marginal, none inflated; POSIX arms untouched. The 14.9x stall class is now measured directly (caught live), not inferred. Resolver's 15s-over-RM's-presumptive-20s accepted on measurement (different cost class). Lane A FREE; worktree registry EMPTY.

**PR #14 MERGED (2026-08-19 ~18:04): #12 delivered — pin guard exhaustive over the full 166-entry surface.** Names-not-counts snapshots per (manifest, field), generated off the tree; keyed diff failures; the doc's step-3 table is the single surface authority; `yarn upstream:watch` rider landed. Hold-back declaration mechanism deferred until first use (ruling on #12). Gate flake datum posted to #16 (class reaches desktop-plugins.spec.ts). Lane C FREE; all merged worktrees cleaned (registry: issue-16 only).

**PR #15 MERGED (2026-08-19 ~17:48): #13 delivered — profile.spec.ts win32 budget 10s→45s, derivation measured.** The resolver's measurement REFUTED the RM's issue framing (the PR #10 red was a ≥14x external-load stall on a sub-second test, not a headroom problem) — verified and ruled, issue closed on the corrected basis. RM reviewed inline (1-file +12/−1 diff fully read + empirically re-run: 18/18, 14.37s) — proportionality precedent: sub-agent axes are for diffs the RM can't hold whole. New: **#16** (marginal 5s budgets: desktop-plugins ~7.4x, market-pnpm-integration, electron-runtime). Lane A FREE.

**PR #10 MERGED (2026-08-19 ~17:02): #9 item 2 + CI contract doc delivered (closes nothing by design).** Root `test` reaches `dsh-preset-parametria`; verify-layout guards are segment-exact and driven by ONE workspace list; AGENTS.md carries the CI contract with corrected fork-parent attribution. #3 stays open on the owner's two ordered steps (fork Actions opt-in → branch protection). New: **#13** (now closed via PR #15).

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, fresh session, cjjmaster).
- **Lane A (general, `claude/*`)**: FREE — gen-3 completed #16 (PR #17 merged). No claimable general issues remain open.
- **Lane B (parametria-harness, `pm/*`)**: FREE — gen-5 delivered #20 as re-scoped (PR #22: validator-is-a-leaf toolFilter, derived fence). Queue: #9 evidence half (needs design), #1 pending-live, #5/#6/#7 owner-gated.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-2 completed #12 (PR #14 merged). Next natural slice: none until a bump trigger or #12-class follow-up.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE.

## Second run harvested (weaker model, 2026-08-19)

`gemini-3.6-flash` solo built a 119-node cabinet in 9.9 min (vs 20+8 min for run 1) but SKIPPED the per-increment validation discipline; its subagent died with an opaque `Error: subagent run failed` (empty transcript — new harness finding, scoped into #1); orchestrator self-validated via in-context image reads. First A/B datum + protocol implications recorded in `.engineering/research/model-comparison-first-datum.md`, commented onto #6 and #1. RM recommendation pending owner: validator pin = `google/gemini-3.6-flash` (pi-ai route, `input: [text, image]`).

## Queue (open GitHub issues, RM-triaged; DELIVERED today: #2→PR8, #4→PR11, #13→PR15, #9-item-2→PR10)

- (delivered today, all lanes: #2→PR8 · #4→PR11 · #9-item2→PR10 · #13→PR15 · #12→PR14 · #16→PR17)
- **#1 [Lane B] Vision routing** — structural half landed in PR #8; stays open PENDING-LIVE (first real run must show `subagent_validator` on `parametria-vision` + the opaque `subagent run failed` finding scoped here).
- **#5 [Lane B] Cost/timing report** — gated on owner price seeds. **#6 [Lane B] Model A/B protocol** — first datum recorded; buildable after #5's seeds. **#7 [Lane B] Skill-root consolidation** — gated on owner canonicalization OK.
- **#9 [Lane B] PR #8 follow-ups** — item 2 done (PR #10); items 1 (evidence/sandbox plumbing) + 3 (mount observation, pending-live) remain. **#3 [owner] CI required-checks** — see owner items.
- **[skill, outside repo] SK-1** (SKILL.md L115 vs L298 contradiction) + **SK-2** (node-catalog regeneration) — need a landing surface ruling (owner item).

## Owner items (batched, non-blocking)

- **ONE step left on #3 — the fork Actions tab enable-workflows click (UI-only, operator-only).** Branch protection is DONE per the in-session ruling (2026-08-19): ruleset `master-required-checks` (21051431) active — required checks `check` + `desktop-windows`, deletion + force-push blocked, admin bypass always (no wedge while events are dormant). API shows Actions enabled and the workflow active, yet push/PR events fire zero runs — the fork opt-in banner is the remaining explanation and only the UI clears it. #3 closes on the first real PR-event rollup.
- **Price table seeds** (#5): per-model $/Mtok (uncached-input / cacheRead / cacheWrite / output) for the models you want costed.
- **Skill-root canonicalization** (#7): OK to make the preset-local copy in this repo canonical and retire/sync-target `~/.claude/skills` + `~/.agents/skills` copies? (Coordinates with your sync-skills fleet flow.)
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` (also reads `OPENAI_API_KEY` from other skills' `.env`s). Recommend rotating the Pinecone key and moving it to `scripts/.env`. Flagging only — the skill folder is outside this repo's fleet surface.
- **SK-2 landing surface**: node-catalog regeneration belongs to the Parametria app (suquo-systems-rust fleet) — file it there?
