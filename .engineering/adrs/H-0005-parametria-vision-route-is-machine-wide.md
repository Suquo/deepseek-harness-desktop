---
Status: accepted
Date: 2026-08-20
---

# The Parametria validator's provider route is declared machine-wide, as a guest block in the operator's patch layer

The `parametria` agent preset installs into `$DSH_HOME/.agent-presets/`, which **every**
profile scans (`includeUserRoot` is on by default), and it pins its `subagent_validator`
row to `agentOptions.provider: parametria-vision`. The route answering that pin was
declared in `$DSH_HOME/profiles/parametria/cordis.patch.yml`, which **one** profile
reads. Nothing couples the two planes and nothing refuses at composition time, so under
any other profile the persona loaded, the validator spawned, each child carried the
correct route config — and every child died at its first request with
`no adapter registered for provider "parametria-vision"` (`NO_ADAPTER`). Issue #1 lost
two live runs to that asymmetry while every static fence stayed green.

We decided the route belongs on the plane the preset already occupies: the installer now
declares it in the machine-wide `$DSH_HOME/cordis.patch.yml`, as a block delimited by its
own markers, and the profile-level copy is retired. Upstream applies that layer after
every profile's own — in the desktop launcher (`prepareDesktopProfile` composes
`[...bundlePatches, ...profile.patches, ...homePatches]`) and in the CLI alike — so one
declaration reaches every profile on both surfaces.

## Considered Options

**Keep the route profile-scoped and make the mismatch loud** (an installer refusal when
the launcher's persisted selection names another profile). Implemented first, then
rejected on the owner's ruling, and the reason is the trade-off: four runs of revealed
behaviour say the operator lives on the `desktop` profile — `@liustack/modlens` as a
third bundle, the codex and claude-code subagent providers, the session-cost tab, all
hand-added there — while using this preset. A refusal would have been correct about the
defect and wrong about the remedy: it told the operator to abandon their working
toolchain to compensate for an asymmetry that was ours. The route is an additive dormant
provider block, costing nothing where nothing asks for it, so the cheaper side to move
was ours.

**Keep a copy in the profile as a fallback.** Rejected. An id-targeted patch replaces the
row's whole config and the home layer is applied last, so a profile copy is outranked by
construction: it can never change behaviour, only drift away from the machine block and
mislead the next reader. `tests/machine-patch.test.mjs` now fences the absence as well as
the presence, in both directions.

**Declare the route in `$DSH_HOME/settings.yaml` under `llm-pi-ai.providers`.** Rejected
on grounding. The adapter would merge it correctly — `dsh-settings` merges layers key by
key, so it would sit beside the operator's `openrouter` route — but the web Models page
rewrites that document, so this installer could hold no durable claim over what it wrote.

## Consequences

The installer now edits a file it does not own. `$DSH_HOME/cordis.patch.yml` is upstream's
machine-wide layer *for the operator*, so the claim is a delimited block rather than the
file: it creates the file when absent, appends when the file exists without a block,
replaces its own block while the receipt still matches, and refuses otherwise — a
hand-edited block, one with no receipt, an unterminated one, or a machine patch that
already targets the `llm-pi-ai` row itself (two entries for one row is legal upstream and
the later replaces the earlier's whole config, so appending would silently delete one of
two intents). The refusal fires before any file lands, and the block is read back after
the write, because the claim is only true if the harness can see it.

`--force` releases this installer's claim over its **own** block only. It is deliberately
not a release for the operator's own `llm-pi-ai` row or for a block of unknown extent, and
those two refusals say so rather than advertising a flag that would refuse again.

This decision is the mirror of `H-0003`: that one let the installer write launcher state
outside `$DSH_HOME` under an explicit flag and only into absence; this one lets it write
inside `$DSH_HOME` into a file the operator authors, unflagged, but only between markers
it can prove are its own. Both rest on the same rule — the installer may claim only what
it can later recognise as its own.

The provenance for the machine-plane claim is recorded in the receipt at
`$DSH_HOME/profiles/parametria/.dsh-preset-parametria.install.json`, i.e. in the profile
directory the route no longer depends on. That is a known wart, kept because the receipt
is the installer's single claim ledger and splitting it would create two. Losing that
directory downgrades a later re-install from `update` to the "no receipt for" refusal,
which `--force` does release; it never causes a silent overwrite.
