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

## The three things it guarantees

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

`maxDepth: 0` stops the validator delegating further — a child joins its
parent's preset, so it would otherwise reach the same delegation tools and
could spawn its own children back on the session model.

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

## What this deliberately does not ship

Issue #2 also names a *"permission preset, and any evidence/screenshot plumbing
the skill's playwright scripts need"*. Neither appears in the patch layer, and
that is a decision rather than an omission:

- **Permission preset** — `dsh-base` already composes `dsh-permission-presets`
  with `read-only` / `workspace-write` / `danger-full-access`, and
  `dsh-sandbox-policy` already defaults to `workspace-write` rooted at the
  session's working directory. There is no parametria-specific *configuration*
  to add: the preset roster and the sandbox mode are exactly what a Parametria
  run wants already, and restating them would only create a second place to
  keep in sync.
- **Command-level policy for node / uv / playwright** — allowing or denying
  specific commands is a `tools/pre-execute` interception, not a config field.
  It needs a desktop-owned plugin, which is Increment 3 of the harness research
  (`parametria-tools`), not profile composition.
- **Screenshot plumbing** — the skill drives Playwright through the shell
  today. Replacing that with a harness-managed screenshot tool with a readiness
  probe is the same Increment 3 follow-up.
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

The root `corepack yarn test` does **not** reach this workspace yet: that
script is pinned by exact string in `dsh-plugin-desktop/tests/package.spec.ts`,
which is outside this change's scope. Adding it there is a follow-up.

| Fence | What it holds |
|---|---|
| `tests/preset-drift.test.mjs` | Exhaustive **two-direction** diff against the pinned upstream `standard` preset. Rows added, dropped, or reconfigured must appear in a closed `DECLARED_DELTA` with a stated reason; shared rows must keep the same plugin name, `disabled` expression, group shape, and `isolate` realm. Also holds the validator row's pin and the empty skill root. |
| `tests/vision-route.test.mjs` | Every declared field of the `parametria-vision` model entry diffed against the **installed** pi-ai catalog entry — modalities, endpoint, protocol, capacities, reasoning dialect. A hand-declared route inherits nothing, so an unstated field silently falls back to the route guesses. |
| `tests/profile-patch.test.mjs` | The patch restates every field of each bundle row it replaces (an id-targeted patch has no deep merge), targets only rows the composed bundles provide, inserts nothing, and keeps the manifest web-capable and free of the launcher-owned desktop bundle. |
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
