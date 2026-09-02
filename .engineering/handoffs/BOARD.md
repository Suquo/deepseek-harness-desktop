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

**UPSTREAM 2026-09-02: `dsh-v0.1.1-rc.2` LANDED (PR #72).** Open fallout: #67 (boot-global docs), #68 (image pipeline — OWNER real-platform datum needed), #69 (deepseek wire pending-live), #70, #73 (notices generator). Next: `dsh-v0.1.2` line deferred until it reaches rc; overlay (anywhere-labs, 301 behind) still unevaluated — Lane C's next scope. Overlay (anywhere-labs) 301 commits behind — not yet evaluated.

**32 merges lifetime** (PR #74 → #64 CLOSED: `check:electron` self-heals the Electron binary in fresh worktrees and CI) (PR #72 2026-09-02: PIN = `dsh-v0.1.1-rc.2` / submodule `b150a551b8`, surface 184 incl. the parametria profile template now fenced; #71 CLOSED) (PR #65 → #55 CLOSED 2026-09-02: shim transparency fenced, stale-target guard exits 78 with a named diagnostic, pnpm 11.17.0) (PR #66 → #23 CLOSED 2026-09-02: evidence surface is structural — `DSH_PARAMETRIA_EVIDENCE_DIR` published per shell call; live datum pending). In review: PR #72 (rc.2 pin bump, Lane C) under RM review, folding the #71 pin moves, second lander. New issues #67-#71 triaged (upstream fallout; #68 owner-visible; #69 pending-live). Pending-live adds: #23 evidence variable reaching a real shell call in a Parametria run.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **Lane runtime (owner ruling 2026-09-02)**: all NEW resolver spawns are Codex `gpt-5.6-sol` high (recipe in repo-manager-charter.md); the current Claude generations (A gen-11, B gen-14, C gen-5) finish their in-flight cycles first.
- **RM**: gen-AD LIVE (`/loop /repo-manager`, Herdr agent `dsh-rm`, w4:p1, cjjmaster Linux). Escalation path to the owner: Herdr `admin` agent.
- **Lane A (general, `claude/*`)**: gen-12 (Codex) delivered #64 (PR #74). **Next: gen-13 (Codex) on #67** (boot-global injection docs/verifier follow-up), worktree `~/.dsh-resolver-worktrees/issue-67` being prepared. Queue after: #70 → #73 → #46 → #30.
- **Lane B (parametria-harness, `pm/*`)**: **BUSY — gen-15 (CODEX `dsh-lane-b`, w4:p3) on #52** (boot-time route preflight banner). Queue after: #54 → #58 → #62.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-5 (last Claude gen) landed rc.2 (PR #72). Next spawn = CODEX: anywhere-labs overlay evaluation (301 commits behind).
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37). Next: #48 (brand slots).

## Queue (open GitHub issues, RM-triaged)

- **In flight: #52 (Lane B gen-15, PR #75 APPROVE-PENDING-CI, chain armed).**
- Next up Lane B: #52 (route preflight banner) → #54 (read_image fallback) → #58 (continuable path) → #62 (deepseek/azure remainder). Claimable Lane A: #64 (electron/dist non-extraction) · #46 (version-literal drift) · #30 (real billed cost) · #45 (trim amortization, product call). Lane D: #48 (brand slots).
- Pending-live: **#24** (first validator-child capture through `parametria_capture`) · **#60** (bare-route datum; needs the running app relaunched from post-#61 source). **#6** — A/B protocol, buildable. **#26** — open on owner identity migrations + locale copy. **#7** — owner-gated.
- **#3 (CI)** — fork Actions EVENT triggers still dormant; RM merges on RM-dispatched `workflow_dispatch` runs (last 5 dispatch runs green, 2026-08-20/21).
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking — relayed via the admin agent)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Linux distributable:** upstream ships no Linux installer target (AppImage/deb). If the owner wants one on this machine, that is a new fork issue — say so and the RM files it.
- **Packaged app REBUILT at rc.2 by admin (2026-09-02, master fd3bd7bd, dist/linux-unpacked)** — the owner's next launch carries the new pin. Awaiting the first-run report: image-attachment behaviour (#68 datum) and any DeepSeek run (#69 pending-live).
- **Live-run items (carried from the Windows era, re-verify on Linux):** the installed pnpm shim execs from a stale deleted worktree — relaunch from the primary checkout regenerates runtime-commands (#55 fixes the loud-failure side); agy sign-in; claude-cli vision under SessionEnd hook cancellation; codex spawn EINVAL (was a modlens Windows bug — may be moot on Linux).
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: Pinecone API key** — literal REMOVED from all 4 skill-script copies by admin (2026-09-02; env / `scripts/.env` lookup now). Remaining with the owner: rotate the key (it lives in both private skill repos' history).
