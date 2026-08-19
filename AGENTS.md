# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the desktop development workflow with `corepack yarn dev`.
- Build the desktop package with `corepack yarn build`.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).

## Fleet roles (Suquo fork — charter + live-board succession model)

This fork is maintained by a standing multi-agent workflow adopted from the suquo-systems-rust fleet. Each role has a **stable charter** (rules that rarely change) and derives its **live state** from `.engineering/handoffs/BOARD.md` plus live GitHub at session start — a fresh session needs no hand-written prompt.

| Role | Launch (in a fresh session) | Charter | Cardinality |
|---|---|---|---|
| **Repo Manager** — reviews, verdicts, merges, maintains docs/BOARD.md, owns the standing upstream-tracking goal | `/loop /repo-manager` | `.engineering/handoffs/repo-manager-charter.md` | exactly one |
| **Lane A Resolver (general)** — one issue at a time, end-to-end; `claude/` branches, ports 3400+ | `/loop /resolver` | `.engineering/handoffs/resolver-charter.md` | exactly one per lane |
| **Lane B Resolver (Parametria harness)** — `parametria-harness` issues first, RM-assigned general issues otherwise; `pm/` branches, ports 3500+ | `/loop /resolver-parametria` | `.engineering/handoffs/resolver-parametria-charter.md` | exactly one per lane |
| **Lane C Resolver (upstream-sync)** — submodule pin bumps, yarn `patches/` re-validation, anywhere-labs merge tracking; `up/` branches, ports 3600+ | RM-spawned agent only | `resolver-charter.md` + lane deltas at spawn | exactly one |
| **Lane D Resolver (design)** — strictly frontend design (client-plugin CSS/layout/visual/theming; no Host behavior, no packaging); `dg/` branches, ports 3700+ | RM-spawned agent only | `resolver-charter.md` + lane deltas at spawn | exactly one |

The `/loop` wrapper (self-paced, no interval) establishes autonomous ticking for the standing roles. Succession: a generation at its context ceiling drives to a durable state, notifies the operator, and stops — relaunch is one slash command in a fresh session. Durable state lives in pushed commits, GitHub issues/comments, and BOARD.md — never in session context. A Workspace Manager reviewer role is not yet established here.

Fleet roles operate on GitHub at `Suquo/deepseek-harness-desktop` (branches, PRs, issues) — the chartered exception to the home-directory local-only git default. Never push to the `upstream` (anywhere-labs) remote.

If you are reading this WITHOUT having been launched via one of the commands above, you are not one of these roles — do not claim queue items, post verdicts, or merge.

## Architectural Decisions (Suquo fork)

This fork is maintained by Suquo as the base for the **Suquo Systems Parametria harness**. Durable fork-level decisions are recorded as ADRs in [`.engineering/adrs/`](.engineering/adrs/README.md) (numbered `H-NNNN`; upstream's own decision notes stay in `.agents/notes/` and are not edited here). The engineering loop is wired at both ends:

- **`engineer-plan`** reads relevant ADRs and lists them in each plan's `§ Constraints` section. Plans that contradict an accepted ADR must surface the conflict explicitly.
- **`engineer-implement`** and **`engineer-quick`** include a mandatory `## Architectural Decisions Surfaced` section in their report. Decisions that pass the 3-criteria gate (hard to reverse / surprising without context / real trade-off) become new ADRs before the run is marked complete.
- **`improve-codebase-architecture`** and **`grill-with-docs`** read ADRs to avoid re-litigating decided questions.

The pinned-upstream rule above ("never edit `deepseek-harness/` from a desktop branch") is exactly the shape of decision this folder records — see [H-0001](.engineering/adrs/H-0001-fork-strategy-parametria-harness-overlay.md) for the fork strategy. Transient implementation notes belong in `.engineering/plans/` and `.engineering/reports/` — those are work artifacts, not decisions. Engineering config (tracker, validation matrix, release contract) lives in [`.engineering/config.yml`](.engineering/config.yml).
