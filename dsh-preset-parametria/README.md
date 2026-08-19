# dsh-preset-parametria

The **Parametria work profile**: a composed, reproducible run environment for
`/suquo-systems-parametria` sessions on DeepSeek Harness Desktop.

A Parametria run used to depend on hand-arranged session state — which skill
copy happened to load, which model the session happened to be on, whether the
person remembered that a validator subagent inherits that model. This package
turns that arrangement into two directories that install, verify, and travel.

Per [ADR H-0001](../.engineering/adrs/README.md) it is composition only: an
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

### 1. A validator that cannot go blind

Validator subagents inherit the session model. On a text-only model every image
read fails while the screenshot capture succeeds, so the validator's report
reads as a clean pass. **That failure mode looks like success**, which is why
it is worth structure rather than a procedure.

The preset carries a second `dsh-tool-subagent` instance, `subagent_validator`,
whose `agentOptions` pin the route and model explicitly — explicit values
override what a child would inherit. Child model policy is fixed per instance
and per-call model selection does not exist, so "another model" means "another
distinctly named tool", which is exactly what this row is.

The pin is only half of it. The profile declares a `parametria-vision` pi-ai
route whose model entry states `input: [text, image]`. The harness refuses an
image *before* it is attached when a model's modalities omit one, naming the
model — so a misconfiguration becomes a loud refusal instead of a silent pass.
`dsh-llm-deepseek` has no modality configuration at all; this is why the vision
route is a pi-ai route.

The route is hand-declared and separate from the operator's own `openrouter`
route on purpose: that route is the session-model route, live in
`settings.yaml` and rewritten by the web Models page. A validator whose vision
guarantee rode it would inherit every edit made to it.

`maxDepth: 0` stops the validator delegating further — a child joins its
parent's preset, so it would otherwise reach the same delegation tools and
could spawn its own children back on the session model.

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

## Fences

`yarn workspace dsh-preset-parametria check` runs `node --test tests/`. There
is no build step and no runtime dependency; the package is configuration plus
one installer.

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
