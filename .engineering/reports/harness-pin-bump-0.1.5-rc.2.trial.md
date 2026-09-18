# Pin bump report — harness `dsh-v0.1.1-rc.2` → `dsh-v0.1.5-rc.2`

**Artifact type:** Lane C trial + adapt report (`upstream-watch.md` § "The eval decision tree").
**Date:** 2026-09-18, pearl (Windows 11). **Branch / worktree:** `up/harness-0.1.5-rc.2` at
`~/.dsh-resolver-worktrees/up-harness-0.1.5-rc.2` (local only, not pushed).
**Brief executed:** `.engineering/plans/harness-pin-bump-0.1.5-rc.2.plan.md` (untracked in the
primary checkout). **Ruling:** the owner ruled **ADAPT** after the first trial pass stopped on
the host/client API breaks.

## Outcome

- Full headless gate **green**: `corepack yarn check` exit 0 (layout, electron, fabric/market
  docs, market 272 tests, preset 162, desktop 887, `verify:closure` 247 nodes closed,
  `verify:cli`, `verify:loader`, `verify:profile`, `verify:licenses` 521 packages).
  Baseline on the unchanged tree was also green, so nothing red was inherited.
- `check:win-package` green (11 files, 173 tests) — required because the Windows ACL patch moved.
- Running-app validation in an isolated lane (`DSH_HOME` + `--user-data-dir` under
  `~/.dsh-lane-c`), operator's `~/.dsh` and `%APPDATA%\DSH Desktop` verified byte-identical
  afterwards:
  - boots clean on the default profile (error log: only the expected "previous run did not
    shut down cleanly" after a forced stop);
  - the renderer authenticates (anonymous `GET /` → 401; the window loads the real UI, no
    token in its history); Plugin Market loads; 55 client boot entries;
  - branding holds: served `<title>` is `Parametria`; the hero headline's upstream text is
    hidden and the `::before` override renders in its slot;
  - the host's runtime catalog is `dsh-llm-deepseek@0.1.5-rc.2` with **`deepseek-flash`
    (`DeepSeek-V41-Flash`, text + image, `systemPromptUpdate: in-history`) first**. The
    Models page lists providers only until an API key exists; no key was put in the lane.

## Why (the symptom)

| Pin | `llm-deepseek` built-in catalog |
|---|---|
| `0.1.1-rc.2` | `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp` |
| `0.1.5-rc.2` | **`deepseek-flash`** (text + image) + the three above |
| `0.1.6-alpha.2` | `deepseek-flash`, `deepseek-v4-pro` (no newer model) |

## What moved, commit by commit

1. **Pin surface** — gitlink `fb2c4b9e69`, `upstream.json`, 200-entry surface (was 190),
   lockfile by Yarn 4.18.0; retired `dsh-client-runtime` / `dsh-host-apiproxy` removed and
   their imports repointed (`cordis` `Context`, `ui-conversation/client`,
   `api-workspace-controller/client`, `client-store`).
2. **Patches** — see the table below.
3. **Runtime graph** — 16 first-party packages joined desktop `dependencies` (split-out peers
   and the peers `verify:closure` reported), `ui-chat` / `ui-renderer` (slot system),
   `schemastery ^3.18.2`, `lexical` / `@types/mdast` type deps, market type-only devDeps.
4. **cordis 4.0.1 → 4.0.2** (+ plugin-group/include/loader/timer): two cordis runtimes had
   been installed (211 packages nested under `@deepseek-ai/dsh`); now one per workspace.
5. **Host adaptation** — `settingsNamespace` → literals; `LocaleId` widened;
   `ProfileTemplate` `{ bundles, patchReload }`; async module-fallback heal awaited before
   profile prep; agent-preset `RemoteError` codes; `SubprocessHandle.pid` removed.
6. **Client adaptation** — slot declarations moved to `ui-renderer` / `ui-chat`; the advanced
   frame implements upstream's `ILayout` (`main` keyed panels + `rightbar`); the turn-cost
   badge keeps its per-message placement (slot moved to `ui-chat`) and reads trajectory via
   the hook that activates the lazily assembled target; folder drop uses
   `ctx.uiWorkspace.startSession`; hero branding follows the new title group.
7. **Parametria preset** — `dsh-persona` replaced `text` with a required `prefix`: without
   the port the persona row is REJECTED (`$.prefix missing required value`, verified against
   the real schema) and the run loses its instructions. Parity rows inherited from upstream
   `standard`; drift fixture follows the moved shipped presets; default-model tripwire
   re-read (see below).
8. **Packaged CLI** — upstream `bin.js` now runs only as the process entry and exports
   `runCli`; the desktop shim imported it and silently did nothing (built-in terminal `dsh`).
   The shim now calls `runCli({ allowDesktopProfile: true })` and fails loudly otherwise.
9. **Browser authentication** — 0.1.5-rc.2 requires a launch-token → signed-cookie exchange
   for every index/RPC request. The shell now exchanges `ctx.connection.authenticatedUrl()`
   in the window's own session before `loadURL`; without this the window opened on a 401.
10. **Re-anchored specs**, capture-tool citations re-verified at the new lines, docs
    restamped with their bilingual records, notices regenerated, `upstream-watch.md` tables.

## Patches

| Patch | Result | Notes |
|---|---|---|
| `dsh-llm-deepseek` | **RETIRED** | Absorbed upstream (`a1271a4903`, `acceptIdentity`). `deepseek-streaming-tool-call.spec.ts` passes unchanged against the unpatched package. Provider wire → pending live datum. |
| `dsh-sandbox-windows-acl` → **`dsh-win32-process`** | moved, scoped | STARTUPINFO moved packages; the job spawner is shared with ordinary spawns, so the hidden show state is scoped to `CreateProcessAsUserW` (behavior-preserving). |
| **`dsh`** | **new** | `runCli({ allowDesktopProfile })` — upstream reserved the `desktop` profile for its own Electron app (`19444907f0`). Ported from the fork parent, minus its unrelated `windowsHide` hunk. |
| `dsh-subagent`, `-in-process-driver`, `dsh-tool-fs`, `directory-picker-browse` | re-cut | Behavior-preserving; no hunk absorbed upstream. |
| `dsh-app-boot`, `dsh-client-ui-workspace` | rename | Meaning re-read at the new offsets. |
| `pi-ai` | `0.82.1` → `0.85.1` | Transitive range moved (the #60 fence caught the dead selector); not absorbed. Spec re-anchored to a model still in the bug class; the incident model is now fixed upstream. Provider wire → pending live datum. |
| `app-builder-lib` | untouched | Not harness-versioned. |

## Behavior changes inherited from upstream (not fixed here, by rule)

- **Default model** is now `deepseek-flash` (image-capable) in `dsh-base`. Issue #1's
  "text-only main model" demonstration no longer happens by default; it needs an explicit
  text-only selection (`deepseek-v4-pro`).
- **Parametria parity rows:** `/goal` command, `present` tool, subagent
  `modelSelectionSettings: true`, web `fetch: true`.
- **Mis-routed delegation** fails in upstream's pre-creation route preflight (PR #2663) with
  a clear provider error and no child session (was `NO_ADAPTER` from the child).
- **Advanced mode right panel:** visibility per session (upstream's model), overhang/fullscreen
  presentations, rail collapse on narrow windows. Our geometry (360 / 300–520 / centre 640) kept.
- **Browser auth:** a copied Web URL opened in an external browser now needs the token.

## Follow-ups to file before the PR opens

1. Live provider confirmation for the two wire patches (`dsh-llm-deepseek` retirement, `pi-ai`).
2. Lane D: directory-picker button border `1px` vs upstream `.5px`; advanced right-panel
   sizing (upstream 45% / 70% cap vs our 360px).
3. Issue #1: decide how the text-only-main demonstration is exercised now.
4. Parametria preset on a fresh home: its three profile packages are not installed by
   `install-profile`, so the profile's plugin tree fails to load (**pre-existing** — reproduced
   identically on the unchanged 0.1.1-rc.2 checkout).
5. Unfenced upstream line citations in `preset/agent.cordis.yml` (e.g. `tool-subagent:372`)
   were already stale at 0.1.1-rc.2; re-derive or fence them.
6. Upstream reports: `dsh-subagent`'s `SessionProjectionStateMap` augmentation is unreachable
   from its published types (shimmed in `tests/upstream-subagent-projection-shim.d.ts`, which
   turns into TS2717 once fixed).
7. Optional: profile-scoped module-fallback heal (new upstream behavior, deliberately not adopted).

## Cross-platform notes

- The `dsh-win32-process` patch only executes on Windows; macOS/Linux are unaffected by it.
- The browser-auth fix is platform-neutral (Electron `session.fetch`), but it was validated
  in a running app on **Windows only**. macOS/Linux GUI behavior is unverified here; CI's
  `desktop-macos` (`dist:mac-smoke`) and `check` (ubuntu) jobs are the next observers.
- The lockfile was written by **Yarn 4.18.0 via Corepack on Node 24.19.0**. CI builds on Node
  22.23.2 (#87); the lockfile format depends on the Yarn release, not Node.
- **This machine's `~/.yarnrc.yml`** (`yarnPath: yarn-4.9.1`) silently replaced the pinned
  Yarn for every checkout under the home folder, and a license-check child process dropped the
  `YARN_IGNORE_PATH` workaround. The owner renamed it to `~/.yarnrc.yml.bak` on 2026-09-18.
  Other fleet machines (Omarchy, macOS) may carry the same file — a #87-class audit item.

## Phase 2 (after merge) — operator's machine

Stop the app → `git pull --ff-only` → `git submodule update --init --recursive` →
`corepack yarn install --immutable` → `corepack yarn check` → relaunch. Then **remove the
`llm-deepseek` section from `~/.dsh/settings.yaml`** (its replace-by-value `models` array would
hide `systemPromptUpdate: in-history` on the built-in `deepseek-flash`), and confirm with an
image round-trip on `deepseek-flash`.
