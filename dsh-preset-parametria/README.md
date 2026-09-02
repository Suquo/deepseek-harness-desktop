# dsh-preset-parametria

The **Parametria work profile**: a composed, reproducible run environment for
`/suquo-systems-parametria` sessions on DeepSeek Harness Desktop.

A Parametria run used to depend on hand-arranged session state — which skill
copy happened to load, which model the session happened to be on, whether the
person remembered that a validator subagent inherits that model. This package
turns that arrangement into two directories that install, verify, and travel.

Per [ADR H-0001](../.engineering/adrs/H-0001-fork-strategy-parametria-harness-overlay.md)
it is composition only: an
agent preset and a desktop profile patch layer. Nothing here forks upstream,
and nothing here is an upstream source edit.

## What it installs

```
$DSH_HOME/.agent-presets/parametria/     the agent preset
  agent.cordis.yml                       standard-parity toolset + the deltas below
  preset.yml                             display name and description
  skills/                                preset-local skill root (empty; see issue #7)

$DSH_HOME/profiles/parametria/           the desktop profile
  package.json                           dsh.profile.bundles: base, then web-app
  cordis.patch.yml                       the profile's own patch layer
  pnpm-workspace.yaml                    the pnpm settings a profile directory needs

$DSH_HOME/cordis.patch.yml               YOUR machine-wide patch layer —
  # >>> ... managed >>>                  one delimited block inside it, carrying
  # <<< ... managed <<<                  the parametria-vision route
```

### One environment variable the operator sets once

The preset mounts the `parametria_capture` tool (issue #24), which runs the
skill's `screenshot-definition.py` from the Host plane. It has to be told where
that script is, and that path cannot live in this repository: `agent.cordis.yml`
is version-controlled and installed machine-wide, so a literal there would ship
one machine's path to every machine. Set it once, in the environment DSH Desktop
launches with:

```
DSH_PARAMETRIA_CAPTURE_SCRIPT=C:\Users\<you>\.agents\skills\suquo-systems-parametria\scripts\screenshot-definition.py
```

Until it is set the tool refuses **by name** rather than silently registering a
capability it cannot perform, and the persona tells the run to report the
missing variable instead of working around it. An explicit `captureScript`
config key on the row outranks the variable for a deployment that prefers to pin
it. Issue #7's skill-root canonicalization will change what this defaults to,
not how it is spelled.

The first two land in directories upstream already scans — `includeUserRoot`
makes `$DSH_HOME/.agent-presets` a preset root, and `profiles/` is where
`resolveProfileDir` looks — so the deployment's read-only shipped install is
never touched.

The third is not this package's file. `$DSH_HOME/cordis.patch.yml` is upstream's
machine-wide layer, applied after every profile's own, and the installer is a
guest between its own markers there: it creates the file when absent, appends
its block when the file exists without one, replaces its own block when the
receipt still matches what it wrote, and refuses otherwise — a hand-edited
block, an unterminated one, or a machine patch that already targets the
`llm-pi-ai` row itself. Everything outside the markers is never read as its own
and never rewritten.

`--force` releases *this installer's claim over its own block* — a block edited
since it was written, or one carrying no receipt. It is deliberately not a
release for the other two refusals, and those refusals say so rather than
advertising a flag that would refuse again: an `llm-pi-ai` row of your own is
your configuration, not this installer's to replace, and a block whose closing
marker is missing has no known extent for a forced write to overwrite.

```sh
yarn workspace dsh-preset-parametria install:profile            # install
yarn workspace dsh-preset-parametria install:profile --dry-run  # show the writes
yarn workspace dsh-preset-parametria install:profile --force    # overwrite local edits
yarn workspace dsh-preset-parametria install:profile --default  # ...and boot into it
```

Selecting the Parametria profile is optional. **The validator's route works
under whatever profile you already boot** — keep `desktop`, with whatever you
have added to it, and the preset still validates with vision. Pick Parametria in
the profile picker (or `dsh --profile parametria`) only if you want the
profile's own defaults as well.

### Why the route is machine-wide

Because the preset is. That asymmetry, when it existed, was the sharpest edge in
this package and it cost issue #1 two live runs:

| what | where it lands | which profiles see it |
|---|---|---|
| the agent preset (persona, delegation, `subagent_validator` pinned to `parametria-vision`) | `$DSH_HOME/.agent-presets/parametria/` | **every** profile — `includeUserRoot` scans this root whatever boots |
| the `parametria-vision` route that pin needs | *was* `profiles/parametria/cordis.patch.yml` — **now** `$DSH_HOME/cordis.patch.yml` | *was* the `parametria` profile alone — **now** every profile |

While the two planes disagreed, any other profile loaded the persona, spawned
the validator, and handed each child the right route config — and each one died
at its first request with

```
no adapter registered for provider "parametria-vision"   (NO_ADAPTER)
```

Both lost runs were booting `desktop`
(`%APPDATA%\DSH Desktop\profile-selection\state.json` read `"active": "desktop"`
throughout) while every other signal looked right — because every other signal
*was* right, and home-level. Upstream applies the machine-wide layer after every
profile's own, in the desktop launcher and the CLI alike, so one declaration now
reaches every profile on both surfaces; the profile-level copy is retired rather
than kept, since the home layer would outrank it and a drifted copy could only
ever be a lie.

The installer still reports which profile the launcher will boot — it is the
first thing anyone debugging a run wants — but it no longer refuses over it, and
it keeps its three answers apart: a recorded selection, none recorded yet
(`--default` can still seed that), and a state file it could not read. An
install whose `--home` is not the launcher's home skips that report entirely, so
test and evidence harnesses are never judged against the operator's machine.

### Making it the profile the app boots into

`--default` is for a machine that has never run DSH Desktop — a fresh install,
a new workstation, a reset `userData`. On any machine that *has* run it, the
tray profile picker is the answer instead: that choice already persists across
restarts, so a profile picked once is the default from then on.

Read this before reaching for an environment variable:
**`DSH_DESKTOP_DEFAULT_PROFILE` cannot make a profile the one the app boots.**
It looks like it should, and it does not. It is an *output* of the boot
decision, not an input — the launcher writes it into the built-in terminal's
environment from the profile it has already selected, so that a bare `dsh …`
typed there targets the same profile you are looking at. `desktop-cli.ts` takes
it, deletes it, and turns it into a `--profile` flag for the *upstream* DSH
CLI. The desktop launcher itself rejects `--profile` outright, and Electron is
started with no arguments at all. The only input to which profile boots is the
launcher's own selection state:

```
<userData>/profile-selection/state.json    %APPDATA%\DSH Desktop\… on Windows
```

That is the file `--default` seeds, and seeding it is the only mechanism that
works. It writes exactly what a first pick in the tray picker writes — the
profile in `pending`, with `active` and `lastKnownGood` left on `desktop`:

```json
{ "version": 1, "active": "desktop", "pending": "parametria", "lastKnownGood": "desktop" }
```

Going through `pending` rather than claiming `active` means the launcher's
existing rollback contract still covers it. If the profile turns out not to be
selectable, or its shell fails to mount, startup falls back to `desktop` on its
own; the profile is promoted to `lastKnownGood` only after it has actually come
up. The installer asserts nothing it cannot know.

**It refuses when that file already exists**, and no flag releases that refusal
— `--force` releases this installer's claim over the files *it* wrote under
`$DSH_HOME`, which the selection state is not. The test is deliberately
"absent", not "unchosen": the launcher rewrites this file on every boot, and
deliberately picking `desktop` produces a document identical to the untouched
default, so once the file exists nothing can tell "never chose" from "chose the
other one". Absence is the only unambiguous permission, so absence is the whole
permission. The refusal names the file and points at the tray picker.

That refusal is raised before anything else is written, so the ordinary "you
already have a selection" case leaves no half-applied install. The guarantee
stops exactly there, and the code says so: the seed is written *last*, once the
profile it names exists, so a selection appearing between the check and the
write is refused at the syscall with the profile already on disk. That run
exits non-zero saying the profile installed and only the default was not set —
not as though nothing happened.

One race is not defended and is not worth defending: if DSH Desktop is starting
at that exact moment, its own startup write can land on top of the seed
(`renameSync` ignores our exclusivity), and the seed is lost. The running app
winning is the safe direction — it is the picker's own state — but the success
line is optimistic in that window.

`--default` also refuses when `--home` points somewhere the launcher will never
read. The launcher resolves its home from `$DSH_HOME`; `--home` is invisible to
it, so the pair would seed a selection naming a profile the app cannot find,
which it would roll back at the next start. Set `$DSH_HOME`, or pair `--home`
with an explicit `--user-data-dir` for a genuinely isolated instance.

`--user-data-dir <dir>` overrides where the state is looked for, for a
non-default Electron data root — an isolated instance started by invoking the
packaged Electron binary directly with Chromium's `--user-data-dir` switch.
(The `dsh-plugin-desktop` launcher CLI does not accept that switch: it rejects
any argument it does not enumerate.) It only means anything with `--default`,
and says so rather than being ignored.

## The five things it composes

Four are guarantees the composition enforces. The fifth (section 5) is a
convention the persona states and the fences hold in place — named separately
because a persona instruction is not a guarantee, and section 5 says so.

### 1. A validator that can actually see

**Be precise about what was broken.** Upstream's image gate is already
fail-closed and route-agnostic: `assertImageCapableRoute`
(`packages/fs/tool-fs/src/read-image.ts`) resolves the calling agent's route
and throws unless it declares `image` input, and `dsh-llm-deepseek` hardcodes
`inputModalities: ['text']`. A validator subagent on a text-only session model
does not silently read a blank image — every read is refused, loudly, per call.

The silence is one level up. The child still finishes, and still returns a
summary. A summary written around a stack of refusals reads exactly like a
passing validation, which is what the first Parametria run produced: *"the
validator's report would have read as a clean pass had it not disclosed the
error."* So the harness never lied; the delegation shape let a report be
mistaken for a verdict.

This preset does not add a refusal. It removes the need for one. The preset
carries a second `dsh-tool-subagent` instance, `subagent_validator`, whose
`agentOptions` pin the route and model explicitly — explicit values override
what a child would inherit. Child model policy is fixed per instance and
per-call model selection does not exist, so "another model" means "another
distinctly named tool", which is exactly what this row is. The machine-wide
patch layer declares a `parametria-vision` pi-ai route whose model entry states
`input: [text, image]`, which is what makes that route pass the gate. The
modality field exists only on `dsh-llm-pi-ai`; `dsh-llm-deepseek` exposes none,
which is why the vision route has to be a pi-ai route.

The persona carries the other half: a `subagent_validator` result that reports
refused reads means the run is **unvalidated**, and a child's conclusion about
an image it could not open is never restated.

The route is hand-declared and separate from the operator's own `openrouter`
route on purpose: that route is the session-model route, live in
`settings.yaml` and rewritten by the web Models page. A validator whose vision
guarantee rode it would inherit every edit made to it.

**The validator is a leaf, and the reason is not the one first written down
here.** A child joins its parent's preset (`composeFrom`), so the validator holds
every delegation row this composition mounts. `maxDepth: 1` is the cap on *this*
row — the smallest value admitting the depth-1 spawn the persona mandates,
derived rather than guessed; it shipped as `0`, which refused every attempt of
the first live run (issue #18). But a cap binds only starts made *through the row
that carries it*, so it reaches neither the sibling `subagent` / `subagent_fork`
rows nor `ralph` / `workflow`, which request no cap at all.

What a grandchild through those rows would be was stated wrongly here and in the
preset's own comment, and the correction is worth keeping visible: **not a child
back on the session model.** Upstream resolves a child's route from its *calling*
agent's live options (`resolveChildAgentOptions`,
`packages/subagent/subagent/src/child-agent.ts`), and the caller for a start made
inside the validator is the validator — which runs on the pinned vision route. An
uncapped grandchild therefore recurses and spends on the paid route; it does not
go blind. The blind-child hole was never reachable one level down (issue #20).

The row closes it a layer up instead. A `toolFilter` deny list withdraws every
delegation-starting tool from the child, so the validator cannot start one at any
depth, on any route, through any row — containment and simplicity, on the premise
that a validation pass is a question with an answer rather than an orchestrator.
The filter is applied inside the child's creation window, after the preset join,
and names only tools that rows in this file register and leave enabled: an
unregistered name throws there and would break every validator spawn, so the list
is derived from the composition itself rather than hand-kept.

**What the guarantee is bounded by.** `agent-presets.default: parametria` is a
fallback, not a lock: a session the operator points at another preset has no
`subagent_validator` at all. And `assertImageCapableRoute` reads the session's
request-header route before `agent.options`, so a plugin that rewrites the
route through the `agent/request` waterfall would displace the pin. Nothing in
this composition does either, but neither is fenced here — they are properties
of the surrounding deployment.

### 2. A skill root that travels with the preset

`dsh-skill-filesystem` is mounted inside the preset with `customSkillDirs`
resolved from the preset's own `baseUrl`, so the skill lands in *this preset's*
layer of the host registry, where the nearest layer wins duplicates outright.

The directory **ships empty**. An absent or empty root discovers nothing, so
the operator's existing `~/.agents/skills/suquo-systems-parametria` copy keeps
resolving unchanged. Seeding a placeholder under the real skill's name would
shadow the working skill with a stub. Issue #7 migrates the canonical copy in
here; the seam is what this package delivers.

### 3. A session model that is left alone

The profile deliberately does **not** pin `agent-default-model`. Issue #1's
acceptance criterion is that a run whose *main* model is text-only still
produces successful subagent image reads — pinning a vision model for the
session would make that untestable, and a saved user selection outranks the
composition row anyway.

### 4. A run that meets this host's sandbox boundaries without widening the session

The first live run of this profile hit three sandbox refusals under the composed
`workspace-write` default and ended with the operator typing
`/permission danger-full-access` mid-run (export `dsh-session-853a0bc2`,
L71/L82/seq 201/L197 — an operator-held session export that lives outside this
repository; issue #9's comment thread carries the harvest). That is a worse
trade than it looks: the shipped
`danger-full-access` preset bundles `approval: never`, and that policy's own
context contribution tells the model *"do not request sandbox escalation (do not
set `sandbox_permissions`)"* — so the keystroke that unconfined the filesystem
also switched off the one control that could have kept the next widening down to
a single command.

**What the sandbox vocabulary can and cannot express**, since this determines
the whole shape of the fix:

- `SandboxMode` is `read-only` / `workspace-write` / `danger-full-access` and
  governs **file effects only**. `dsh-sandbox-policy` states plainly that *extra
  writable roots are not part of `SandboxExecutionPolicy`* — so "grant the uv
  cache path" is not a thing composition can say, on any surface.
- `dsh-shell-env` collects only `DSH_*`-prefixed variables into shell calls
  (the prefix is enforced, not conventional), and no shell executor exposes an
  environment map in config. So `UV_CACHE_DIR` cannot be injected by
  composition either.

Two of the three refusals therefore have a **relocation** answer rather than a
policy answer. The third has no answer inside the sandbox at all — issue #24
took it out of the sandbox instead, by making the capture a Host-plane tool
(`dsh-plugin-desktop/parametria-capture`, mounted by this preset) rather than a
shell command that has to be escalated:

| Refusal | Why | What this profile does |
|---|---|---|
| uv cache at `%LOCALAPPDATA%\uv\cache` | outside the session workspace | persona sets `$env:UV_CACHE_DIR = "$PWD\.uv-cache"` before `uv run` — the live run proved a workspace-local cache works unescalated |
| uv cache at `C:\tmp\uv-cache` | an arbitrary absolute path is outside both granted roots. Temp *is* writable under `workspace-write` — but only the private per-session directory the runner creates and rewrites `TMP`/`TEMP` to, never an ambient path that merely looks temporary | same |
| `screenshot-definition.py` (Playwright) | **inference from the live trace, over a documented mechanism.** The win32 ACL backend documents that a confined process's `stdio: 'pipe'` children fail — named pipes carry a default SD that denies the client-end write — while `inherit`/`ignore` spawns work, so *"tools that must capture output cannot run confined"*. That Playwright's sync driver spawn is the piped shape is not stated upstream; it is what the live traceback shows (`asyncio/windows_utils.py`, `PermissionError(13)`), plus every post-escalation call succeeding | **retired by issue #24**: the run calls the `parametria_capture` tool, which spawns the same script from the Host plane where nothing is confined. No escalation, no approval — and it is the only capture path a delegated child can use at all |

**Why per-call and not a named preset.** A fourth permission preset was built
for this and did not survive review — the record is on issue #9. It would have
been `danger-full-access` + `ask`: the same file access the operator reached
for, with the approval channel left on. The defect is that the desktop's
full-access **risk acknowledgement is gated on the preset key, not on the
sandbox mode it carries** —
`packages/client/ui-conversation/src/client/skeleton/PermissionSelect.tsx`
declares `const FULL_ACCESS = 'danger-full-access'` and routes only that literal
id through its confirmation Modal. Any *other* key carrying the same mode
therefore reaches unconfined access from the composer's Access chip with no
acknowledgement. The owner ruled to keep the acknowledgement, so the profile
patches no permission row at all and
`tests/profile-patch.test.mjs` fences both halves of that: the shipped table is
unchanged, and the patch layer does not target the row.

That leaves the per-call escalation as the whole answer, which is also the
narrowest one available: it asks the user per command, and it leaves
`approval: ask` standing for everything after. The persona states it as the only
route and is fenced against growing a "switch the session instead" sentence.

**A cost worth naming:** `$PWD\.uv-cache` is a real directory in whatever
workspace the run happens in — typically a user repository, and this package
still cannot gitignore it for a consumer. Section 5 is the other half of that
trade for *this* repository: `.uv-cache/` is ignored here, and the fence there
derives the ignore list from the persona, so the next dot-prefixed workspace
directory the persona names fails the gate until it is ignored too.

### 5. A run whose artifacts land in one directory the host resolves

The same relocation move as section 4, applied to output instead of caches —
and, since issue #23, the one place the relocation is *computed* rather than
described.

Where a run's files land is decided by an argument the model types, and nothing
in composition governs a CLI argument: `screenshot-definition.py` hands its
positional path straight to Playwright without normalising it, and
`convex-parametria.mjs decompile-definition` defaults to a POSIX `/tmp/spec.json`
that lands at `C:\tmp\spec.json` here. The skill's own output-path examples are
absolute paths under `C:/tmp/...` or `/tmp/...` — and both are outside the
session workspace, which is what `workspace-write` grants. So a run faced a
two-sided trap: follow the skill and escalate, or improvise bare filenames that
land in the workspace root. Runs improvised, and the workspace root was this
repository — which is how `cabinet-*.png`, `spec.json`, and a later run's
`gen-*.js` generators became untracked litter beside real work.

**The run directory is now a fact of the host, not a recipe in the persona.**
The `parametria-evidence` row (`dsh-plugin-desktop/parametria-evidence`)
registers a `ctx.shellEnv` contributor that resolves, per shell call, from the
CALLING session's workspace and id:

    $env:DSH_PARAMETRIA_EVIDENCE_DIR   →   <cwd>/.parametria-evidence/<session id>/

`dsh-plugin-desktop/src/parametria-evidence.ts` is the single declaration of that
root and the single derivation of the path; `parametria-capture` re-exports the
segment and calls the same two functions, so the directory the tool writes into
and the directory the run's own commands are handed cannot disagree. The
persona's job shrank to one sentence — read the variable, do not rebuild the
path — plus the parts no surface covers (below).

Four properties this shape is chosen for:

- **The workspace is the root `workspace-write` grants**, and every wider mode
  grants it too, so the same run directory serves the confined commands and the
  Host-plane capture tool alike. (Not `read-only`, which grants nothing — but a
  run that cannot write has no artifacts to place.)
- **The value rides every shell call an agent owns**, including per-call
  escalated ones, because `ctx.shellEnv.collect(exec)` is called by the shell
  *tool* (`tool-pwsh/src/index.ts:363`, `tool-bash/src/index.ts:341`) rather
  than by the sandbox runner — and the sandbox executor is a subclass of the
  local one (`pwsh-sandbox/src/index.ts:52`), so the merge at
  `pwsh-local/src/index.ts:240` is the same line for confined and unconfined
  work. Ambient `DSH_*` is discarded first, which is what makes a registered
  contributor the only way the value can exist.
- **It is created before it is published**, together with a self-ignoring
  `.gitignore` (`*`) at the evidence ROOT. Naming a directory that does not
  exist was most of the original problem: a script writing into a missing parent
  fails, and the model's recovery is a bare filename in the workspace root.
  Creation is not configurable (a knob that made the persona's "creates it"
  sentence false had no consumer and was removed on review). It is
  **fail-open**: on a workspace the host cannot write into, the variable is
  still published, the host logs one `could not prepare …; publishing the path
  anyway` warning per shell call, and the run's own first write fails loudly —
  the persona tells it to create the directory itself and carry on. Only a
  SUCCESSFUL preparation is memoized (per generation, so a profile switch
  re-prepares for free); a failure is retried on the next call, so a transient
  cause recovers by itself.
- **The orchestrator still passes absolute paths down.** A delegate is its own
  session (verified in export `dsh-session-60658537`, whose child header carries
  a different `id` with `parentSession` set), and the contributor resolves from
  the calling session — so the delegate's copy of the variable names the
  *delegate's* directory. Moving the derivation into the host did not close that
  gap, and the persona still owns the instruction that does.

**What this does not do**, stated precisely, because the containment is
narrower than it first reads:

- **It governs the path; it does not police the write.** A model that ignores
  the variable still writes `cabinet-verify.png` into the workspace root, and no
  ignore rule matches that name. Refusing a write by path is not expressible at
  this pin — `PreToolDecision` is `allow | deny | ask` with input rewriting
  explicitly excluded (`core/tools/src/index.ts:588`, `:585`) and
  `SandboxExecutionPolicy` carries no extra writable roots
  (`sandbox/sandbox/src/index.ts:39-52`). What changed is that following the
  convention now costs the run nothing: there is no path to derive, no directory
  to create, and no session-id expansion to check.
- **The self-ignore travels; the repository entry does not.** The `*` marker
  inside `.parametria-evidence/` means a run working in *any* checkout ignores
  its own evidence. This repository's `.gitignore` entry stays as belt and
  braces. The same is NOT true of `.uv-cache` (section 4), which is still
  created bare in whatever repository the run opens and is ignored only here.
- **The run directory has no reaper.** One directory per session accumulates
  screenshots, spec dumps and generator scripts under the workspace, and
  ignoring them removes the `git status` nag that previously made the litter
  self-limiting. Its RELEASE is deliberately manual and total: nothing in the
  harness, the preset or the skill reads `.parametria-evidence/` after the run
  that wrote it, so the whole directory can be deleted at any time, wholesale,
  with no recovery step. That is the retention answer for what ships here, and
  it survives issue #23 unchanged — the debt a real policy would settle belongs
  to a location that cannot be cleared so freely, which this one is not.

## What this deliberately does not ship

Issue #9's item 1 asked for two things — rows *granting* the run's
playwright/node/uv execution surface, **and** a place run evidence lands.
Sections 4 and 5 deliver what composition can express of each; the remainders
carry their own issues, because #9 closes with this section:

- **Command-level policy for node / uv / playwright — issue #24.** Allowing or
  denying *specific commands* is a `tools/pre-execute` interception, not a
  config field, and auto-answering an escalation would mean a second
  `approval/request` answerer beside the desktop's own (upstream: compose one
  terminal answerer per deployment). Both need a desktop-owned plugin —
  Increment 3 of the harness research (`parametria-tools`), not profile
  composition. No *grant* narrower than a sandbox mode exists to compose, which
  is why section 4 ships a per-call escalation instead.
- **A write the harness can REFUSE by path — no issue, because no surface.**
  Issue #23 delivered the structural half of section 5 (the host resolves,
  creates and publishes the run directory, and one module owns the derivation),
  but not enforcement: nothing at this pin can deny a write outside a root, per
  the citations in section 5. Evidence landing beside the session transcript in
  upstream's reserved `sessionDir` remains the reversible alternative recorded
  on issue #9 — it costs the confined producers, which cannot write there.
- **The skill's own documented paths** — its examples write to `C:/tmp/...` and
  `/tmp/...`, both outside what this host grants, so loaded skill text competes
  with the persona on every run. That is an SK-class change outside this
  repository, pending the landing-surface ruling.
- **The skill itself** — the mount seam ships, the skill does not; issue #7
  owns the migration, for the shadowing reason given above.

`dsh-session-stats`, which the research listed as absent from the default
composition, needs nothing here: the `dsh-web-app` bundle mounts it, and
`tests/profile-patch.test.mjs` fails if that stops being true.

## Fences

`yarn workspace dsh-preset-parametria check` runs `node --test
"tests/**/*.test.mjs"`, and the root `corepack yarn check` invokes it. There is
no build step and no runtime dependency; the package is configuration plus one
installer.

The root `corepack yarn test` reaches this workspace too. That script is pinned
by exact string in `dsh-plugin-desktop/tests/package.spec.ts`, so the root chain
and that pinned string had to move in one change — and `scripts/verify-layout.mjs`
now fails the gate if any workspace defining a `test` script drops out of the
root chain again.

| Fence | What it holds |
|---|---|
| `tests/preset-drift.test.mjs` | Exhaustive **two-direction** diff against the pinned upstream `standard` preset. Rows added, dropped, or reconfigured must appear in a closed `DECLARED_DELTA` with a stated reason; shared rows must keep the same plugin name, `disabled` expression, group shape, and `isolate` realm. Also holds the validator row's pin and the empty skill root. |
| `tests/validator-depth.test.mjs` | The validator row's `maxDepth`, **derived** from the pinned upstream's own depth arithmetic rather than asserted as a literal: it imports and executes `delegationDepthOf` / `assertSubagentMaxDepth` from the submodule and requires the cap to be exactly the depth the mandated child occupies. |
| `tests/validator-leaf.test.mjs` | The validator row's `toolFilter` deny list, **derived** from this composition's own rows: every enabled row is classified against upstream source (does its package register a model-facing tool *and* reach a child-start seam?) and the deny list must equal that set. Also that every denied name is one an enabled row actually registers — an unregistered name would throw in the child's creation window and break every validator spawn, not the build. |
| `tests/vision-route.test.mjs` | Every declared field of the `parametria-vision` model entry diffed against the **installed** pi-ai catalog entry — modalities, endpoint, protocol, capacities, reasoning dialect. A hand-declared route inherits nothing, so an unstated field silently falls back to the route guesses. |
| `tests/profile-patch.test.mjs` | The patch restates every field of each bundle row it replaces (an id-targeted patch has no deep merge), targets only rows the composed bundles provide, inserts nothing, and keeps the manifest web-capable and free of the launcher-owned desktop bundle. Also that each patch entry carries `id` and `config` and nothing else — a patch key lands on the target **row**, so a stray `disabled`/`group`/`isolate` would unmount or relocate a plugin while every config-shaped assertion stayed green — and that the permission table is neither patched nor extended, per the issue #9 ruling. |
| `tests/evidence-hygiene.test.mjs` | The **dot-prefixed** workspace directories the persona tells a run to create, **derived** from the persona text rather than restated, each asserted ignored by *this repository's own* `.gitignore` via `git check-ignore --no-index --verbose` with `core.excludesFile` emptied — so a persona naming a new dot-prefixed directory fails until `.gitignore` covers it, and a rule inherited from a developer's global excludes cannot stand in for one that travels. A non-dot name is not separable from prose and stays a review question, which the fence documents. Two counter-assertions (a plain tracked file and a dot-prefixed one) keep an over-broad rule — `*` or `.*` — from making it vacuous. |
| `tests/install-profile.test.mjs` | The installed file set, idempotent re-install, refusal on a locally modified file, and `--force` as that claim's release. For `--default`: the whole seeded document (not a probe for the profile name), that an ordinary install leaves the state absent, that the refusal fires **before any other write**, that `--force` does *not* release it, and that exclusivity survives the check being bypassed — `flag: 'wx'` and `planDefaultSelection` are asserted separately, because the check only produces the message while the flag makes the guarantee. Also the bound on that: a seed failing *after* the files land says so rather than reading as a no-op, no failure leaks a bare errno, an occupied directory path is not mis-reported as an existing selection, a pre-existing state directory is tightened to `0o700` the way the launcher tightens its own, and the dry-run result carries an `action` discriminator so a caller cannot mistake a rehearsal for a durable write. |
| `tests/machine-patch.test.mjs` | **Which plane declares the route**, in both directions — the machine block declares `parametria-vision`, the profile layer does not declare `llm-pi-ai` at all, and the profile layer's row set is exactly `agent-presets`. That pair is the fix for issue #1's root cause, so a revert of either half fails here. Plus the guest discipline over the operator's `$DSH_HOME/cordis.patch.yml`, branch by branch on the pure planner: create when absent, append leaving an operator-authored file byte-identical above the block, report `unchanged` rather than rewrite, replace only its own block on a version bump while the surrounding entries survive, and refuse — never clobber — on a foreign `llm-pi-ai` row (legal upstream, and the reason appending would silently delete one of two intents), a block edited since it was written, a block with no receipt, and an opening marker with no closing one. Then the install-level halves: the receipt records the block digest, a conflicting machine patch refuses **before any file lands**, and a rehearsal writes nothing while saying `would-create`. |
| `tests/profile-selection-readiness.test.mjs` | What the installer says about the profile this machine boots — a report since the route went machine-wide, not a gate. The retired refusal is fenced as retired: the exact selection document read off the operator's machine during runs 3 and 4 must now produce a *notice* that names the profile, names the state file, and says the route is machine-wide — never a refusal, because sending an operator to switch profiles would cost them the toolchain their own profile carries. The discipline that made the original failure invisible stays: absent, unreadable, and recorded remain three distinct outcomes (absence is `--default`'s whole permission, so nothing may impersonate it), `pending` outranks `active` in both directions (it names what the next start will try), and the report skips — never throws, never judges — for an install whose `--home` is not the launcher's home or on a platform that hides `userData`. |
| `tests/desktop-selection-drift.test.mjs` | The six values `--default` **mirrors** from `dsh-plugin-desktop/src`, each read back from that source and anchored to its declaration: the `PRODUCT_NAME` passed to `app.setName` — asserted in all three platform branches of the launcher's headless mirror (each branch's *whole* shape, since pinning only the trailing name would let the Linux `XDG_CONFIG_HOME` / `.config` base move unnoticed), against this installer's resolver output, and for the **ordering** that makes it load-bearing at all: `setName` must precede both `start()` and the first `getPath('userData')` inside `run()`, and `start()` must keep a single call site — the two `selectionStatePath` segments; `STATE_VERSION`; `DEFAULT_PROFILE_NAME`; and the `0o700`/`0o600` modes. Plus the claims the design rests on: that `selectDesktopProfile` still writes a first selection as a `pending` one — checked as a **closed key set** taken from that one object literal, in both directions, so a new field on either side fails rather than passing on four surviving matches — and that startup still rolls an unselectable `pending` back. Duplicated because the installer imports only node builtins and `yarn check` runs it *before* `dsh-plugin-desktop` is built; this fence is what makes the duplication safe, and the tripwire for the pending `app.setName` rebrand migration. |

Every drift fence except `desktop-selection-drift` reads the pinned upstream
checkout, so `git submodule update --init deepseek-harness` is a prerequisite —
the same one `yarn check:layout` already has. That one fence looks the other
way, at this repository's own `dsh-plugin-desktop/src`.

Every fence above reads source files. The one property none of them can state is
whether the route survives *composition*, which is precisely what issue #1 broke
while they all stayed green — so it is fenced next door, in
`dsh-plugin-desktop/tests/parametria-machine-route.spec.ts`: it runs this
installer into a temp home, composes both the `desktop` and `parametria`
profiles through `prepareDesktopProfile`, and asserts the route is declared for
both, absent exactly when the machine layer is, and beside an operator's own
machine-patch entries rather than instead of them. The boot-level evidence — the
real `boot()` and the live `llm` registry — is
`.engineering/research/no-adapter-repro.mjs`.

## Related issues

- **#1** — vision-aware subagent model routing. Its structural half lands here;
  the issue stays open pending a live provider datum, per the repository's
  LLM-provider-wire rule.
- **#7** — skill-root consolidation. Fills the preset-local `skills/` directory.
- **#5** — per-run cost and per-step timing. Reads the `sessionStats` and
  `tokenUsage` projections this profile's `dsh-web-app` bundle already mounts.
- **#9** — the PR #8 follow-ups. Item 2 landed in PR #10; item 3's mount half
  was observed live (its validator-route half moved to #1, which owns the
  pending-live datum); item 1 shipped in two halves — the sandbox half in
  PR #21 (section 4) and the evidence half here (section 5). What neither half
  could express became #23 and #24.
- **#23** — the structural evidence surface (section 5): the run directory is
  resolved, created and published by the host through `ctx.shellEnv`, derived in
  one module shared with the capture tool. **#24** — command-level execution
  policy, the half of item 1 no composition surface can grant; it landed as the
  `parametria_capture` tool (section 4).
