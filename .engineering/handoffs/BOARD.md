# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**RUN #4 HARVESTED (2026-08-20 ~19:20): the profile finally mounted — and the precise #1 blocker is now host-plane.** All 6 validator children spawned with the correct route config and died NO_ADAPTER: the profile's `llm-pi-ai` providers block never reaches the live plugin config (prime suspect: the user-settings merge clobbering composed providers — the operator's session moved to `deepseek-modlens`, so their settings.yaml changed). **Lane B gen-10 is on the diagnosis** (`/diagnosing-bugs` discipline, red-capable composition dump). Run 4 also: deepseek-v4-flash built a 97-node workbench end-to-end with honest not-pure-validated disclosure; modlens vision flaky 9/19 (agy still ERROR after sign-in, claude-cli poisoned by a SessionEnd hook, codex spawn EINVAL — all operator-side); evidence hygiene perfect; #40 gained a background-path laundering variant.

**PR #44 MERGED (2026-08-20 ~14:10, green CI): #41 delivered — 10.6x append fix; TEMPORARY 300s budget retired → measured 30s.** The 'pre-merge baseline' was a broken recorder (win32 O_TRUNC EINVAL — the trim path first ran on win32 in #42; 4th RM-verified premise refutation). #45 filed (trim amortization, low).

**PR #42 MERGED (2026-08-20 ~12:30, green CI): #39 delivered — overlay sync current to anywhere-labs a80c504f7f** (65 commits, 4 conflicts resolved fences-intact; found upstream's quadratic appendOwned → #41). **20 PRs merged this generation**; earlier deliveries: #8 #10 #11 #14 #15 #17 #19 #21 #22 #25 #28 #29 #32 #33 #34 #35 #37 #38.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AB generation LIVE (`/loop /repo-manager`, cjjmaster).
- **Lane A (general, `claude/*`)**: FREE — gen-6 delivered #41 (PR #44). #45 (trim amortization) claimable low-priority.
- **Lane B (parametria-harness, `pm/*`)**: **BUSY — gen-10 on the NO_ADAPTER diagnosis** (branch `pm/issue-1-no-adapter`, non-closing PR; fix lands in preset/profile materials, freeze if it needs a patch or operator-settings change). Queue: #23/#24/#30/#45 available, #6 buildable, #7 owner-gated.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: **BUSY — gen-4 RESUMED on the rc.8 bump (#43)** after the npmMinimalAgeGate cleared at 15:42Z (RM ruled WAIT, zero policy change; steps 1-4 fenced at `44b3ac9ba6`). Folded into the resume: gated install + patch re-cuts (GNU-patch oracle; one directory-picker hunk genuinely regresses) + brand class re-derivation (railFish→railMark +5 classes, interacts with #28/#37) + does rc.8 reshape #40's reportDelivery surface + trademark-guidelines read for #26 + release-age check into the watch doc + bump-surface-omissions follow-up issue.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37) incl. the owner's lockup refinements.

## Queue (open GitHub issues, RM-triaged)

- **#1 [Lane B] Vision routing — PENDING-LIVE**, blocker now precisely NO_ADAPTER (gen-10 diagnosing). Closes on the first run where a validator child answers through parametria-vision.
- **#43 [Lane C] rc.8 pin bump** — IN PROGRESS (gen-4). Six fallout items pre-triaged on-issue.
- **#26 [Lane A/B] rebrand remainder** — open on: owner identity migrations (app.setName/userData · builder appId/productName · naming ruling) + locale copy. #23/#24/#30/#45 — claimable follow-ups (structural evidence surface · command-level policy · Host-plane real cost · trim amortization). **#40** — error-laundering fix, claimable AFTER #43 lands (patch surface moves with the pin). **#6** — A/B protocol, buildable (4 datums recorded; vision-path + verification-claim-fidelity axes established). **#7** — owner-gated (canonicalization).
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Live-run items:** agy sign-in still failing (antigravity status ERROR persists after sign-in — re-verify with `modlens doctor` or agy's own status); claude-cli vision fails under a SessionEnd hook cancellation (operator's Claude plugin config); codex spawn EINVAL (modlens Windows bug — report to @liustack?).
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` — rotate + move to `scripts/.env` (outside this repo's fleet surface; flagged only).
