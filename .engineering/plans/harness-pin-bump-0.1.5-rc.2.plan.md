# Plan — trial pin bump: harness `dsh-v0.1.1-rc.2` → `dsh-v0.1.5-rc.2`

**Artifact type:** Lane C handoff brief (trial pin bump). Authority to *inherit / adapt /
hold-back / skip* stays with the Repo Manager — this document is evidence and a worklist,
not a ruling.
**Prepared:** 2026-09-18, from the operator's machine (primary checkout
`C:\Users\chidi\Documents\deepseek-harness-desktop`).
**Governing documents:** [`../upstream-watch.md`](../upstream-watch.md) (the authoritative
protocol — this plan follows it and must never be read as replacing it),
[`../../AGENTS.md`](../../AGENTS.md), [`../handoffs/resolver-charter.md`](../handoffs/resolver-charter.md).

> **This plan exists because of a user-visible symptom, not a drift count.** A user reported
> that the harness offered an outdated model and refused image input. Root cause was found
> (see §1). The symptom is **already fixed** on this machine by a user-settings override
> (§2) — so this bump is now about being *current*, and nothing here is an emergency.
> Do not let the urgency of the original report push this into the primary checkout.

---

## 1. Why (evidence, not inference)

`@deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2` ships this built-in model catalog:

| id | declared input modalities |
|---|---|
| `deepseek-v4-flash` | text (default — no `inputModalities` key) |
| `deepseek-v4-pro` | text |
| `deepseek-v4-flash-vision-exp` | text + image |

`@deepseek-ai/dsh-llm-deepseek@0.1.5-rc.2` (verified by extracting the published tarball)
ships **four** entries, with `deepseek-flash` added as the *first*:

| id | declared | note |
|---|---|---|
| **`deepseek-flash`** | **text + image** | name `DeepSeek-V41-Flash`, plus `systemPromptUpdate: "in-history"` |
| `deepseek-v4-flash` | text | legacy |
| `deepseek-v4-pro` | text | |
| `deepseek-v4-flash-vision-exp` | text + image | legacy |

Per the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing)
footnote 1: *"Use `deepseek-flash` as the model name. The legacy names `deepseek-v4-flash`
and `deepseek-v4-flash-vision-exp` are still accepted, but the corresponding models have
been retired, their requests are served by the DeepSeek-V4.1-Flash model…"*. `GET
https://api.deepseek.com/models` returns exactly `deepseek-flash` and `deepseek-v4-pro`.

**Consequence of the pin:** the pinned release cannot offer the current model at all, and
declares the retired id text-only — so the harness refuses image input with
`model "deepseek-v4-flash" does not declare image input`. The user was paying for
V4.1-Flash, was being served it (the API echoes `"model":"deepseek-flash"` for the legacy
id), but could not use its vision.

---

## 2. Already done on this machine — read before touching anything

A **machine-local user-settings override** was applied at
`C:\Users\chidi\.dsh\settings.yaml` and is live in the running host (verified via the
host's own `settings.describe` RPC):

```yaml
llm-deepseek:
  models:            # replace-by-value: this array IS the catalog
    - id: deepseek-flash          # text+image, 1000000 ctx, 640000 px / 1048576 B
    - id: deepseek-v4-pro
    - id: deepseek-v4-flash
    - id: deepseek-v4-flash-vision-exp
agent-default-model:
  provider: deepseek-official
  model: deepseek-flash
  reasoningEffort: max
```

Two things the bump agent must know:

1. **This is outside the repository.** It is not a tracked file, it is not part of the pin,
   and it must not appear in the pin-bump PR.
2. **After the pin lands, this override becomes harmful.** `models` is replace-by-value, so
   the user-layer array *replaces* the new built-in entries and would **suppress**
   `systemPromptUpdate: "in-history"` that 0.1.5-rc.2 sets on `deepseek-flash`. Resetting it
   (Models settings page → reset, or unset the `llm-deepseek` section) is part of §9
   Phase 2, not a repository change.

Also relevant to this bump: the fork **patches `dsh-llm-deepseek` itself** (§6), the very
package whose catalog this symptom lives in, and `dsh-tool-fs`'s patch covers the
`read_image` modality-fallback seam. Both are image/model-path patches — the highest-risk
pair in this bump.

---

## 3. Facts for this specific bump

| Fact | Value |
|---|---|
| Current pin (submodule commit) | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Current pin (tag / version) | `dsh-v0.1.1-rc.2` / `0.1.1-rc.2` (released 2026-08-21T12:35:08Z) |
| **Target submodule commit** | **`fb2c4b9e698e30edb738bca4cf0618587db7d203`** |
| **Target tag / version** | **`dsh-v0.1.5-rc.2` / `0.1.5-rc.2`** (released 2026-09-10T15:09:34Z) |
| Target is the published `latest` + `next` | yes, for the whole `@deepseek-ai/dsh*` family |
| Releases between the pins | 12: `0.1.2-alpha.1…5`, `0.1.2-rc.1`, `0.1.3-alpha.1/2`, `0.1.5-alpha.1/2`, `0.1.5-rc.1`, `0.1.5-rc.2` |
| Newer line available | `0.1.6-alpha.2` (tag `ddefc45fbc7f8e46dd73185e68295696d1297887`, 2026-09-17) — **alpha; and inside Yarn's 24h age gate** |
| `npmMinimalAgeGate` status for 0.1.5-rc.2 | **OPEN** — last package published 2026-09-10T15:00:21Z; gate cleared 2026-09-11T15:00:21Z (≈8 days ago). No `YN0016` wait needed. |
| Bump surface | 190 entries per §step-3 table; **110 unique package names** (108 of them published at `0.1.5-rc.2`) |
| ⚠ Blocking discovery | **2 packages were retired and have no `0.1.5-rc.2`** — see §5 |

If `0.1.6-alpha.2` is ever chosen instead, re-check the age gate first
(`npm view <pkg> time`) — it was still closed at the time of writing.

---

## 4. Preconditions

**Toolchain** (per `AGENTS.md`): Node `^22.19.0` or `>=24.0.0`; **Yarn `4.18.0` through
Corepack** (`corepack yarn …` — the root manifest pins `yarn@4.18.0` and `check:layout`
enforces it).

**Where to work — this is not optional.** Per §"Trial pin bump": *always in a Lane C
worktree, on an `up/` branch, never in the primary checkout*:

```powershell
git -C C:\Users\chidi\Documents\deepseek-harness-desktop worktree add ..\dsh-up-015rc2 -b up/harness-0.1.5-rc.2
cd ..\dsh-up-015rc2
git submodule update --init --recursive
corepack yarn install --immutable      # baseline: must be green BEFORE any change
```

**The operator's app.** It runs from the **primary checkout**
(`…\dsh-plugin-desktop\node_modules\electron\dist\electron.exe`). Phase 1 (the trial in a
worktree) does **not** require stopping it. Phase 2 (§9, updating the primary checkout)
**does**.

> ⚠ **Junction hazard, discovered from `dsh-app-boot`'s source.** `$DSH_HOME/profiles/node_modules`
> holds one junction per package pointing into the *installation* that last booted a
> profile, and `healProfilesModuleFallback` **re-points** them when it sees a moved
> installation. The gate's `verify:profile` / `verify:loader` / `verify:closure` steps boot
> profiles. A trial run from a worktree can therefore silently re-point the live profile's
> junctions at the **worktree's** `node_modules`. Before relaunching the app, re-check and
> re-heal from the primary checkout:
>
> ```powershell
> Get-Item "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh-llm-deepseek" |
>   Select-Object Name, LinkType, Target   # Target must name the PRIMARY checkout
> ```
>
> Run one `dsh` command from the primary checkout (or simply launch the app) to re-heal it.

---

## 5. ⚠ Two packages on the bump surface were retired — resolve this first

A version-string replace over the surface **cannot** complete. 108 of 110 names have
`0.1.5-rc.2`; these two stop at `0.1.1-rc.2` and were never published again (no
`0.1.2*`, `0.1.3*`, `0.1.5*`, `0.1.6*`):

| Package | Newest published | Upstream `master` tree | Retired? |
|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime` | `0.1.1-rc.2` (2026-08-21) | no product package (only `packages/test-support/client-runtime` = **`@deepseek-ai/dsh-client-test-runtime`**, a different package) | **yes** |
| `@deepseek-ai/dsh-host-apiproxy` | `0.1.1-rc.2` (2026-08-21) | **no matches anywhere** | **yes** |

Protocol guidance applies exactly: *"Remove those; do not hold them back… A deleted package
will never be published at the new version, so a hold-back on one is a durable claim whose
retirement condition can never be met."* Confirm first (zero references in the new submodule
tree, no import in our source), then **delete them** — expecting `YN0082: No candidates
found` if you leave them in.

**Our side's exposure (measured):**

- `@deepseek-ai/dsh-client-runtime` — **13 files, 13 imports**, *all* `import type … from
  '@deepseek-ai/dsh-client-runtime/client'` (`ClientContext`, `AssistantMessageNode`,
  `ConversationSnapshot`, `WorkspaceId`, `WorkspaceView`), in `dsh-plugin-desktop/src/*`
  plus 2 specs. Type-only, so repointing is compile-time, not behavior.
  **Lead:** `ClientContext` already appears in `@deepseek-ai/dsh-client-connection`'s
  `lib/types/{index,api}.d.ts` at 0.1.1-rc.2 — `packages/client/connection` still exists
  upstream. Confirm against the new pin, then repoint the imports.
- `@deepseek-ai/dsh-host-apiproxy` — **1 hit only**, inside
  `dsh-plugin-desktop/tests/package.spec.ts:912` (a consumer-list assertion). Upstream's
  layout is now `packages/api/gateway` (= `dsh-api-gateway`); the apiproxy package is gone,
  so the assertion must name whatever replaced it.

**Also required, or `check:layout` fails by design:**

- `pinSurface` in `scripts/verify-layout.mjs` snapshots package **names** per
  manifest/field. Remove the two names there in the same change.
- The same two rows disappear from the bump-surface table in
  [`../upstream-watch.md`](../upstream-watch.md) §step 3, which the pin-bump PR maintains.

If repointing the 13 type imports turns out to need a *behavior* change, stop and raise it:
per the decision tree that is option 2 (**adapt**), and if adapting would mean editing
`deepseek-harness/`, it is ADR H-0001 territory — an RM + owner decision, not Lane C's.

---

## 6. Worklist — the protocol's six steps, concretised

1. **Move the submodule gitlink** to the target commit (never edit upstream files):
   ```powershell
   git -C deepseek-harness fetch --tags origin
   git -C deepseek-harness checkout fb2c4b9e698e30edb738bca4cf0618587db7d203
   git add deepseek-harness          # records the new gitlink; commit separately
   ```
2. **Update `upstream.json`**: `commit` → `fb2c4b9e…`, `sourceVersion` and
   `runtimePackageVersion` → `0.1.5-rc.2`.
3. **Move the bump surface** (190 entries; see §5 for the two that cannot move). Per
   manifest: `dsh-plugin-desktop` deps **100** / devDeps **6**; `dsh-community-market`
   devDeps **38** / peerDeps **28**; `dsh-preset-parametria/profile` deps **3**; root
   `resolutions` selectors **15**. The doc is explicit that the package set moves in **both
   directions** — expect added split-outs (`YN0002` peer warnings / `TS2307`) as well as the
   two deletions, and "a type-only transitive need belongs in `devDependencies`".
   Independent check: the old version string appears in **no** manifest.
4. **Rename the harness-versioned patch files** to the new version and repoint the matching
   `resolutions` entries — *the pair moves together*. Eight renames, `@0.1.1-rc.2.patch` →
   `@0.1.5-rc.2.patch`:
   `dsh-app-boot`, `dsh-client-ui-directory-picker-browse`, `dsh-client-ui-workspace`,
   **`dsh-llm-deepseek`**, `dsh-sandbox-windows-acl`, `dsh-subagent`,
   `dsh-subagent-in-process-driver`, `dsh-tool-fs`.
   **Do not** rename `app-builder-lib@26.15.7.patch` or `pi-ai@0.82.1.patch` — not
   harness-versioned.
5. **`corepack yarn install`** (not `--immutable`) to regenerate `yarn.lock`, then run the
   per-patch re-validation (§7). Age gate is already open, so this should not hit `YN0016`.
6. **`corepack yarn check` in the foreground** — the full headless gate. On Windows also run
   `yarn workspace dsh-plugin-desktop verify:closure` and `check:win-package`, because this
   bump touches the Windows ACL patch and packaging surface. Remember: **no gate step may
   launch a GUI** (`AGENTS.md`).

---

## 7. Patch re-validation — all 8, not only the failures

Run the §"Patch re-validation checklist" for **every** patch; a patch that applies cleanly
to relocated code is the dangerous case.

- **Do not pre-check with `git apply --check`** — Yarn uses a different applier and it
  reports failures that do not exist. For an offline read use
  `patch -p1 --dry-run -F 0`, and **run it against the OLD version as a control**; hunks that
  fail on both are a standing `patch`/Yarn divergence, not new drift.
- Prove each patch **reached the tree** with `corepack yarn why <package>` (the lockfile
  `patch:` locator is the proof — a `resolutions` entry is only intent).
- Confirm every selector moved (some packages carry both exact and caret).

| Patch | Target | Behavior to re-test | Hazard specific to this bump |
|---|---|---|---|
| **`dsh-llm-deepseek`** | `lib/index.js` (response translation) | **provider wire** | Relocated 134 lines at rc.8, then ~742 more (patched region line 321 → 1063). **Charter rule: a change to what reaches the provider's wire is NOT resolved by a green gate — the issue stays open pending a live provider datum.** This is also the package whose catalog the reported symptom lives in. |
| **`dsh-tool-fs`** | `lib/index.js` + 2 `.d.ts` | `read_image` exact-modality fallback seam; activation after durable image admission | Re-validate the `fs/read-image-route` event contract, exact fallback lookup, fail-closed refusal/logging, post-admission activation; re-check the upstream `fs/` namespace for a future event-name collision. **Directly image-related.** |
| `dsh-sandbox-windows-acl` | `lib/types-CNjZgO4h.js` | Windows ACL sandbox spawn | **Hash-named target** — if the bundler's content hash changed, the patch fails *by path*; re-identify the target file before judging the hunks. Held across three releases so far; treat as a hazard to check. |
| `dsh-client-ui-directory-picker-browse` | `lib/client.js` + 2 `.d.ts` | directory browse UI | Largest (14 hunks); the only patch rc.8 actually broke, because a bundler-emitted key moved to alphabetical order. Expect the most conflict here. |
| `dsh-subagent` | `lib/index.js` + 3 `.d.ts` | bounded continuable settlement diagnostics | 9 context-bearing hunks; the `{code} — {message} (child session {id})` wording is **duplicated across both subagent patches and must move together**. |
| `dsh-subagent-in-process-driver` | `lib/index.js` | in-process subagent failure diagnostics | 4 hunks; same duplicated wording; its barrel-import pairing is the pair of the row above. |
| `dsh-app-boot` | `lib/index.js` (patch-list parsing) | app boot + patch list | Zero-context hunk; relocates quietly. This is the package the junction hazard in §4 comes from. |
| `dsh-client-ui-workspace` | `lib/client.js` | workspace client UI | — |
| `pi-ai@0.82.1` (not harness-versioned, **re-validate anyway**) | `dist/api/openai-completions.js` | provider wire — a bare OpenRouter route must send no `reasoning` field | Arrives **transitively** via `@deepseek-ai/dsh-llm-pi-ai`; its caret selector can silently stop matching while `yarn install` still succeeds. Covered by `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts`. |
| `app-builder-lib@26.15.7` | `out/codeSign/macCodeSign.js` | macOS signing | **Not** harness-versioned — leave it alone. |

---

## 8. The ~220 literals outside the manifests

`check:layout` fences the manifests only. These move too (the doc lists them from the rc.8
bump; re-derive the list for this one):

`dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` (regenerate — `yarn workspace
dsh-plugin-desktop verify:notices` **writes** the file) · `dsh-plugin-desktop/tests/package.spec.ts`
(patch filenames, `npm%3A` locators, a `yarn.lock` substring, and the consumer-list
assertion in §5) · `dsh-community-market`'s `DSH_RUNTIME_VERSION`, its `contracts.spec.ts`
peer assertions, its install fixture and four market docs · both `dsh-plugin-desktop`
READMEs · the `.agents` topology note (**both languages plus the `.i18n.yaml` blob record,
which hashes the COMMITTED blob — so it can only be refreshed after the note is committed**)
· `bug_report.yml`'s version example · the preset profile comment naming its derivation pin.

`.engineering/research/` is deliberately excluded — those files are stamped with the version
they were derived at, and re-stamping without re-deriving is a false claim.

---

## 9. Phase 2 — update this machine's app (only after the pin lands on `master`)

The user's app runs from the **primary checkout**, so the worktree trial does not change what
they launch. After the pin-bump PR merges:

```powershell
# 1. STOP THE APP (this is where stopping is required)
Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*deepseek-harness-desktop*' } |
  Select-Object Id, Path          # expect none

# 2. Update the primary checkout
cd C:\Users\chidi\Documents\deepseek-harness-desktop
git pull --ff-only
git submodule update --init --recursive
corepack yarn install --immutable

# 3. Prove the pin is consistent before launching anything
corepack yarn check
corepack yarn upstream:watch        # no WARNINGS block; releases behind == 0

# 4. Re-heal the profile junctions (see the §4 hazard), THEN relaunch the app
```

**Then reset the local catalog override** (§2) so the harness's own now-current catalog —
including `systemPromptUpdate: "in-history"` on `deepseek-flash` — applies:

- Models settings page → **reset** on the DeepSeek provider (unsets the `models` override), or
- unset the `llm-deepseek` section in `C:\Users\chidi\.dsh\settings.yaml` (hot-reloads).

**Acceptance checks after relaunch:**

1. `settings.describe` (loopback `/api` RPC) resolves `llm-deepseek.models` from the
   **built-in** catalog, and `deepseek-flash` lists `inputModalities: ["text","image"]`.
2. `agent-default-model` resolves to `provider: deepseek-official`, `model: deepseek-flash`.
   *(Note: the composer's model picker OWNS this section and rewrites it — a hand-written
   value gets overwritten. Set it in the UI or via `settings.update`.)*
3. An image actually round-trips: attach an image to a session on `deepseek-flash` and
   confirm the harness accepts it (the same request that previously failed with
   `does not declare image input`).
4. The Rhino MCP tools still register (`mcp__rhino__*`) — the user depends on them; a
   profile-junction misheal would break exactly this.

**Rollback:** `git -C <primary> checkout master~1 -- upstream.json dsh-plugin-desktop/package.json`
etc., or simply `git reset --hard <pre-bump-sha>` on the pin commit, then
`git submodule update --init --recursive` and `corepack yarn install --immutable`. The
settings override is independent of the pin and can be restored from §2's YAML.

---

## 10. What Lane C hands the RM

Not a recommendation dressed as a finding. Specifically: releases behind and what is in
them; **which patches applied, which needed re-cutting, which could not be**; the
full-gate result; what broke and whether our side can absorb it (here: the two retired
packages and the 13 type-import repoints); and the cost estimate for **adapt vs hold-back**.
The RM then rules inherit / adapt / partial hold-back (with a retirement condition) /
skip-with-record.

**PR rules (non-negotiable):** a pin-bump PR changes **no desktop behavior** — it moves the
pin, the version strings, the patch filenames, the `resolutions` selectors and the lockfile,
nothing else. Behavior fallout becomes **separate follow-up issues filed before the PR
opens** and linked from its body. Patch re-cuts are part of the bump *only* when they
preserve existing behavior. The PR body carries the release delta, the per-patch
re-validation table, the foreground `corepack yarn check` tail, the follow-up issues, and —
because this bump touches `dsh-llm-deepseek` — the **pending-live-confirmation status**.
Paste the watch output for the new pin as closing evidence. Update the stamped parts of
[`../upstream-watch.md`](../upstream-watch.md) (the step-3 table and the per-patch table) in
the same PR.

---

## 11. Open questions for the RM

1. **Target version.** `0.1.5-rc.2` is `latest`/`next` and its age gate is open — recommended.
   `0.1.6-alpha.2` is newer but an alpha, and was still inside Yarn's 24h gate at the time of
   writing.
2. **The two retirements** are the only structurally new item versus the rc.8 bump: is a
   plain delete + import repoint acceptable under "changes no desktop behavior", or does the
   RM want an ADR because the fork's dependency on an absorbed package is durable?
3. **`dsh-client-runtime`'s replacement** should be confirmed against the new pin rather than
   assumed — `dsh-client-connection` is the lead, not a finding.
4. Whether the model-catalog change in `dsh-llm-deepseek` (the `deepseek-flash` entry and its
   `systemPromptUpdate` field) warrants its own note, given the reported symptom — it is
   **not** a reason to deviate from the "pin-bump PR changes nothing else" rule.

---

## Appendix — evidence commands

```powershell
# drift + bump surface (read-only; never fetches, bumps or touches the submodule)
corepack yarn upstream:watch
corepack yarn upstream:watch --json

# which names in the surface lack the target version: take the names the watch script
# enumerates, then ask the registry for each. Result 2026-09-18: 108 of 110 carry
# 0.1.5-rc.2; dsh-client-runtime and dsh-host-apiproxy do not (§5).
node -e "for (const x of process.argv.slice(1)) fetch('https://registry.npmjs.org/'+x.replace('/','%2F')).then(r=>r.json()).then(j=>console.log((j.time['0.1.5-rc.2']?'OK   ':'MISS ')+x))" @deepseek-ai/dsh-client-runtime @deepseek-ai/dsh-host-apiproxy

# age gate (the gate clears 24h after the LAST package was published)
npm view @deepseek-ai/dsh time
npm view @deepseek-ai/dsh-llm-deepseek time

# target tag → commit
gh api repos/deepseek-ai/deepseek-harness/releases --paginate
gh api repos/deepseek-ai/deepseek-harness/tags --paginate

# catalog diff between the pins (extract the published tarball, grep DEFAULT_MODELS)
#   0.1.1-rc.2: 3 entries, deepseek-flash absent
#   0.1.5-rc.2: 4 entries, deepseek-flash first with inputModalities ["text","image"]
```

**Machine-local context (not repository state):** `C:\Users\chidi\.dsh\settings.yaml`
carries the override described in §2; the live host was verified with a loopback
`settings.describe` call. The operator's workspace also holds
`bookshelf_preview.png` (a Rhino viewport capture) and `.firecrawl/deepseek-pricing.txt`
(the scraped pricing table) — unrelated to this bump.
