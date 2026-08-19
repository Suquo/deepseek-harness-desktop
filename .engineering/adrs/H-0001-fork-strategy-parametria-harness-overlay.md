---
Status: accepted
Date: 2026-08-19
---

# ADR H-0001: Fork strategy — Suquo Parametria harness as an overlay on pinned upstream

## Context

Suquo maintains this fork of `anywhere-labs/deepseek-harness-desktop` to build a custom desktop harness for running the `/suquo-systems-parametria` skill against the Suquo Systems Convex backend. The upstream project is itself an overlay: official DeepSeek Harness runs unmodified at a pinned version (`upstream.json` + `deepseek-harness/` submodule, consumed as `@deepseek-ai/dsh-*` npm packages with a small yarn `patches/` set), and every desktop capability — window, tray, terminal, profiles, updates — composes as a Cordis plugin through the official plugin path.

## Decision

We keep that architecture rather than forking harness internals. Suquo customization lands as **additional plugins and profile composition on top of the pinned upstream**, in this repo's Yarn workspace, tracked with the Principled Agentic Engineering loop (`.engineering/`, GitHub Issues at `Suquo/deepseek-harness-desktop`, ADRs `H-NNNN`). The `deepseek-harness/` submodule stays unmodified and pin bumps stay separate from behavior changes (upstream AGENTS.md rules continue to apply). Divergence from upstream is limited to what plugins, yarn patches, and profile composition can express; if a needed seam doesn't exist, the preferred path is contributing the seam upstream or adding a minimal yarn patch — not editing the submodule.

## Considered Options

- **Fork the official deepseek-harness repo directly and modify core packages** — maximum freedom, but we'd own a permanent merge burden against a fast-moving monorepo and lose the ability to consume upstream releases as npm packages.
- **Build a standalone harness from the SDK** — cleanest isolation, but re-implements the desktop shell, plugin loader, sessions, and Web UI that the desktop overlay already provides.
- **Overlay on the desktop fork (chosen)** — inherits desktop packaging, profiles, and the plugin marketplace; keeps upstream unmodified and updatable by pin bump; matches the ecosystem's "everything is a plugin" convention.

## Consequences

- Parametria features must be expressible as Cordis plugins / profile bundles; pressure to edit `deepseek-harness/` directly signals a missing upstream seam, which becomes its own ADR-worthy decision.
- Tracking upstream means periodically syncing with `anywhere-labs/deepseek-harness-desktop` (git remote `upstream`) and re-validating the yarn `patches/` set on each pin bump.
