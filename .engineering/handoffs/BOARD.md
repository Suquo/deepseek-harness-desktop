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

**40 merges lifetime** (PR #85 → #81 CLOSED: fork-owned `dshReleaseMatrix` declares notice coverage, fenced two-direction against `build`; ADR H-0005) (PR #84 → #58 CLOSED: continuable subagent failures now carry the real diagnostic, unconditionally like the one-shot path) (PR #82 → #78 CLOSED: every `*.i18n.yaml` record in the repo fenced through one shared checker) (PR #79 → #54 stays OPEN pending-live: text-only `read_image` now falls back to `parametria-vision` in the parametria profile) (PR #80 → #73 CLOSED: notices walk platform-independent; committed file byte-fenced in the gate) (PR #77 → #70 CLOSED: every `.agents/notes` bilingual record fenced, three directions) (PR #76 → #67 CLOSED: `verify:profile` asserts the structured boot row AND the served page) (PR #75 → #52 CLOSED: boot-time route preflight banner in the parametria profile; lands on the operator's next `install:profile`) (PR #74 → #64 CLOSED: `check:electron` self-heals the Electron binary in fresh worktrees and CI) (PR #72 2026-09-02: PIN = `dsh-v0.1.1-rc.2` / submodule `b150a551b8`, surface 184 incl. the parametria profile template now fenced; #71 CLOSED) (PR #65 → #55 CLOSED 2026-09-02: shim transparency fenced, stale-target guard exits 78 with a named diagnostic, pnpm 11.17.0) (PR #66 → #23 CLOSED 2026-09-02: evidence surface is structural — `DSH_PARAMETRIA_EVIDENCE_DIR` published per shell call; live datum pending). In review: PR #72 (rc.2 pin bump, Lane C) under RM review, folding the #71 pin moves, second lander. New issues #67-#71 triaged (upstream fallout; #68 owner-visible; #69 pending-live). Pending-live adds: #23 evidence variable reaching a real shell call in a Parametria run.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **Lane runtime (owner rulings 2026-09-02)**: all resolver spawns are Codex `gpt-5.6-sol` high with the 'Approve for me' preset (`-a on-request -c approvals_reviewer=auto_review`; recipe in repo-manager-charter.md) — applies to NEW spawns, in-flight lanes (A gen-14 #70, B gen-16 #54, spawned with `-a never`) finish their cycle. RM relaunches in Claude AUTO mode (`--permission-mode auto`). **Governors (owner 2026-09-02 18:10):** lane spawns use `-m $(cat ~/.codex/resolver-model)`; RM relaunch uses `--model $(cat ~/.claude/rm-model-state)`; live `/fast` / `/model` sends from the governors are accepted, never undone.
- **POWER LOSS 2026-09-02 ~17:44 (battery):** every session died; RM gen-AE booted from durable state. Lane A gen-17 died mid fix-cycle on #85 (2 fix commits were unpushed in the worktree — preserved); Lane B gen-18 had produced nothing on #62.
- **RM**: gen-AE LIVE (`/loop /repo-manager`, Herdr agent `dsh-rm`, w4:p1, cjjmaster Linux). Escalation path to the owner: Herdr `admin` agent.
- **Lane A (general, `claude/*`)**: gen-16 (Codex) delivered #78 (PR #82). gen-18 (Codex) delivered #81 (PR #85). **BUSY — gen-19 (CODEX `dsh-lane-a`, w4:p2) on #30** (real billed cost: Road B reconciliation, Host plugin + loopback route + `billed` state; freeze with the plan first). Queue after: #83 → #46.
- **Lane B (parametria-harness, `pm/*`)**: gen-17 (Codex) delivered #58 (PR #84). **BUSY — gen-19 (CODEX `dsh-lane-b`, w4:p3) on #62, fresh start** (deepseek/azure reasoning-disable remainder; ground-first, freeze with the per-dialect tolerance map). Queue after: #30 (if Lane A is busy) · then Lane B is out of buildable parametria issues — pending-live #24/#54/#60 need operator data.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE — gen-5 (last Claude gen) landed rc.2 (PR #72). Next spawn = CODEX: anywhere-labs overlay evaluation (301 commits behind).
- **Lane D (design, `dg/*`, RM-spawned)**: FREE — gens 1-3 delivered the full in-app rebrand (#28/#37). Next: #48 (brand slots).

## Queue (open GitHub issues, RM-triaged)

- **Triage advisor (owner 2026-09-02):** `.engineering/handoffs/TRIAGE.md` (daily 07:30, git-excluded) ranks open issues by user impact; the RM reads it before each lane claim and notes deviations here. **First list 2026-09-02 16:13Z consulted:** top ranks #54/#60/#69/#24/#68 are pending-live (operator data, not buildable) and #7 is owner-gated, so the first buildable rank is **#30** (S2). RM FOLLOWS triage: Lane A's next claim after #85 = #30 (ground-first: measure post-stream `usage.cost` availability before choosing patch-pair vs generation-id reconciliation), assigned cross-lane because Lane B is busy on #62. The board's earlier #83 → #46 order (both S4) drops behind #30; #45 stays a product call for the owner.

- **In flight: #30 (Lane A gen-19, plan APPROVED, implementing Tasks 1-6) · #62 (Lane B gen-19, PR #86 APPROVE-PENDING-CI @e41e6cfa, chain armed on run 33657879633).**
- Next up Lane B: #52 (route preflight banner) → #54 (read_image fallback) → #58 (continuable path) → #62 (deepseek/azure remainder). Claimable Lane A: #83 · #46 (version-literal drift) · #45 (trim amortization, product call — owner). Lane D: #48 (brand slots).
- Pending-live: **#54** (text-only session + no healthy modlens → one decisive image read; profile reinstalled by admin 2026-09-02 on a374f7d4 — lands at the app's next relaunch) · **#24** (first validator-child capture through `parametria_capture`) · **#60** (bare-route datum; needs the running app relaunched from post-#61 source). **#6** — A/B protocol, buildable. **#26** — open on owner identity migrations + locale copy. **#7** — owner-gated.
- **#3 (CI)** — fork Actions EVENT triggers still dormant; RM merges on RM-dispatched `workflow_dispatch` runs (last 5 dispatch runs green, 2026-08-20/21).
- **[skill, outside repo] SK-1/SK-2/SK-3/SK-4** — await the owner's landing-surface ruling.

## Owner items (batched, non-blocking — relayed via the admin agent)

- **#3 — the fork Actions tab enable-workflows click** (UI-only; ruleset `master-required-checks` is active with admin bypass; #3 closes on the first real PR-event rollup).
- **Linux distributable:** upstream ships no Linux installer target (AppImage/deb). If the owner wants one on this machine, that is a new fork issue — say so and the RM files it.
- **Packaged app REBUILT at rc.2 by admin (2026-09-02, master fd3bd7bd, dist/linux-unpacked)** — the owner's next launch carries the new pin. Awaiting the first-run report: image-attachment behaviour (#68 datum) and any DeepSeek run (#69 pending-live).
- **Live-run items (carried from the Windows era, re-verify on Linux):** the installed pnpm shim execs from a stale deleted worktree — relaunch from the primary checkout regenerates runtime-commands (#55 fixes the loud-failure side); agy sign-in; claude-cli vision under SessionEnd hook cancellation; codex spawn EINVAL (was a modlens Windows bug — may be moot on Linux).
- **Upstream report candidates (anywhere-labs / deepseek-harness):** PR #79 carries a 29-line yarn patch giving `dsh-tool-fs`'s `assertImageCapableRoute` a composition-answered fallback hook (`fs/read-image-route`) — propose upstream once live-proven; plus the appendOwned quadratic + O_TRUNC EINVAL forensics below.
- **Rulings pending:** skill-root canonicalization (#7) · SK-1..4 landing surface · rebrand identity migrations + product NAMING ("DSH Terminal" → ?) · report the appendOwned quadratic + O_TRUNC EINVAL forensics to anywhere-labs? · modlens into the parametria profile?
- **SECURITY: Pinecone API key** — literal REMOVED from all 4 skill-script copies by admin (2026-09-02; env / `scripts/.env` lookup now). Remaining with the owner: rotate the key (it lives in both private skill repos' history).
