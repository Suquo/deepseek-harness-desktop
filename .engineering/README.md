# deepseek-harness-desktop — Engineering Artifacts

Versioned artifacts produced by the **Principled Agentic Engineering** loop. See `Documents/.context/ENGINEERING.md` for methodology. Conventions mirror `suquo-systems-rust/.engineering`.

This fork is being turned into the **Suquo Systems Parametria harness** — a custom desktop harness for running the `/suquo-systems-parametria` skill — while staying an unmodified-upstream overlay (see [`adrs/`](adrs/README.md)).

## Layout

| Dir | Contents |
|---|---|
| `PRDs/` | One `<slug>.prd.md` per feature — written by `engineer-prd` |
| `stories/` | Story manifests (one per PRD), kept in sync with GitHub Issues |
| `plans/` | Active plan documents, one per issue |
| `plans/completed/` | Plans archived by `engineer-implement` after a successful run |
| `reports/` | Implementation reports — what shipped and how |
| `quick/` | Combined plan+impl+report files for `engineer-quick` runs |
| `adrs/` | Architecture Decision Records, numbered `H-NNNN` — durable architectural truths. See [`adrs/README.md`](adrs/README.md) |
| `handoffs/` | Fleet operating model: stable role charters (Repo Manager, lane resolvers) + `BOARD.md`, the RM-maintained live fleet state. See the fleet table in [`../AGENTS.md`](../AGENTS.md) |

## Tracker

GitHub Issues at `Suquo/deepseek-harness-desktop`. Convex Tracker is reserved for cross-cutting / fleet-wide work.

## Validation surface

Per-change loop: `corepack yarn build` / `corepack yarn typecheck` / `corepack yarn test` (no lint or e2e scripts exist). The full headless gate is `corepack yarn check`; Windows packaging smokes are `corepack yarn dist:win` / `dist:win-portable`. Graphical launch (`corepack yarn dev`) stays explicit and is never part of headless validation (AGENTS.md rule).

## Quick links

- Project entry point: [`../AGENTS.md`](../AGENTS.md)
- Methodology: `~/Documents/.context/ENGINEERING.md`
- Engineering config: [`./config.yml`](./config.yml)
- Upstream pin: [`../upstream.json`](../upstream.json) + `deepseek-harness/` submodule
