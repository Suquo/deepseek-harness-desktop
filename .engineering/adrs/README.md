# ADRs — deepseek-harness-desktop (Suquo fork)

Durable architectural decisions for this fork live here as numbered ADRs. Numbered `H-NNNN` (Harness) to distinguish them from the `R-NNNN` corpus in `suquo-systems-rust` and from any upstream decision docs, so cross-repo references stay unambiguous.

This is the canonical location — `improve-codebase-architecture`, `grill-with-docs`, and the `engineer-*` skills all read from and write to this folder (wired via `paths.decisions_dir` in [`../config.yml`](../config.yml)). Transient implementation notes belong in `../plans/` and `../reports/`, not here.

Upstream (anywhere-labs) keeps its own decision notes under `.agents/notes/`; those govern the upstream product and are not edited here. Fork-specific decisions go in this folder.

## When to write an ADR

All three must be true:

1. **Hard to reverse** — meaningful cost to change later.
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth?"
3. **Result of a real trade-off** — alternatives existed and you picked one for specific reasons.

If a decision is easy to reverse, skip it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

## What qualifies (in this repo)

- Anything that changes how the fork relates to upstream: the pinned `deepseek-harness/` submodule + npm-package consumption model, the yarn `patches/` overlay, or a submodule pin bump policy.
- Deviations from the "everything is a plugin" composition rule — desktop capabilities compose through the official Cordis plugin path, never by forking upstream source.
- Parametria-harness composition choices: which upstream plugins are replaced, which Suquo-owned plugins are added, and where the `/suquo-systems-parametria` skill integration seam sits.
- The Yarn-outer / pnpm-submodule workspace split and anything that moves that boundary.
- Packaging and runtime-closure rules (asar/asarUnpack, physical runtime entries, Windows ACL sandbox) that releases depend on.
- Headless-safety guarantees: builds, typechecks, tests, and Loader smokes stay headless; graphical launch stays explicit.

## Accepted

- [H-0001 Fork strategy — Suquo Parametria harness as an overlay on pinned upstream](H-0001-fork-strategy-parametria-harness-overlay.md) (2026-08-19)
- [H-0002 Brand presentation overrides upstream client marks by class selector](H-0002-brand-override-by-upstream-class-selectors.md) (2026-08-20)
- [H-0003 Native icon sources derive from the vendored mark; the application icon stays a committed raster](H-0003-native-icons-derived-from-the-vendored-mark.md) (2026-08-20)

## File naming

`H-NNNN-kebab-slug.md`, sequential. Scan the folder for the highest existing number and increment. Never reuse numbers. Add each accepted ADR to the ledger above.

## Template

Copy `0000-template.md`. The minimal ADR is one paragraph:

```md
---
Status: accepted
Date: YYYY-MM-DD
---

# {Short title of the decision}

{1–3 sentences: what's the context, what did we decide, and why.}
```

That's it. `Status:` and `Date:` frontmatter are standard for saved ADRs. Optional Considered Options / Consequences sections **only when they add genuine value**.

## How the engineer loop uses ADRs

- **`engineer-plan`** reads relevant ADRs at start and lists them in the plan's `§ Constraints` section. If the plan contradicts an accepted ADR, that conflict is surfaced explicitly — never silently worked around.
- **`engineer-implement`** and **`engineer-quick`** include a mandatory `## Architectural Decisions Surfaced` section in their report. Each candidate decision is checked against the 3-criteria gate; qualifying ones become new ADRs **before** the run is marked complete.
- **`improve-codebase-architecture`** reads existing ADRs to avoid re-suggesting refactors they forbid. When a deepening candidate is rejected for a load-bearing reason, the skill offers to record it as an ADR.
