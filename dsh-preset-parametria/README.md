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
```

Both land in directories upstream already scans — `includeUserRoot` makes
`$DSH_HOME/.agent-presets` a preset root, and `profiles/` is where
`resolveProfileDir` looks — so the deployment's read-only shipped install is
never touched.

```sh
yarn workspace dsh-preset-parametria install:profile            # install
yarn workspace dsh-preset-parametria install:profile --dry-run  # show the writes
yarn workspace dsh-preset-parametria install:profile --force    # overwrite local edits
```

Then pick **Parametria** in the desktop profile picker (selecting a profile
restarts the app), or run `dsh --profile parametria`.

## The four things it guarantees

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
distinctly named tool", which is exactly what this row is. The profile declares
a `parametria-vision` pi-ai route whose model entry states
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
policy answer, and the third has no answer at all short of a wider mode:

| Refusal | Why | What this profile does |
|---|---|---|
| uv cache at `%LOCALAPPDATA%\uv\cache` | outside the session workspace | persona sets `$env:UV_CACHE_DIR = "$PWD\.uv-cache"` before `uv run` — the live run proved a workspace-local cache works unescalated |
| uv cache at `C:\tmp\uv-cache` | an arbitrary absolute path is outside both granted roots. Temp *is* writable under `workspace-write` — but only the private per-session directory the runner creates and rewrites `TMP`/`TEMP` to, never an ambient path that merely looks temporary | same |
| `screenshot-definition.py` (Playwright) | **inference from the live trace, over a documented mechanism.** The win32 ACL backend documents that a confined process's `stdio: 'pipe'` children fail — named pipes carry a default SD that denies the client-end write — while `inherit`/`ignore` spawns work, so *"tools that must capture output cannot run confined"*. That Playwright's sync driver spawn is the piped shape is not stated upstream; it is what the live traceback shows (`asyncio/windows_utils.py`, `PermissionError(13)`), plus every post-escalation call succeeding | persona instructs the **per-call** `sandbox_permissions: danger-full-access` retry, once per capture |

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

**A cost worth naming:** `$PWD\.uv-cache` is real litter in whatever workspace
the run happens in — typically a user repository, which this package does not
gitignore for them.

## What this deliberately does not ship

The originating issue also names *"any evidence/screenshot plumbing the skill's
playwright scripts need"*, which does not appear in the patch layer — a decision
rather than an omission. **Issue #9 is the tracking surface** for what is
genuinely deferred:

- **Command-level policy for node / uv / playwright** — allowing or denying
  *specific commands* is a `tools/pre-execute` interception, not a config field,
  and auto-answering an escalation would mean a second `approval/request`
  answerer beside the desktop's own (upstream: compose one terminal answerer per
  deployment). Both need a desktop-owned plugin — Increment 3 of the harness
  research (`parametria-tools`), not profile composition. Issue #9, item 1.
- **Screenshot plumbing** — the skill drives Playwright through the shell today
  and writes the PNG to a workspace-relative path of its own choosing. Where run
  evidence *lands* is a different mechanism from what the run is *allowed to
  do*; it is not composition, so it is not in this package. Issue #9, item 1.
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
| `tests/install-profile.test.mjs` | The installed file set, idempotent re-install, refusal on a locally modified file, and `--force` as that claim's release. |

Every drift fence reads the pinned upstream checkout, so
`git submodule update --init deepseek-harness` is a prerequisite — the same one
`yarn check:layout` already has.

## Related issues

- **#1** — vision-aware subagent model routing. Its structural half lands here;
  the issue stays open pending a live provider datum, per the repository's
  LLM-provider-wire rule.
- **#7** — skill-root consolidation. Fills the preset-local `skills/` directory.
- **#5** — per-run cost and per-step timing. Reads the `sessionStats` and
  `tokenUsage` projections this profile's `dsh-web-app` bundle already mounts.
