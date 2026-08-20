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
- Compatibility mode must run the upstream default client without BEHAVIOR overrides. **Permitted in compatibility mode (owner rulings 2026-08-20, issues #26 and #5/#36): visual branding overrides (styles, marks, wordmarks, titles/icons) and ADDITIVE desktop-owned UI that alters no upstream behavior** (e.g. injecting a read-only surface into a documented slot) — never replacing or altering upstream slots, services, or behavior there. Replacing documented slots or services remains profile-composition territory (advanced mode).
- Keep graphical application launch explicit. NO step of the headless gate may launch a GUI or reach the operator browser — builds, typechecks, unit tests, and every smoke (Loader, profile, CLI, or any added later) included; the list is examples, not a boundary (lesson: rc.8 openBrowser, issue #49 — the standard could not name its own incident).
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).

## Continuous integration

`.github/workflows/ci.yml` is inherited from this repository's fork parent (anywhere-labs) and is this fork's CI. It is **not** the pinned upstream's workflow: `deepseek-harness/` carries its own, different `.github/workflows/ci.yml`, which nothing in this repository runs. It triggers on pull requests to `master`, pushes to `master`, and `workflow_dispatch`. Jobs:

| Job | Runner | What it runs |
|---|---|---|
| `changes` | ubuntu-latest | Classifies the diff through `scripts/classify-ci-changes.mjs` into a `product` output the other jobs read |
| `check` | ubuntu-latest | `yarn check` — the complete headless gate |
| `desktop-windows` | windows-latest | `yarn check`, then `dist:win` and `dist:win-portable` reusing its build |
| `desktop-macos` | macos-latest | `yarn check`, then the unsigned `dist:mac-smoke`. No signing secrets reach CI |
| `upstream-command-windows` | windows-latest | `yarn check:layout` and `yarn upstream:version` — the `upstream:*` portable-shell scripts must resolve the submodule's own toolchain on Windows |

The gate therefore runs on both a Linux and a Windows runner. Windows is the primary development platform, so a Windows-only regression is caught by `desktop-windows` rather than by `check`.

Four jobs read the `product` output, and they skip documentation-only diffs by two different mechanisms — which matters if any of them is ever made a required check. One of the four, `check`, has **no** job-level `if`: it always runs and always reports, because its steps are individually gated, so a documentation-only diff reduces it to a single announcing step. The other three (`desktop-windows`, `desktop-macos`, `upstream-command-windows`) carry a job-level `if`, so a documentation-only diff leaves them *skipped* rather than passed.

**Every job that runs the gate must check out the submodule (`submodules: recursive`).** The gate reads the pinned upstream checkout, so a job without it fails at the gate's first step:

- `scripts/verify-layout.mjs` — which is `check:layout`, the first command in `yarn check` — reads `deepseek-harness/package.json`, then asserts the submodule index entry, the checked-out commit, working-tree cleanliness, the `origin` URL, and the upstream package version against `upstream.json`.
- `dsh-preset-parametria`'s drift tests read upstream fixtures such as `deepseek-harness/apps/cli/config/agent-presets/standard/agent.cordis.yml` and `deepseek-harness/packages/bundle/base/cordis.patch.yml`.

Only *part* of the workflow is fenced. `dsh-plugin-desktop/tests/package.spec.ts` pins the packaging jobs' shape (`runs the full gate once before reusing native packaging outputs on Windows`) and the documentation-only classifier's behaviour (`skips product packaging only for documentation-only changes`), so edits there must move those assertions in the same change. Nothing asserts the existence of the `check` job, any runner choice, or any `submodules: recursive` line — the submodule rule above is enforced only by the gate failing on a runner that omits it, not by a test.

CI is headless throughout — no job launches the GUI, per the headless-safety rule above. `master` currently carries no branch protection or ruleset, so CI results are advisory rather than blocking; until required status checks are configured, the resolver charter's rule stands that "required CI" means the full local gate pasted in the pull-request body.

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
