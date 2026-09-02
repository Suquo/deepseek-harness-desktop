# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**MACHINE MOVE + FLEET RESTART (2026-09-02, RM gen-AD, first Linux generation):** the fleet moved from Windows to Linux (cjjmaster, Omarchy/Arch; fresh clone, submodule at rc.8 `141eb6fe`). The RM `work-queue-progress` memory did NOT survive the migration — this generation booted from BOARD.md + live GitHub and started a fresh narrative. Charters/agent files ported to Linux paths (worktrees `~/.dsh-resolver-worktrees/issue-<n>`, `ss`/`lsof` for ports, no PowerShell). **Baseline `corepack yarn check` GREEN on Linux** (exit 0; desktop 814 passed / 4 skipped / 80 files; closure 200 nodes; licenses 543). `gh` default pinned to the fork (parent anywhere-labs was the default in the fresh clone — verify with `gh repo set-default --view`). Owner pushed 3 direct commits to master post-board (`44b52bd1` capture default-export, `e98776db`+`c5eaa322` parametria profile mounts the subagent provider bundles + pins dsh-sdk-protocol, 2026-08-28).

**TWO FINISHED BRANCHES, NO PRs — the Windows generations died one step from opening them (2026-08-21):** `claude/issue-55-pnpm-shim` @ `07257aef30` (Lane A gen-10; spec 24/24, mutation proofs posted) and `pm/issue-23-evidence-surface` @ `55b2d0f68a` (Lane B gen-13; full gate green at that SHA, 9 mutation proofs). Both merge CLEAN onto current master (merge-tree). Resumption gens spawned to rebase → re-gate on Linux → open the PR.

**UPSTREAM 2026-09-02: RM RULED INHERIT `dsh-v0.1.1-rc.2`** (Lane C gen-5 eval green; branch `up/pin-0.1.1-rc.2`; PR pending GUI smoke). The 0.1.2-alpha line stays deferred until it reaches rc. Overlay (anywhere-labs) 301 commits behind — not yet evaluated.

**28 merges lifetime.** In review: PR #65 (#55) + PR #66 (#23) APPROVE-PENDING-CI with merge chains armed; PR #72 (rc.2 pin bump, Lane C) under RM review, folding the #71 pin moves, second lander. New issues #67-#71 triaged (upstream fallout; #68 owner-visible; #69 pending-live). Pending-live adds: #23 evidence variable reaching a real shell call in a Parametria run.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **Lane runtime (owner ruling 2026-09-02)**: all NEW resolver spawns are Codex `gpt-5.6-sol` high (recipe in repo-manager-charter.md); the current Claude generations (A gen-11, B gen-14, C gen-5) finish their in-flight cycles first.
- **RM**: gen-AD LIVE (`/loop /repo-manager`, Herdr agent `dsh-rm`, w4:p1, cjjmaster Linux). Escalation path to the owner: Herdr `admin` agent.
- **Lane A (general, `claude/*`)**: **BUSY — gen-11 RESUMING #55** on the existing branch `claude/issue-55-pnpm-shim` (Herdr `dsh-lane-a`, w4:p2): rebase onto master, re-run the full gate on Linux, open the PR (`Closes #55`). Note: the shim work is Windows-runtime code; its spec runs headless on Linux, but the GUI-validated claims from gen-10 stay attributed to gen-10. Queue after: #64 (filed by gen-10) · #46 · #30.
- **Lane B (parametria-harness, `pm/*`)**: **BUSY — gen-14 RESUMING #23** on `pm/issue-23-evidence-surface` (Herdr `dsh-lane-b`, w4:p3): rebase onto master (owner's profile commits touch `dsh-preset-parametria/profile/` — re-run the drift/profile-patch suites), re-gate, open the PR. Queue after: #52 → #54 → #58 → #62.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: **BUSY — gen-5 PR #72 open** (rc.8 → `dsh-v0.1.1-rc.2`; GUI-smoked in `~/.dsh-lane-c`); folding #71 (3 profile pins + pinSurface fence) per RM ruling; rebases after #65/#66 merge.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37). Next: #48 (brand slots).

## Queue (open GitHub issues, RM-triaged)

- **In flight: #55 (Lane A gen-11 resume) · #23 (Lane B gen-14 resume) · upstream bump eval (Lane C gen-5).**
- Next up Lane B: #52 (route preflight banner) → #54 (read_image fallback) → #58 (continuable path) → #62 (deepseek/azure remainder). Claimable Lane A: #64 (electron/dist non-extraction) · #46 (version-literal drift) · #30 (real billed cost) · #45 (trim amortization, product call). Lane D: #48 (brand slots).
- Pending-live: **#24** (first validator-child capture through `parametria_capture`) · **#60** (bare-route datum; needs the running app relaunched from post-#61 source). **#6** — A/B protocol, buildable. **#26** — open on owner identity migrations + locale copy. **#7** — owner-gated.
- **#3 (CI)** — fork Actions EVENT triggers still dormant; RM merges on RM-dispatched `workflow_dispatch` runs (last 5 dispatch runs green, 2026-08-20/21).
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking — relayed via the admin agent)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Linux distributable:** upstream ships no Linux installer target (AppImage/deb). If the owner wants one on this machine, that is a new fork issue — say so and the RM files it.
- **Live-run items (carried from the Windows era, re-verify on Linux):** the installed pnpm shim execs from a stale deleted worktree — relaunch from the primary checkout regenerates runtime-commands (#55 fixes the loud-failure side); agy sign-in; claude-cli vision under SessionEnd hook cancellation; codex spawn EINVAL (was a modlens Windows bug — may be moot on Linux).
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: Pinecone API key** — literal REMOVED from all 4 skill-script copies by admin (2026-09-02; env / `scripts/.env` lookup now). Remaining with the owner: rotate the key (it lives in both private skill repos' history).
