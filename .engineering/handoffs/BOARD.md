# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**PR #56 MERGED (2026-08-20 ~23:09, admin bypass, docs-only): the AGENT-ROADBLOCK RELIEF PLAN is the fleet's working program.** An operator-launched session (`Agent roadblock relief plan`) executed the plan's non-lane scope: Phase 0 deployed + verified at source (managed `parametria-vision` block live in `$DSH_HOME/cordis.patch.yml`, installer idempotent, preset suite 154/0), issues **#52–#55 filed** (route-preflight banner · reasoning-400 hardening · read_image route fallback · pnpm shim), census annotations on #1/#6/#24/#40. RM triaged all four APPROVED. Plan stays in `plans/` (phases 1–5 are live lane work); report at `.engineering/reports/agent-roadblock-relief-plan-report.md`. **Lane B claim order per plan: #40 → #24 → #23 → #52 → #53 → #54; Lane A: #55.**

**PR #50 MERGED (2026-08-20 ~21:05, green CI): the #1 unblock — parametria-vision is now MACHINE-WIDE** (route in `$DSH_HOME/cordis.patch.yml`, ownership-guarded installer, ADR H-0005). #1 reopened (had been auto-closed since PR #19). Phase 0 install DONE (22:52) — the remaining step is one operator run that invokes `subagent_validator`.

**PR #47 MERGED (2026-08-20 ~20:45, green CI): #43 delivered — the fork is on dsh-v0.1.0-rc.8.** Official brand slots → #48; #46 + #49 filed from findings.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, cjjmaster).
- **Lane A (general, `claude/*`)**: FREE — gen-7 delivered #49 (PR #51 merged: openBrowser: false in our web-runtime patch row; browser popups ended). Next: #55 (pnpm shim) per relief-plan order; #45 low.
- **Lane B (parametria-harness, `pm/*`)**: FREE — gen-10 delivered the #1 unblock (PR #50 merged on green: machine-wide parametria-vision route, ownership-guarded installer, ADR H-0005; root cause was profile-scoped route + never-switched profile). #1 OPEN pending-live: operator does ONE install:profile then runs. Queue: #23/#24/#30/#45/#48 available, #6 buildable, #7 owner-gated.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-4 delivered the rc.8 bump (PR #47 merged on green: pin surface 166→173 incl. upstream package deletions inherited; GUI smoke caught a green-gate brand regression; official brand slots discovered → #48). Watch doc carries the age-gate lesson. #46/#49 filed from findings.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37) incl. the owner's lockup refinements.

## Queue (open GitHub issues, RM-triaged)

- **#1 [Lane B] Vision routing — PENDING-LIVE, fully unblocked** (PR #50 + install:profile done 22:52): closes on the first run where a validator child answers through parametria-vision. Operator: run once.
- **Relief-plan queue (RM-triaged 2026-08-20): Lane B order #40 → #24 → #23 → #52 → #53 → #54; Lane A #55.** #52/#53/#54 carry `parametria-harness`; #54's Phase-0 dependency is satisfied; #55 needs authored-where grounding (userData shim vs upstream package) before patching.
- **#48 (official brand slots, Lane D) claimable.**
- **#26 [Lane A/B] rebrand remainder** — open on: owner identity migrations (app.setName/userData · builder appId/productName · naming ruling) + locale copy. #23/#24/#30/#45 — claimable follow-ups (structural evidence surface · command-level policy · Host-plane real cost · trim amortization). **#40** — error-laundering fix, claimable AFTER #43 lands (patch surface moves with the pin). **#6** — A/B protocol, buildable (4 datums recorded; vision-path + verification-claim-fidelity axes established). **#7** — owner-gated (canonicalization).
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Live-run items:** agy sign-in still failing (antigravity status ERROR persists after sign-in — re-verify with `modlens doctor` or agy's own status); claude-cli vision fails under a SessionEnd hook cancellation (operator's Claude plugin config); codex spawn EINVAL (modlens Windows bug — report to @liustack?).
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` — rotate + move to `scripts/.env` (outside this repo's fleet surface; flagged only).
