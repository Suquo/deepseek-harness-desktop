# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**PR #32 MERGED (2026-08-20 ~06:10, on green dispatch CI): #5 CLOSED — the in-UI cost surface is LIVE.** Per-generation cost chip + per-step cost/TTFT/model-time columns in desktop-composed modes (compat pristine); live OpenRouter list rates with visible provenance timestamp; `unpriced` fail-open with `≥$x` floors; compile-time both-direction status witnesses; parity fence against the offline `session-cost.mjs` join. Real billed cost = #30 (Host-plane, grounded both roads). Validated live: `$5.77 · 6m58s`, 50/50 generations priced. **Owner's top-line metrics (cost + speed per definition) are now on screen.**

**PR #28 MERGED (2026-08-20 ~02:40): in-app Parametria rebrand LIVE.** PARAMETRIA wordmark + mark (both themes; desktop-composed modes only — compat mode stays pristine per AGENTS.md), "Parametric Definitions" headline, ADR H-0002 (upstream-class-selector deviation, Lane C pin-bump obligation: re-run client-brand.spec + re-derive the class table before accepting a new pin). #26 re-scoped OPEN on the Host/packaging remainder (title/favicon/manifest via indexTaps · tray/app icons/windowTitle/productName/installer art · locale copy · aria-label drift-guard one-liner) — Lane A/B, gated partly on the owner's compat-branding ruling. Lane D's `--user-data-dir` discovery closed the charter's userData isolation gap.

**PR #25 MERGED (2026-08-20 ~00:20): #9 CLOSED — evidence plumbing landed per ruling** (run-scoped `.parametria-evidence/<session>/` root, persona-instructed; gitignore + `.uv-cache` rider; derived evidence-hygiene fence; residuals filed as #23/#24).

**Day 1 totals (2026-08-19→20): 11 PRs merged (#8 #10 #11 #14 #15 #17 #19 #21 #22 #25 #28), issues #2 #4 #9 #12 #13 #16 #18 #20 delivered.** Run harvests 1-2 done (persona auto-load PROVEN; SK-4 stale-spec hazard found; validator fix still unverified live — reinstall needed, see owner items).

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, fresh session, cjjmaster).
- **Lane A (general, `claude/*`)**: FREE — gen-6 delivered #41 (PR #44 merged on green: 10.6x append fix; the pre-merge baseline was a BROKEN RECORDER — O_TRUNC EINVAL — so the trim path first ran on win32 in #42; budget 30s ruled non-double-counting). #45 (trim amortization) claimable low-priority.
- **Lane B (parametria-harness, `pm/*`)**: FREE — gen-9 delivered #36 (PR #38 merged on green CI: cost surface mounts in BOTH shell modes from the mode-independent entry). Queue: #23/#24/#30 available, #6 buildable, #7 owner-gated.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: **FROZEN-SCHEDULED — gen-4 on the rc.8 bump (#43)**: yarn npmMinimalAgeGate blocks rc.8 resolution until 2026-08-20T15:42Z (RM ruled WAIT, zero policy change). Steps 1-4 done+fenced at head 44b3ac9ba6; resume after 15:42Z. Six fallout items pre-triaged on #43 (reportDelivery vs #40 · brand-region restructuring vs #28/#37 · trademark guidelines vs #26 · SQLite · multimodal · PTY).
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gen-3 delivered the sidebar lockup (PR #37 merged on green CI: mark beside wordmark, neutral inherited ink, upstream-derived geometry).

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
- **Skill-root canonicalization** (#7): OK to make the preset-local copy in this repo canonical and retire/sync-target `~/.claude/skills` + `~/.agents/skills` copies? (Coordinates with your sync-skills fleet flow.)
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` (also reads `OPENAI_API_KEY` from other skills' `.env`s). Recommend rotating the Pinecone key and moving it to `scripts/.env`. Flagging only — the skill folder is outside this repo's fleet surface.
- **SK-2 landing surface**: node-catalog regeneration belongs to the Parametria app (suquo-systems-rust fleet) — file it there?
- **SK-4 (new, run #2): stale-spec silent wrong-build hazard.** The skill's build procedure writes `spec.json` to `C:/tmp` via a subprocess; under workspace-write the subprocess write EPERMs, and `build-definition` then silently consumed a STALE spec — creating a phantom definition in a real Convex collection (cleaned up in-run). Skill fix: workspace-relative paths (PR #25's `.parametria-evidence/` convention retires C:/tmp) + the build script should verify spec freshness (hash/mtime) before building. Same landing-surface ruling as SK-1/SK-3.
- **RE-INSTALL NEEDED before run #3:** the installed profile predates PRs #19/#22/#25 — run `corepack yarn workspace dsh-preset-parametria install:profile` (add `--force` if it refuses on local edits), then the next run is #1's live test.
- **Rebrand identity migrations (from PR #29's deferrals, need owner calls):** (1) `app.setName` change moves Electron `userData` — a real user-data migration, not presentation; (2) electron-builder `appId`/`productName`/NSIS shortcut identity — changes upgrade/install identity for packaged builds; (3) NAMING: what does "DSH Terminal" (and other non-shell product strings) become — 'Parametria Terminal'? Rule these and Lane A takes them as one migration slice.
