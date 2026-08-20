# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**PR #50 MERGED (2026-08-20 ~21:05, green CI): the #1 unblock — parametria-vision is now MACHINE-WIDE.** Gen-10's diagnosis REFUTED the run-4 harvest ("profile mounted" was wrong — state.json read `desktop` through every run; run 4's deepseek-modlens parent was itself desktop-profile evidence): the real defect was a home-level preset pinning a provider only one never-booted profile registered. Option B ruled + landed: route in `$DSH_HOME/cordis.patch.yml` (registers under EVERY profile), ownership-guarded installer (refuse-before-write, --force releases only its own block), boot-level red/green proof both profiles, ADR H-0005. **#1 also turned out to be AUTO-CLOSED since PR #19 — reopened.** Operator's single step: one `install:profile`, no profile switch; the next run is the live test.

**PR #47 MERGED (2026-08-20 ~20:45, green CI): #43 delivered — the fork is on dsh-v0.1.0-rc.8.** First real run of the bump protocol: pin surface 166→173 (upstream deleted 2 packages, split 7 — inherit-with-removal ruled sound); 5 patches re-cut/renamed; GUI smoke caught a green-gate regression (whale over our mark — now fenced); rc.8 ships OFFICIAL brand slots → #48 (retire H-0002); #46 (off-manifest version drift) + #49 (openBrowser) filed from findings; deepseek-adapter native-image rework pending-live on #1.

**RUN #4 HARVESTED (~19:20): deepseek-v4-flash built a 97-node workbench end-to-end** (honest not-pure-validated disclosure; modlens flaky 9/19 — operator-side fixes listed in owner items; evidence hygiene perfect; #40 gained a background-path variant). **22 PRs merged this generation.**

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, cjjmaster).
- **Lane A (general, `claude/*`)**: **BUSY — gen-7 on #49 PRIORITY** (rc.8 openBrowser: gate + every desktop launch open the operator browser; fix = openBrowser: false in our patch row, gen-10s mechanism relayed; branch `claude/issue-49-no-open`). #45 low.
- **Lane B (parametria-harness, `pm/*`)**: FREE — gen-10 delivered the #1 unblock (PR #50 merged on green: machine-wide parametria-vision route, ownership-guarded installer, ADR H-0005; root cause was profile-scoped route + never-switched profile). #1 OPEN pending-live: operator does ONE install:profile then runs. Queue: #23/#24/#30/#45/#48 available, #6 buildable, #7 owner-gated.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-4 delivered the rc.8 bump (PR #47 merged on green: pin surface 166→173 incl. upstream package deletions inherited; GUI smoke caught a green-gate brand regression; official brand slots discovered → #48). Watch doc carries the age-gate lesson. #46/#49 filed from findings.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37) incl. the owner's lockup refinements.

## Queue (open GitHub issues, RM-triaged)

- **#1 [Lane B] Vision routing — PENDING-LIVE, fully unblocked** (PR #50): closes on the first run where a validator child answers through parametria-vision. Operator: `install:profile` then run.
- **#49 [Lane A] openBrowser fix — IN PROGRESS (gen-7, priority).** #48 (official brand slots, Lane D) claimable next.
- **#26 [Lane A/B] rebrand remainder** — open on: owner identity migrations (app.setName/userData · builder appId/productName · naming ruling) + locale copy. #23/#24/#30/#45 — claimable follow-ups (structural evidence surface · command-level policy · Host-plane real cost · trim amortization). **#40** — error-laundering fix, claimable AFTER #43 lands (patch surface moves with the pin). **#6** — A/B protocol, buildable (4 datums recorded; vision-path + verification-claim-fidelity axes established). **#7** — owner-gated (canonicalization).
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Live-run items:** agy sign-in still failing (antigravity status ERROR persists after sign-in — re-verify with `modlens doctor` or agy's own status); claude-cli vision fails under a SessionEnd hook cancellation (operator's Claude plugin config); codex spawn EINVAL (modlens Windows bug — report to @liustack?).
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` — rotate + move to `scripts/.env` (outside this repo's fleet surface; flagged only).
