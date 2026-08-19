# BOARD — live fleet state (maintained by the Repo Manager on every merge/triage/ruling)

> Charters read this file at session start and verify against live GitHub (`gh issue list`, `gh pr list`).
> Live GitHub beats this file; this file beats memory of any prior session.
>
> **This file holds CURRENT state only.** History lives in the RM's `work-queue-progress` memory
> (per-tick narrative) and GitHub issues/PRs (ground truth). Maintenance rules: the **Now** section
> keeps at most the current entry + 2 priors (drop the tail on every update); actor lines describe
> the CURRENT generation only; resolved owner items are deleted, not struck through.

## Now

**FLEET BOOTSTRAPPED (2026-08-19, cjjmaster; operator appointed the RM in-session and will run `/loop /repo-manager`).**

- Engineering scaffold committed (`e74eaca3fb`): `.engineering/` (config, ADR ledger `H-NNNN`, H-0001 fork strategy) — then this fleet layer (charters, board, launchers, AGENTS.md fleet table).
- **App verified running from source**: `corepack yarn install` + `corepack yarn dev` → Electron shell up, Host Web UI serving on ephemeral loopback (verified HTTP 200). Environment lesson recorded: Electron stdout doesn't flush through pipes — verify liveness by process + port, not log tail.
- **First Parametria run harvested** (session export `Downloads/dsh-session-session-60658537-…`): APW-1200-0900-0600 workbench delivered (94 nodes, fully parametric, dimensions verified arithmetically via `inspect-definition`). Two learnings were written into `SKILL.md` by the run agent — **both verified landed** (vision-capability prerequisite ~L521; `transform.rotate` axis/OCCT re-confirmation ~L298). Residual found during verification: SKILL.md ~L115 still carries the old blanket "do NOT use transform.rotate (OCCT: No)" rule that L298 now contradicts → SK-1 below.

## Standing goal (owner ruling, 2026-08-19 — full text in repo-manager-charter.md)

Track upstream (harness releases + anywhere-labs overlay) WITHOUT breaking the Parametria-harness work; on breaking updates the RM decides inherit/adapt/hold-back/skip against the product mission; run-session exports are a standing insight-harvest input.

## Actors

- **RM**: appointment made 2026-08-19; the bootstrap session set up the fleet. First chartered generation launches with `/loop /repo-manager`.
- **Lane A (general, `claude/*`)**: FREE — no generation, no branches.
- **Lane B (parametria-harness, `pm/*`)**: FREE.
- **Lane C (upstream-sync, `up/*`, RM-spawned)**: FREE.
- **Lane D (design, `dg/*`, RM-spawned)**: FREE.

## Queue (RM-triaged; not yet filed as GitHub issues — filing is the first RM generation's call with the operator)

1. **[parametria-harness / Lane B] Vision-aware subagent model routing.** First-run finding: validator subagents inherit the session model; on text-only `deepseek-v4-flash` every image read failed while capture commands succeeded — *a failure mode that looks like success*. The skill now guards this; the HARNESS should solve it structurally: compose agent presets / model routing so validator-class subagents get a vision-capable model (upstream plugins in play: `dsh-agent-presets`, `dsh-agent-default-model`, `dsh-subagent`). This is the seed feature of the Parametria work profile.
2. **[parametria-harness / Lane B] Parametria work profile.** Define the desktop profile composition for Parametria runs (skill availability, model config, permission preset) so a run doesn't depend on hand-arranged session state.
3. **[ci / Lane A] Stand up CI** (GitHub Actions: `corepack yarn check` on PR) — until then, "required CI" = the full local gate pasted in the PR body (charter rule).
4. **[upstream / Lane C] Upstream watch cadence.** Current pin `0.1.0-rc.7` (`99f6f02fec`) = latest release at bootstrap; anywhere-labs `upstream` remote last merged at `3352bd1b20`. Establish the release-watch tick and the pin-bump eval protocol per the standing goal.
5. **[skill, outside this repo] SK-1: reconcile SKILL.md ~L115 vs ~L298** — the old blanket `transform.rotate` prohibition contradicts the re-confirmed guidance; a future run reading L115 first re-imports the confusion the run agent just resolved. (Skill lives at `~\.agents\skills\suquo-systems-parametria\`; not versioned here — needs its own landing surface, RM to raise with operator.)
6. **[skill, outside this repo] SK-2: node-catalog refresh.** `references/node-catalog.md` is provably stale (`transform.rotate` inputs + OCCT flag); a regeneration pass from the live app would retire the whole staleness class instead of patching entries one by one.

## Owner items (batched, non-blocking)

- **File the queue as GitHub issues?** The board carries the seed queue; say the word and the RM files them with labels (`parametria-harness`, `ci`, `upstream`) at Suquo/deepseek-harness-desktop.
- **SK-1/SK-2 landing surface**: the skill folder isn't a git repo tracked by this fleet — where should skill changes be reviewed (skills repo? sync-skills flow?).
