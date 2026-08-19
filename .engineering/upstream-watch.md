# Upstream watch and pin-bump eval protocol (Lane C)

How this fork stays current with the two upstreams it tracks, and what has to happen
before a pin moves. Established on issue #4 under the RM's STANDING GOAL
(`repo-manager-charter.md`) and ADR [H-0001](adrs/H-0001-fork-strategy-parametria-harness-overlay.md).

**Division of authority.** Lane C *observes, trials, and reports*. The
inherit / adapt / hold-back / skip decision is the RM's, always — the standing goal
assigns it there explicitly. A Lane C generation that finds itself choosing has
already overstepped; the correct move is a freeze report with the delta.

## The two upstreams

| | Harness source | Desktop overlay |
|---|---|---|
| Repository | `deepseek-ai/deepseek-harness` | `anywhere-labs/deepseek-harness-desktop` |
| How we consume it | pinned submodule `deepseek-harness/` + `@deepseek-ai/dsh-*` npm packages at an exact version, with a yarn `patches/` set over them | git remote `upstream`, merged into our `master` |
| Where the pin lives | `upstream.json` (`commit`, `sourceVersion`, `runtimePackageVersion`) + the submodule gitlink recorded in our tree | the merge-base of `origin/master` and `refs/remotes/upstream/master` |
| Moves by | a pin-bump PR (this protocol) | a merge PR from `upstream/master` |

Neither remote is ever pushed to. `git push upstream` is forbidden by AGENTS.md.

## The watch script

```
node scripts/upstream-watch.mjs             # human-readable report
node scripts/upstream-watch.mjs --json      # machine-readable, same facts
node scripts/upstream-watch.mjs --offline   # local facts only, no network
```

It reports releases/commits behind on both sides, the `patches/` inventory (which
patches are pinned to the harness version, what files each one targets, whether each
is actually wired through `resolutions` *and* present as a `patch:` locator in
`yarn.lock`), and the **bump surface**: every manifest entry pinned exactly to the
current `runtimePackageVersion`.

Guarantees, because a watch that can mutate is not a watch: it never fetches, never
pushes, never bumps, and never touches the submodule. All git access goes through one
helper with a read-only subcommand allowlist that throws on anything else; all network
reads are `gh api` GETs. It reads the submodule pin out of the committed tree, so it
works in checkouts where `git submodule update --init` never ran.

It is deliberately **not** part of `corepack yarn check` — the headless gate stays
offline and deterministic. Run it by hand (or from the RM's tick), not from CI.

Two reading rules:

- `--offline` and a failed `gh api` call both render as `(unknown)`, never as `0`.
  "We could not look" is not "we are current"; the final ACTION line says so.
- The local `upstream/master` ref being stale does **not** distort `last merged`: a
  merge-base only moves when a merge actually lands. A stale ref is reported as such.

## Cadence

- **Every RM tick** that involves a board update: run `node scripts/upstream-watch.mjs`.
  It costs a few seconds and seven read-only API GETs. Record the two headline numbers
  (releases behind, overlay commits behind) in the RM's memory iteration entry.
- **Harness releases behind > 0** ⇒ the RM spawns a Lane C generation for a *trial*
  pin bump (below). New harness releases are the event this whole protocol exists for.
- **Overlay commits behind** is expected to be large and to grow; the parent repo is
  very active. It is a standing number, not an alarm. The RM pulls the overlay when a
  named upstream change is wanted, or when the drift starts costing merge effort —
  not on a count threshold.
- **Any `WARNINGS` block** ⇒ read it before anything else. Pin drift between
  `upstream.json` and the submodule gitlink, or a patch that no longer reaches the
  installed tree, means the tree is already inconsistent and no bump should start.
- A **skipped** pin is re-evaluated at the next release, never silently forever
  (standing goal). The skip record names the release it was skipped at, so the next
  watch run makes the omission visible.

## Trial pin bump

Always in a Lane C worktree, on an `up/` branch, never in the primary checkout. The
trial is an experiment whose output is a report — it becomes a PR only if the RM's
decision is "inherit" or "adapt".

1. Move the submodule **gitlink** to the new release tag (checkout inside the
   submodule + `git add deepseek-harness` from the parent). This updates which commit
   we point at; it never edits upstream files, which stays forbidden.
2. Update `upstream.json`: `commit`, `sourceVersion`, `runtimePackageVersion`.
3. Move the whole **bump surface** the script enumerated — currently **166** entries:
   96 exact `@deepseek-ai/dsh*` dependency pins in `dsh-plugin-desktop/package.json`,
   61 dev+peer pins in `dsh-community-market/package.json`, and 9 root `resolutions`
   selectors. Re-run the script after editing; the count must reach zero at the old
   version.
4. Rename the harness-versioned patch files to the new version and repoint the
   matching `resolutions` entries. **The pair moves together** (AGENTS.md).
5. `corepack yarn install` (not `--immutable`) to regenerate `yarn.lock`, then
   re-validate every patch (next section).
6. `corepack yarn check` in the foreground.

`check:layout` is the drift guard that catches a half-done bump: it asserts the
submodule index SHA, the submodule's checked-out HEAD, a clean submodule worktree, the
submodule's `package.json` version, and every `@deepseek-ai/dsh*` dependency of
`dsh-plugin-desktop` against `upstream.json`.

**Known blind spot** (`scripts/verify-layout.mjs` ~L133): that last assertion covers
`dsh-plugin-desktop.dependencies` only. `dsh-community-market`'s 61 dev+peer pins at
the same version are **not** guarded — a bump could leave them behind and
`check:layout` would still pass. Until the guard is widened, step 3 is a manual
obligation and the watch script's bump-surface count is what makes it checkable.

## Patch re-validation checklist

Run for **every** patch in `patches/`, not only the ones that failed to apply. A patch
that applies cleanly to relocated code is the dangerous case, not the safe one.

For each patch:

- [ ] **It still applies.** `corepack yarn install` fails loudly when a patch does not.
      A clean install is necessary, never sufficient.
- [ ] **It reached the tree.** `corepack yarn why <package>` shows consumers resolving
      through the `patch:` locator. A `resolutions` entry only expresses intent; the
      lockfile locator is the proof. The watch script counts both.
- [ ] **Every selector moved.** Some packages carry both an exact (`npm:X`) and a caret
      (`npm:^X`) selector, some only one. A half-updated selector set silently leaves
      part of the tree unpatched — and `yarn install` will not complain.
- [ ] **The hunk still means what it meant.** Read the patched region at the new
      version. Zero-context hunks (`@@ -840 +840,2 @@`) relocate quietly.
- [ ] **The covered behavior is re-tested at the new pin**, by the test that covers it
      or by hand if none does. Naming the behavior is part of the PR body.

Per-patch specifics as of `0.1.0-rc.7`:

| Patch | Target | Behavior to re-test | Hazard |
|---|---|---|---|
| `app-builder-lib@26.15.7` | `out/codeSign/macCodeSign.js` | macOS signing path | **Not** harness-versioned — moves with electron-builder, not with the pin. Leave it alone during a pin bump. |
| `dsh-app-boot` | `lib/index.js` (patch-list parsing) | app boot + patch list | — |
| `dsh-client-ui-directory-picker-browse` | `lib/client.js` + 2 `.d.ts` | directory browse UI | 15 hunks — by far the largest; expect the most conflict here. |
| `dsh-client-ui-workspace` | `lib/client.js` | workspace client UI | — |
| `dsh-llm-deepseek` | `lib/index.js` (response translation) | **provider wire** | Charter rule: a change to what reaches the provider's wire is not resolved by a green gate. Keep the issue open pending a live provider datum. |
| `dsh-sandbox-windows-acl` | `lib/types-CNjZgO4h.js` | Windows ACL sandbox spawn | **Hash-named target.** The bundler's content hash changes across releases, so this patch fails by *path*, not by content — the target file must be re-identified before the hunks can even be judged. |

Windows ACL / sandbox / packaging changes are release-gated: run
`yarn workspace dsh-plugin-desktop verify:closure` and
`yarn workspace dsh-plugin-desktop check:win-package` when a bump touches them.

## The eval decision tree

Lane C brings the RM the evidence; the RM rules. The options, in the standing goal's
preference order:

1. **Inherit** — clean bump: every patch applies, every covered behavior re-tested,
   full gate green, nothing in the release notes contradicts the Parametria mission.
   The default when nothing breaks.
2. **Adapt** — something ours breaks, and our side can move: re-cut the patch, adjust
   the plugin, follow the renamed seam. Preferred over holding back, because held-back
   packages accumulate. If adapting would mean editing `deepseek-harness/`, stop: that
   is a missing seam (ADR H-0001), which is an RM+owner decision, not a Lane C fix.
3. **Partial hold-back** — inherit the release but pin the breaking package back
   through `resolutions`. A hold-back is a **durable claim and therefore needs a
   release**: record which package, at which version, why, and the condition that
   retires it. A hold-back with no retirement condition is a permanent fork of that
   package by accident.
4. **Skip, with a record** — the release is not worth its cost right now. Record it on
   the board (and an ADR if the reasoning is durable), naming the release skipped and
   why. Re-evaluated at the next release.

What Lane C hands over, whichever way it points: releases behind and what is in them;
which patches applied, which needed re-cutting, which could not be; the full-gate
result; what broke and whether our side can absorb it; and the cost estimate for
adapt vs hold-back. Explicitly **not** a recommendation dressed as a finding.

## Pin-bump PR rules

- **A pin-bump PR changes NO desktop behavior** (AGENTS.md: keep the submodule pin
  update separate from desktop behavior changes). It moves the pin, the version
  strings, the patch filenames, the resolutions selectors, and the lockfile. Nothing
  else. A tempting one-line fix alongside is the thing this rule exists to stop.
- **Behavior fallout becomes separate follow-up issues**, filed before the PR opens
  and linked from its body — including behavior that changed *because* of the bump.
  The pin-bump PR is not the place to fix what the new version altered.
- Patch re-cuts are part of the pin bump, not behavior changes: they preserve existing
  behavior across a version boundary. A re-cut that *changes* what the patch does is a
  behavior change and belongs in its own PR.
- The PR body carries: the release delta, the per-patch re-validation table, the
  foreground `corepack yarn check` tail, the follow-up issues filed, and — for any
  `dsh-llm-deepseek` change — the pending-live-confirmation status.
- Paste the watch script's output for the *new* pin as the closing evidence: the bump
  surface count at the old version must be zero.
