# Upstream watch and pin-bump eval protocol (Lane C)

How this fork stays current with the two upstreams it tracks, and what has to happen
before a pin moves. Established on issue #4 under the RM's STANDING GOAL
([`handoffs/repo-manager-charter.md`](handoffs/repo-manager-charter.md)) and ADR
[H-0001](adrs/H-0001-fork-strategy-parametria-harness-overlay.md).

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
corepack yarn upstream:watch                # human-readable report
corepack yarn upstream:watch --json         # machine-readable, same facts
corepack yarn upstream:watch --offline      # local facts only, no network
corepack yarn upstream:watch --help         # the script's own header
```

The root script is `node scripts/upstream-watch.mjs`; invoking the file directly is
equivalent.

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

Reading rules. `current` is printed only when the drift was actually established;
every distinct way of failing to establish it has its own name, and none of them is
`current`:

| Status | Means |
|---|---|
| `behind` | a positive drift signal was found — conclusive, and it outranks the rest |
| `current` | every signal was read and all of them say up to date |
| `unknown` | the upstream could not be read at all (`--offline`, or `gh api` failed) |
| `indeterminate` | the upstream was read, but our own pin could not be placed against a published release — a mid-release pin, a tag with no Release object, a moved tag. "0 releases behind" would be an artefact of that, not a finding |
| `incomplete` | the release side was established but the commits-behind comparison was not, so the "no drift" reading rests on a signal that was never read |

`--json` carries the same conclusion as a top-level `verdict` (`behind` /
`current` / `inconclusive`), so a machine consumer cannot read it as a clean bill of
health where the text form would not have been.

Two more:

- **An unreadable local fact is never rendered as a finding.** If the submodule
  gitlink cannot be read out of the committed tree, the report says
  `(unknown — gitlink unreadable, NOT cross-checked)` and warns. It never says DRIFT:
  a pin we could not compare is not a pin that disagrees, and treating it as one
  would send the next tick chasing a bump that isn't needed.
- **A stale local `upstream/master` ref does not distort `last merged`**: a merge-base
  only moves when a merge actually lands. The staleness is reported, not corrected.

## Cadence

- **Every RM tick** that involves a board update: run `node scripts/upstream-watch.mjs`.
  It costs a few seconds and seven read-only API GETs at current upstream sizes (more
  only if either upstream ever grows past one page of tags or releases). Record the two
  headline numbers (releases behind, overlay commits behind) in the RM's memory
  iteration entry. The obligation is carried by
  [`handoffs/repo-manager-charter.md`](handoffs/repo-manager-charter.md) as the daily
  watch tick.
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
3. <a id="bump-surface"></a>Move the whole **bump surface** the script enumerated.
   **This paragraph is the authoritative statement of what that surface holds; the
   rest of this file and `scripts/verify-layout.mjs` cross-reference it rather than
   restating the arithmetic.** At `0.1.1-rc.2` it is **190** entries:

   | Where | Entries | Enforced by |
   |---|---|---|
   | `dsh-plugin-desktop/package.json` `dependencies` | 100 | `pinSurface` |
   | `dsh-plugin-desktop/package.json` `devDependencies` | 6 | `pinSurface` |
   | `dsh-community-market/package.json` `devDependencies` | 38 | `pinSurface` |
   | `dsh-community-market/package.json` `peerDependencies` | 28 | `pinSurface` |
   | `dsh-preset-parametria/profile/package.json` `dependencies` | 3 | `pinSurface` |
   | root `package.json` `resolutions` selectors | 15 | `patchedPackages` |
   | **total** | **190** | |

   **The fifth row is not a workspace manifest**, and that is why it went
   unguarded until 0.1.1-rc.2. It is the profile TEMPLATE
   `dsh-preset-parametria` installs into `$DSH_HOME/profiles/parametria/`, whose
   three pins (`dsh-sdk-protocol`, `dsh-subagent-claude-code`,
   `dsh-subagent-codex`) mount the subagent providers the preset's
   `subagent_validator` deny list names. They sat at `0.1.0-rc.7` — whose peer
   ranges (`^0.1.0-rc.7`) admit `0.1.0-rc.8` but **not** `0.1.1-rc.2`, by the
   semver prerelease-tuple rule — with nothing in the tree to notice. **A pinned
   manifest that is not a workspace is the shape this surface hides in**; look
   for others before assuming the fifth row is the last one.

   **This table was itself stale before the 0.1.1-rc.2 bump** — it still read 173 with
   9 resolutions selectors and no desktop `devDependencies` row, while the tree had
   already grown to 180 (the two `dsh-subagent*` patches added 4 selectors, and the
   subagent work added 3 desktop dev entries). A stamped count only stays true if the
   bump that moves the tree re-reads it off the script, which is what this list at the
   bottom of the file exists to force. The two market rows are the "66 dev+peer" the
   script prints as one line. Both enforcing
   lists live in `scripts/verify-layout.mjs` and hold package **names**, not counts,
   so they are version-independent and move only when upstream's package set moves.

   **The package set does move, in both directions, and rc.8 moved it both ways at
   once.** This is normal bump work, not a blocker. A release can *delete* packages:
   rc.8 dropped `dsh-client-schema-form` (absorbed — `ui-settings` now takes
   `@deepseek-ai/schemastery` directly) and `dsh-client-web-react` (gone with the
   `apps/web` restructure). Neither has an rc.8 on npm, so the version replace fails
   with `YN0082: No candidates found`. **Remove those; do not hold them back.** A
   deleted package will never be published at the new version, so a hold-back on one is
   a durable claim whose retirement condition can never be met — exactly the accidental
   permanent fork option 3 warns about. Confirm first: zero references in the new
   submodule tree, and no import in our own source. A release can equally *split*
   packages out, and those surface as `YN0002` peer warnings at install and `TS2307`
   at typecheck rather than as a resolution failure — rc.8 added `dsh-file-reference`,
   `dsh-host-apiproxy`, `dsh-session-reference` and `dsh-tool-todo` to the desktop
   plugin, and seven more to the market. Add split-out packages where the types
   actually need to resolve; a type-only transitive need belongs in `devDependencies`,
   because putting it in `peerDependencies` asserts a public runtime contract the
   workspace does not actually make.

   Note the
   script counts against whatever `upstream.json` currently says, so after step 2 it
   counts entries already moved to the **new** version: it starts near zero and is
   done when it reaches the full surface. The independent check is that the old
   version string no longer appears in any manifest — and since **issue #12**,
   `check:layout` enforces it (below), so a half-moved surface fails the gate rather
   than relying on this step being done carefully.
4. Rename the harness-versioned patch files to the new version and repoint the
   matching `resolutions` entries. **The pair moves together**
   (`handoffs/resolver-charter.md`, ENVIRONMENT).
5. `corepack yarn install` (not `--immutable`) to regenerate `yarn.lock`, then
   re-validate every patch (next section).

   <a id="release-age"></a>**Check the release's age first — a release younger than 24
   hours cannot be resolved at all.** Yarn 4 enforces `npmMinimalAgeGate`, whose default
   is `1d` and which this repo does not override, so every version published less than a
   day ago is refused with:

   ```
   YN0016: <package>@npm:<version>: All versions satisfying "<version>" are quarantined
   ```

   That is Yarn's own supply-chain age gate, not an npm-side quarantine: the registry
   packument carries no `policyRestrictions` and the tarballs fetch fine. It bites only
   at **resolution** time, which is why every `--immutable` install is unaffected and why
   a pin bump is the first thing that ever meets it. The gate clears 24 hours after the
   *last* package in the surface was published, which is not the release timestamp —
   check the actual publish times (`npm view <pkg> time`) rather than the GitHub release.

   The RM ruled (2026-08-20, on the rc.8 bump) that the answer is to **wait**: lowering
   `npmMinimalAgeGate` or allow-listing through `npmPreapprovedPackages` would be a
   durable weakening of a supply-chain control to chase a release younger than a day,
   and no bump has that urgency. The scheduling consequence belongs to the RM's watch
   tick: a bump spawned within 24h of a release **will** hit this, so surface the release
   age when the watch reports `releases behind > 0` and schedule the trial after the gate
   clears rather than discovering it mid-slice.
6. `corepack yarn check` in the foreground.

`check:layout` is the drift guard that catches a half-done bump. It asserts the
submodule index SHA, the submodule's checked-out HEAD, a clean submodule worktree, the
submodule's origin URL, and the submodule's `package.json` version against
`upstream.json` — and, since **issue #12**, the whole bump surface:

- every `@deepseek-ai/dsh*` entry in **every** workspace manifest, across all four
  dependency fields, carries `runtimePackageVersion`;
- the surface itself is snapshotted as the sorted package **names** per manifest and
  field (`pinSurface`), so an entry appearing, disappearing, or being swapped for
  another at the same count fails too — without that, the version assertion would
  pass vacuously over a field that had lost its entries, and a rename inside a
  release would read as no change at all;
- each root `resolutions` selector naming the family is checked as one unit with its
  patch: selector range (exact or caret), `patch:` locator version, patch **filename**
  version, and the file's existence;
- which packages carry which selector shapes is snapshotted version-independently, so
  a half-updated selector set (the hazard the checklist below names) fails;
- and no workspace manifest may declare `resolutions` at all — Yarn honours them in
  the root only, so a workspace-level block is a silent no-op, and it would sit
  outside the guard while the watch script still counted it.

**A hold-back trips this guard, by design.** Option 3 of the decision tree below pins
a package back through `resolutions`, which presents either as a selector naming the
old version or as a target that is not one of our patches — both fail `check:layout`.
That is deliberate: a hold-back is a durable claim, and durable claims need a
retirement condition (resolver-charter standard 9), so it should cost an explicit
reviewed change rather than a manifest line nobody revisits. **Where a hold-back gets
declared so the guard can admit one is an open RM ruling** (raised on #12); until it
lands, the first hold-back will need the guard widened in the same PR that makes it.

The guard selects by package **identity**, never by "range equals the current pin":
`scripts/upstream-watch.mjs` enumerates by version because it builds a forward
worklist, but a fence written that way would skip exactly the entries a half-done bump
left on the old version. `pinSurface` and `patchedPackages` in
`scripts/verify-layout.mjs` are the enforced copy of the [step 3 table](#bump-surface).

## Patch re-validation checklist

Run for **every** patch in `patches/`, not only the ones that failed to apply. A patch
that applies cleanly to relocated code is the dangerous case, not the safe one.

For each patch:

- [ ] **It still applies.** `corepack yarn install` fails loudly when a patch does not.
      A clean install is necessary, never sufficient.

      **Do not pre-check with `git apply`. It is not the applier Yarn uses and it
      reports failures that do not exist.** On the rc.8 bump `git apply --check`
      rejected 4 of the 5 patches, including `dsh-sandbox-windows-acl`, whose target
      file is **byte-identical** between rc.7 and rc.8. Yarn accepted all four. If you
      want an offline read before the lockfile exists — worth having, because it works
      on registry tarballs without a resolvable install — use GNU `patch -p1 --dry-run
      -F 0`, and **run it against the OLD version as a control**: hunks that fail on
      both versions are a standing `patch`/Yarn divergence, not drift introduced by the
      release. On rc.8 that control cut three apparent regressions down to one real one.
- [ ] **It reached the tree.** `corepack yarn why <package>` shows consumers resolving
      through the `patch:` locator. A `resolutions` entry only expresses intent; the
      lockfile locator is the proof. The watch script counts both.
- [ ] **Every selector moved.** Some packages carry both an exact (`npm:X`) and a caret
      (`npm:^X`) selector, some only one. A half-updated selector set silently leaves
      part of the tree unpatched — and `yarn install` will not complain. Since #12
      `check:layout` fences the shape set, so a dropped or added selector fails the
      gate; it still cannot tell you the patch reached the tree, which is what the
      lockfile locator above is for.
- [ ] **The hunk still means what it meant.** Read the patched region at the new
      version. Zero-context hunks (`@@ -840 +840,2 @@`) relocate quietly.
- [ ] **The covered behavior is re-tested at the new pin**, by the test that covers it
      or by hand if none does. Naming the behavior is part of the PR body.

Per-patch specifics as of `0.1.1-rc.2`:

| Patch | Target | Behavior to re-test | Hazard |
|---|---|---|---|
| `app-builder-lib@26.15.7` | `out/codeSign/macCodeSign.js` | macOS signing path | **Not** harness-versioned — moves with electron-builder, not with the pin. Leave it alone during a pin bump. |
| `dsh-app-boot` | `lib/index.js` (patch-list parsing) | app boot + patch list | Zero-context hunk. Relocated one line at rc.8 and applied on offset; applied clean at 0.1.1-rc.2. |
| `dsh-client-ui-directory-picker-browse` | `lib/client.js` + 2 `.d.ts` | directory browse UI | 14 hunks — by far the largest; expect the most conflict here. **The only patch rc.8 actually broke**: its bundler now emits `DirectoryBrowser_module_css_default` alphabetically sorted, which moved a pure-insertion point. Re-cut with the added key in its alphabetical slot so the context survives the next sort. That re-cut held: all 14 hunks applied unchanged at 0.1.1-rc.2. |
| `dsh-client-ui-workspace` | `lib/client.js` | workspace client UI | — |
| `dsh-llm-deepseek` | `lib/index.js` (response translation) | **provider wire** | Charter rule: a change to what reaches the provider's wire is not resolved by a green gate. Keep the issue open pending a live provider datum. Relocated 134 lines at rc.8 and a further ~742 lines at 0.1.1-rc.2 (patched region moved from line 321 to 1063), content unchanged — the surrounding `translate` streaming `tool_calls` loop is identical. |
| `dsh-tool-fs` | `lib/index.js` + `lib/types/index.d.ts` + `lib/types/read-image.d.ts` | `read_image` exact-modality fallback seam and activation after durable image admission | Re-validate the `fs/read-image-route` event contract, exact fallback model lookup, fail-closed refusal/logging, and post-admission activation. Re-check the upstream-owned `fs/` namespace for a future event-name collision. |
| `dsh-subagent` | `lib/index.js` (continuable lifecycle + notice + export list) + `lib/types/{lifecycle,out-of-process,types}.d.ts` | the exported `limitSubagentDiagnostic` seam plus unconditional continuable settlement diagnostics: terminal turn and teardown failures reach the parent notice and `subagent/end` as bounded `{code} — {message} (child session {id})` detail | **RE-VALIDATE:** all 9 context-bearing hunks, both error shapes, teardown failure, the `subagent/end` diagnostic, the 4096-byte UTF-8 bound, and the clean-completion negative case in `subagent-error-surface.spec.ts`. Also re-check the one-shot driver's import/export pairing — this patch's pair is `dsh-subagent-in-process-driver`, and the two must move together or the driver's import resolves to nothing. The `{code} — {message} (child session {id})` wording is duplicated across both patches and must move together. Applied clean at 0.1.1-rc.2. |
| `dsh-subagent-in-process-driver` | `lib/index.js` | in-process subagent failure diagnostics: the child's terminal turn failure surfaces as the run's `diagnostic` instead of a bare stop reason | **RE-VALIDATE:** 4 hunks, one of which is the same barrel-import single-line hazard as `dsh-subagent` above. The `{code} — {message} (child session {id})` wording is duplicated across both patches and must move together. Applied clean at 0.1.1-rc.2. |
| `dsh-sandbox-windows-acl` | `lib/types-CNjZgO4h.js` | Windows ACL sandbox spawn | **Hash-named target.** The bundler's content hash can change across releases, and then this patch fails by *path*, not by content — the target must be re-identified before the hunks can be judged. It did **not** fire at rc.8 or at 0.1.1-rc.2: the filename `lib/types-CNjZgO4h.js` has now held across three releases. Treat it as a hazard to check, not one that fires every time. |
| `pi-ai@0.82.1` (#60) | `dist/api/openai-completions.js` (upstream source `src/api/openai-completions.ts`, per the shipped sourcemap) | **provider wire** — a bare OpenRouter route must send no `reasoning` field when nothing selects an effort | **Not** harness-versioned, but not independent of the pin either: `@earendil-works/pi-ai` arrives TRANSITIVELY through `@deepseek-ai/dsh-llm-pi-ai`, so a harness bump can move it while the patch filename still names the old version. Its single selector is a caret (`npm:^0.82.1`); when the transitive range moves the selector matches nothing, the patch applies to nothing, and `yarn install` still succeeds. **It is therefore NOT in `upstream-watch.mjs`'s `revalidation` set** (that set is `version === runtimePackageVersion`), so nothing above puts it on the bump checklist by itself — the trigger is `check:layout`, which since #60 fails on a patch that has resolutions entries but no `patch:` locator in the lockfile, plus `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts`, which fails on the behavior. Re-validate it on every bump anyway. Target path is stable, not hash-named. Charter rule: a wire change is not resolved by a green gate — the issue stays open pending a live provider datum. |

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
   retirement condition**: record which package, at which version, why, and what has
   to become true for the hold-back to end. A hold-back with no retirement condition
   is a permanent fork of that package by accident.
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
- Paste the watch script's output for the *new* pin as the closing evidence, and
  confirm the old version string appears in no manifest.

## Maintaining this document

Parts of this file are stamped to `0.1.1-rc.2` and go stale the moment a pin moves.
The pin-bump PR that moves the pin updates them in the same PR — that is the one
exception to "a pin-bump PR changes nothing else", because leaving them behind makes
this document lie about the tree it describes:

- the [bump-surface table](#bump-surface) in step 3 (re-read the numbers off the
  script). Only that table states them; nothing reads this document, so it is kept in
  step by this list and nothing else. Its two enforcing lists in
  `scripts/verify-layout.mjs` need no edit for a version change — they hold names —
  but a real change to upstream's package set moves them, and the gate holds them
  against the **tree**, so a stale one fails `check:layout` loudly;
- the **per-patch table**, including its "as of `0.1.1-rc.2`" heading and any patch
  whose target file or hunk count changed. A patch added or dropped also moves
  `patchedPackages` in `scripts/verify-layout.mjs`.

**The 190-entry bump surface is not the whole version-shaped surface, and this document
used to read as though it were.** `check:layout` fences the manifests; roughly 220
further literals live outside them and are covered by other gates or by nothing at all.
At rc.8 they were: `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` (regenerate with
`yarn workspace dsh-plugin-desktop verify:notices` — it writes the file, it does not
merely check it), `dsh-plugin-desktop/tests/package.spec.ts` (patch filenames, `npm%3A`
locators, and a `yarn.lock` substring assertion), `dsh-community-market`'s
`DSH_RUNTIME_VERSION`, its `contracts.spec.ts` peer assertions and an install fixture,
four market docs, both `dsh-plugin-desktop` READMEs, the `.agents` note the topology
rule cites (both languages, plus the `.i18n.yaml` blob record that then goes stale —
and the record hashes the **committed** blob, so it can only be refreshed after the
note is committed), the `bug_report.yml` version example, and the preset profile
comment naming the pin its observation was derived at. `.engineering/research/` is
deliberately **not** on this list: those files are stamped with the version they were
derived at and re-stamping them without re-deriving them would be a false claim.
