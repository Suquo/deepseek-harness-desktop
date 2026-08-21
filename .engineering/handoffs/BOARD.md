# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**#1 AND #53 CLOSED (2026-08-21 ~10:00): the founding issue is DELIVERED, proven by the operator's own morning runs** — four validator children across two runs, all `parametria-vision`/`google/gemini-3.6-flash`, all `turn/end: completed`; zero NO_ADAPTER, zero reasoning-400. Delivery chain: PR #8 → #19 → #22 → #50 → #59 → #61 (+#57 observability, +#63 capture). Pending-live remainder: #24 (first child capture via `parametria_capture`) and #60 (bare-route datum; the RUNNING app needs a relaunch from post-#61 source to carry the pi-ai patch).

**RELIEF-PLAN FLEET SCOPE MERGED + DEPLOYED (overnight 2026-08-20→21, AC generation, 5 merges #56/#57/#59/#61/#63):** error laundering dead on one-shot paths (#40, PR #57) · reasoning-400 fixed at route AND adapter (#53, PR #59+#61) · `parametria_capture` Host-plane tool live with env var set (#24 re-scoped by operator Option-C ruling, PR #63) · report published (PR #56). Follow-ups filed en route: #58 (continuable path) · #60 (bare-route, held open) · #62 (deepseek/azure remainder). Three RM-verified premise refutations this generation (plan §3a twice, #24-as-specced once).

**28 merges lifetime.** In flight: Lane B gen-13 (#23 evidence surface) · Lane A gen-10 (#55 pnpm shim).

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: AC generation LIVE (`/loop /repo-manager`, cjjmaster).
- **Lane A (general, `claude/*`)**: **BUSY — gen-10 on #55 RE-SCOPED (a)**: measurement refuted BOTH the issue premise AND the RM option-2 ruling (shim already packageManager-transparent, 5/5 cold+warm). Build = transparency invariant fence + std-9 existence/staleness fix in installDesktopPnpmRuntime (the stale-worktree exec mechanism) + 11.17.0 hygiene bump. Close permitted on headless fence-proof. #64 filed (electron/dist non-extraction). #45 low.
- **Lane B (parametria-harness, `pm/*`)**: **BUSY — gen-13 on #23** (evidence governance as a structural surface; dedupe EVIDENCE_ROOT_SEGMENT with the capture tool; freeze-with-options if designs diverge; branch `pm/issue-23-evidence-surface`). SURFACE: preset + desktop plugin. Queue after: #52 → #54 → #58.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-4 delivered the rc.8 bump (PR #47 merged on green: pin surface 166→173 incl. upstream package deletions inherited; GUI smoke caught a green-gate brand regression; official brand slots discovered → #48). Watch doc carries the age-gate lesson. #46/#49 filed from findings.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37) incl. the owner's lockup refinements.

## Queue (open GitHub issues, RM-triaged)

- **#1 CLOSED + #53 CLOSED (2026-08-21 morning): THE LIVE DATUM LANDED.** Two operator runs, four validator children — ALL on parametria-vision/gemini-3.6-flash, ALL `turn/end: completed`, zero NO_ADAPTER, zero reasoning-400. The fork's founding issue is delivered. Still pending-live: **#24** (first validator-child capture through `parametria_capture` — the morning runs predate #63's deploy) and **#60** (bare-route datum — the morning bare-route session predates the patch reaching the running app; NOTE: the running app needs a rebuild/relaunch from post-#61 source to carry the pi-ai patch).
- **In flight: #23 (Lane B gen-13) · #55 (Lane A gen-10).** Next up: #52 (route preflight banner — lower urgency now the route works) → #54 (read_image fallback) → #58 (continuable path). Claimable: #62 (deepseek/azure disable remainder) · #30 (real billed cost) · #45 (trim amortization) · #46 (version-literal drift) · #48 (brand slots, Lane D). Pending-live: #24 (child capture) · #60 (bare route). **#6** — A/B protocol, buildable (5 datums). **#26** — open on owner identity migrations + locale copy. **#7** — owner-gated.
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Live-run items:** RELAUNCH DSH Desktop from the primary checkout — the installed pnpm shim execs from a STALE deleted worktree (.pm-resolver-worktrees/issue-2), found by gen-10; relaunch regenerates runtime-commands. Also: agy sign-in still failing (re-verify with modlens doctor); claude-cli vision fails under a SessionEnd hook cancellation; codex spawn EINVAL (modlens Windows bug — report to @liustack?).
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: hardcoded Pinecone API key** in `~/.agents/skills/suquo-systems-parametria/scripts/query-grasshopper-kb.py` — rotate + move to `scripts/.env` (outside this repo's fleet surface; flagged only).
