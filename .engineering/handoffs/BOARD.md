# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**PR #10 MERGED (2026-08-19 ~17:02): #9 item 2 + CI contract doc delivered (closes nothing by design).** Root `test` reaches `dsh-preset-parametria`; verify-layout guards are segment-exact and driven by ONE workspace list; AGENTS.md carries the CI contract with corrected fork-parent attribution. #3 stays open on the owner's two ordered steps (fork Actions opt-in → branch protection). New: **#13** (profile.spec.ts ~10.5s vs 10s budget — tips red under load). Lane A FREE; worktree issue-3 pending cleanup.

**PR #11 MERGED (2026-08-19 ~16:57): issue #4 delivered — upstream watch tooling + protocol.** `scripts/upstream-watch.mjs` (read-only, tri-state gitlink, unknown-surfacing verdicts) + `.engineering/upstream-watch.md` (cadence, eval decision tree, patches checklist, pin-bump-PR rules). RM charter carries the daily watch tick. Today's live delta: harness pin CURRENT (0 behind); overlay 40 commits behind anywhere-labs — no bump trigger. #12 tracks the pin-guard exhaustiveness gap (+ root `upstream:watch` script rider). Lane C FREE; worktree issue-4 pending cleanup.

**PR #8 MERGED (2026-08-19 ~15:45): issue #2 delivered — Parametria work profile.** `dsh-preset-parametria/` workspace landed (preset with `subagent_validator` pinned `parametria-vision`/`google/gemini-3.6-flash`, profile patch with the modality-declared pi-ai route, receipt-backed installer, 64 node:test fences). Review: REQUEST CHANGES (3 small blockers + 3 riders) → fixed in one cycle → APPROVE at `eae928de` → merged. RM independently re-ran the gate green (exit 0, quiet machine) — gen-1/2's timeout-only reds attributed to machine load. **Follow-ups live on #9** (evidence/sandbox plumbing · root-`test` pin coverage · mount observation pending-live on the operator's next run). #1 stays open pending a live provider datum; #7 fills the deliberately-empty preset skill root. Post-merge branch delete + docs push pending a classifier-flap recovery.

**AB-GENERATION BOOTED (2026-08-19 ~afternoon, cjjmaster, `/loop /repo-manager` — fresh session per the AA succession plan).** Boot verification clean: no open PRs, issues #1–#7 open and matching the board, #2 carries gen-1's claim + settled plan. **Lane B gen-2 SPAWNED under named agent type `resolver-parametria`** with the AA takeover brief (continue #2, adopt existing worktree + branch, rulings in force: `google/gemini-3.6-flash` via pi-ai route `input: [text, image]`; apiKeyEnv read-only-discover or document+flag). Brief consumed — removed from this section.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, fresh session, cjjmaster).
- **Lane A (general, `claude/*`)**: **BUSY — RM-spawned gen-2 on #13** (profile.spec.ts timeout budget; branch `claude/issue-13-profile-spec-timeout`). Expected-touch: that spec file + at most the workspace vitest config. Also cleaning merged worktrees issue-3/issue-4.
- **Lane B (parametria-harness, `pm/*`)**: FREE — gen-2 completed #2 (PR #8 merged); agent resumable for the next assignment (queue: #1 pending-live → #5 → #6; #7 and #9 available, #5/#6/#7 gated on owner items). Worktree `~/.pm-resolver-worktrees/issue-2` pending cleanup.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: **BUSY — RM-spawned gen-2 on #12** (exhaustive pin guard + `upstream:watch` script rider; branch `up/issue-12-pin-guard`). Expected-touch: `scripts/verify-layout.mjs` + root package.json scripts block. Disjointness vs Lane A gen-2 verified at spawn.
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

- **Fork Actions event triggers are DORMANT, then branch protection (#3, re-scoped — TWO steps in order)**: `workflow_dispatch` runs the inherited `ci.yml` green on all five jobs, but `pull_request` events produce NO run (PRs #10/#11 rollups empty) — consistent with GitHub's fork Actions opt-in, needs the operator to enable Actions/workflow runs in the fork's Actions tab FIRST. Only then: branch protection (RM recommendation: ruleset requiring `check` + `desktop-windows` on PRs, bypass for direct docs pushes) — requiring checks that never arrive would make master unmergeable. Approve both and the RM applies step 2; #3 closes then.

- **Vision model/route for the validator pin** (#1): must be a `dsh-llm-pi-ai` route (deepseek adapter has no modality config). Name the provider + model to pin.
- **Price table seeds** (#5): per-model $/Mtok (uncached-input / cacheRead / cacheWrite / output) for the models you want costed.
- **Skill-root canonicalization** (#7): OK to make the preset-local copy in this repo canonical and retire/sync-target `~/.claude/skills` + `~/.agents/skills` copies? (Coordinates with your sync-skills fleet flow.)
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` (also reads `OPENAI_API_KEY` from other skills' `.env`s). Recommend rotating the Pinecone key and moving it to `scripts/.env`. Flagging only — the skill folder is outside this repo's fleet surface.
- **SK-2 landing surface**: node-catalog regeneration belongs to the Parametria app (suquo-systems-rust fleet) — file it there?
