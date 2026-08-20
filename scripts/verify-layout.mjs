import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const fail = message => { throw new Error(`verify-layout: ${message}`) }

const workspace = readJson('package.json')
const upstream = readJson('upstream.json')
const plugin = readJson('dsh-plugin-desktop/package.json')
const fabric = readJson('dsh-community-fabric/package.json')
const market = readJson('dsh-community-market/package.json')
const preset = readJson('dsh-preset-parametria/package.json')
const upstreamPackage = readJson('deepseek-harness/package.json')
const noteDirectory = '.agents/notes/implemented/process'
const noteName = '2026-08-15-pinned-upstream-and-isolated-yarn-workspace'
const notePaths = [`${noteDirectory}/${noteName}.md`, `${noteDirectory}/${noteName}.zh.md`]
const noteRecordPath = `${noteDirectory}/${noteName}.i18n.yaml`

if (workspace.packageManager !== 'yarn@4.18.0') {
  fail('the product workspace must pin yarn@4.18.0')
}
// One list drives every workspace guard below — the root `workspaces` snapshot,
// package identity, Yarn-release inheritance, and the root chain guards. A
// fifth workspace added here is subject to all of them at once; added anywhere
// else, it fails the snapshot first. Order matches the root `workspaces` array.
const workspaces = [
  ['dsh-plugin-desktop', plugin],
  ['dsh-community-fabric', fabric],
  ['dsh-community-market', market],
  ['dsh-preset-parametria', preset],
]
// A root script is a `&&` chain of commands. Compare whole trimmed segments,
// never substrings: `includes('yarn workspace x test')` also matches
// `yarn workspace x test:e2e`, and matches mentions that never execute.
const chainRuns = (chain, command) => (workspace.scripts[chain] ?? '')
  .split('&&')
  .map(segment => segment.trim())
  .includes(command)

if (JSON.stringify(workspace.workspaces) !== JSON.stringify(workspaces.map(([name]) => name))) {
  fail(`the root Yarn workspace must contain exactly: ${workspaces.map(([name]) => name).join(', ')}`)
}
for (const [name, manifest] of workspaces) {
  if (manifest.name !== name) fail(`the ${name} workspace must own the ${name} package name`)
  if (manifest.packageManager !== undefined) fail(`${name} must inherit the root Yarn release`)
  // Every workspace's own gate must run under the root `check`, or a package
  // can be added to the tree and never validated by anything.
  if (!chainRuns('check', `yarn workspace ${name} check`)) {
    fail(`the root check script must run the ${name} gate`)
  }
  // The same, one level down: a workspace whose own gate runs under the root
  // `check` can still define unit tests that `corepack yarn test` never
  // reaches, which is how `dsh-preset-parametria` shipped 64 fences the
  // documented unit-test command silently skipped. Both root chains are also
  // pinned by exact string in `dsh-plugin-desktop/tests/package.spec.ts`, so a
  // workspace joins one only in a change that moves the pinned string with it
  // — these guards are what force that change to happen.
  for (const chain of ['test', 'typecheck']) {
    if (manifest.scripts?.[chain] === undefined) continue
    if (!chainRuns(chain, `yarn workspace ${name} ${chain}`)) {
      fail(`the root ${chain} script must run the ${name} ${chain}`)
    }
  }
}
const claudePath = resolve(root, 'CLAUDE.md')
const claudeStat = lstatSync(claudePath)
// Windows checkouts materialize the symlink as a regular file holding the
// target name; accept both forms so the pointer stays verified on every host.
const claudeTarget = claudeStat.isSymbolicLink()
  ? readlinkSync(claudePath)
  : readFileSync(claudePath, 'utf8').trim()
if (claudeTarget !== 'AGENTS.md') {
  fail('CLAUDE.md must link to the outer repository AGENTS.md')
}
for (const legacyFile of [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'dsh-plugin-desktop/pnpm-lock.yaml',
  'dsh-plugin-desktop/pnpm-workspace.yaml',
  'dsh-community-fabric/pnpm-lock.yaml',
  'dsh-community-fabric/pnpm-workspace.yaml',
  'dsh-community-market/pnpm-lock.yaml',
  'dsh-community-market/pnpm-workspace.yaml',
  'dsh-preset-parametria/pnpm-lock.yaml',
  // The preset package emits the profile's pnpm settings from its installer,
  // into `$DSH_HOME`; a copy in the workspace would mean the file drifted back
  // into the Yarn tree.
  'dsh-preset-parametria/pnpm-workspace.yaml',
]) {
  if (existsSync(resolve(root, legacyFile))) fail(`${legacyFile} must not exist`)
}
if (run('git', ['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.path']) !== 'deepseek-harness') {
  fail('the upstream submodule path must be deepseek-harness')
}
if (run('git', ['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.url']) !== upstream.repository) {
  fail('the upstream submodule URL differs from upstream.json')
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream checkout must retain its pnpm package manager')
}

// One manifest list, keyed by the path a failure message should name, drives both
// the boundary guard below and the pin surface further down — the same principle
// as the `workspaces` list above, which is why this is derived from it rather than
// spelled out a second time.
const manifests = [
  ['package.json', workspace],
  ...workspaces.map(([name, manifest]) => [`${name}/package.json`, manifest]),
]
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

for (const [owner, manifest] of manifests) {
  for (const field of [...dependencyFields, 'resolutions']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== 'string') continue
      if (/^(?:workspace|portal|link):/u.test(range)
        || (range.startsWith('file:') && range.includes('deepseek-harness'))) {
        fail(`${owner} ${field}.${name} bypasses the published DSH package boundary`)
      }
    }
  }
}

const [mode, object] = run('git', ['ls-files', '--stage', '--', 'deepseek-harness']).split(/\s+/u)
if (mode !== '160000') fail('deepseek-harness must be tracked as a Git submodule')
if (object !== upstream.commit) fail(`submodule index is ${object}, expected ${upstream.commit}`)

const upstreamDir = resolve(root, 'deepseek-harness')
if (run('git', ['rev-parse', 'HEAD'], upstreamDir) !== upstream.commit) {
  fail('checked-out upstream commit differs from upstream.json')
}
if (run('git', ['status', '--porcelain'], upstreamDir) !== '') {
  fail('deepseek-harness contains local changes')
}
if (run('git', ['remote', 'get-url', 'origin'], upstreamDir) !== upstream.repository) {
  fail('deepseek-harness origin differs from upstream.json')
}
if (upstreamPackage.version !== upstream.sourceVersion) {
  fail('deepseek-harness package version differs from upstream.json')
}
// ------------------------------------------------------- the upstream pin surface
//
// Everything a pin bump has to move in one commit, guarded here so a half-done
// bump cannot pass the gate. Until #12 this covered `dsh-plugin-desktop`'s
// `dependencies` alone, while `dsh-community-market` carried 61 more entries at
// the same version across dev+peer and the root carried 9 `resolutions`
// selectors — none of them guarded by anything.
//
// IDENTITY selects what is guarded, never the version. `scripts/upstream-watch.mjs`
// enumerates the same surface by "range equals the current pin" because it builds
// a forward worklist; a FENCE written that way would skip precisely the entries a
// half-done bump left behind on the OLD version, which is the vacuous pass this
// guard exists to stop. `@deepseek-ai/cordis*` and `@deepseek-ai/schemastery`
// share the npm scope but not the release train, so the test is a segment-exact
// `@deepseek-ai/dsh` or a `@deepseek-ai/dsh-` prefix, never the scope.
const isUpstreamPackage = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
const pinned = []
for (const [path, manifest] of manifests) {
  for (const field of dependencyFields) {
    const entries = Object.entries(manifest[field] ?? {}).filter(([name]) => isUpstreamPackage(name))
    if (entries.length > 0) pinned.push({ path, field, entries })
  }
}
// The second direction. "Every entry matches the pin" is vacuously true of a
// field that lost its entries, a workspace that stopped depending on the family,
// or a manifest deleted outright — so the surface itself is snapshotted, exactly
// as the `workspaces` list above is. An entry appearing, an entry disappearing,
// an entry SWAPPED for another at the same count, or a whole manifest/field
// joining or leaving fails here, before the version assertion gets the chance to
// pass over nothing.
//
// Names, not counts. A count misses an equal-size add+remove inside one field —
// an upstream package renamed within a release reads as no change at all, while
// the incoming entry sails through the version check on its way in. Names are
// version-INDEPENDENT, so this list survives a pin bump untouched and moves only
// when upstream's package SET moves, which is exactly the event worth reviewing.
//
// This is the enforced copy of the dependency half of the bump surface described
// in `.engineering/upstream-watch.md` (trial pin bump, step 3), which is the
// authoritative statement of what that surface holds; the `resolutions` half is
// `patchedPackages` below.
const pinSurface = [
  ['dsh-plugin-desktop/package.json', 'dependencies', [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-default-model',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-anonymous-user-id',
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-atomic-write',
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-bash-local',
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-modules',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-attachment',
    '@deepseek-ai/dsh-client-ui-commands',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    '@deepseek-ai/dsh-client-ui-directory-picker-native',
    '@deepseek-ai/dsh-client-ui-input-trigger',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-client-ui-tool',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-cmdline',
    '@deepseek-ai/dsh-code-runtime',
    '@deepseek-ai/dsh-command-feedback',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-compaction',
    '@deepseek-ai/dsh-cordis-client-runner',
    '@deepseek-ai/dsh-cordis-host-runner',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-file-reference',
    '@deepseek-ai/dsh-fs',
    '@deepseek-ai/dsh-fs-local',
    '@deepseek-ai/dsh-goal',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-host-apiproxy',
    '@deepseek-ai/dsh-host-directory-picker-browse',
    '@deepseek-ai/dsh-host-directory-picker-native',
    '@deepseek-ai/dsh-host-plugin-inventory',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-jobs',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-llm-retry',
    '@deepseek-ai/dsh-message-feedback',
    '@deepseek-ai/dsh-output-retention',
    '@deepseek-ai/dsh-permission-presets',
    '@deepseek-ai/dsh-plan-mode',
    '@deepseek-ai/dsh-pwsh-local',
    '@deepseek-ai/dsh-pwsh-sandbox',
    '@deepseek-ai/dsh-sandbox',
    '@deepseek-ai/dsh-sandbox-policy',
    '@deepseek-ai/dsh-sandbox-windows-acl',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-persistence',
    '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-session-query',
    '@deepseek-ai/dsh-session-reference',
    '@deepseek-ai/dsh-session-stats',
    '@deepseek-ai/dsh-session-telemetry',
    '@deepseek-ai/dsh-session-title',
    '@deepseek-ai/dsh-session-title-llm',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-settings-file',
    '@deepseek-ai/dsh-shell',
    '@deepseek-ai/dsh-shell-env',
    '@deepseek-ai/dsh-skill',
    '@deepseek-ai/dsh-spill',
    '@deepseek-ai/dsh-storage',
    '@deepseek-ai/dsh-storage-domain',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subagent-in-process-driver',
    '@deepseek-ai/dsh-subprocess',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-terminal',
    '@deepseek-ai/dsh-timeout',
    '@deepseek-ai/dsh-token-meter',
    '@deepseek-ai/dsh-tool-todo',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-user-approval',
    '@deepseek-ai/dsh-user-questions',
    '@deepseek-ai/dsh-web',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-workflow',
  ]],
  // Test-only pins. These three are NOT product dependencies: they exist so
  // `tests/subagent-error-surface.spec.ts` can mount the real host services a
  // delegating parent needs (issue #40) instead of doubling them. They still
  // move with the pin, so they belong on the recorded surface.
  ['dsh-plugin-desktop/package.json', 'devDependencies', [
    '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-subagent-spawn-in-process',
    '@deepseek-ai/dsh-tool-subagent',
  ]],
  ['dsh-community-market/package.json', 'devDependencies', [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-atomic-write',
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-cordis-host-runner',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-file-reference',
    '@deepseek-ai/dsh-goal',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-host-apiproxy',
    '@deepseek-ai/dsh-host-plugin-inventory',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-llm-retry',
    '@deepseek-ai/dsh-message-feedback',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-persistence',
    '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-session-reference',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-settings-file',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-typert-registry',
  ]],
  ['dsh-community-market/package.json', 'peerDependencies', [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-cordis-host-runner',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-goal',
    '@deepseek-ai/dsh-host-plugin-inventory',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-message-feedback',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-persistence',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-typert-registry',
  ]],
]
const observedSurface = pinned.map(({ path, field, entries }) => [path, field, entries.map(([name]) => name).sort()])
// Keyed and diffed rather than positional and dumped: a 157-name stringify
// mismatch is unreadable at the moment someone has to act on it, so a failure
// names the manifest, the field, and the exact packages that moved.
const surfaceKey = ([path, field]) => `${path} ${field}`
const recordedRows = new Map(pinSurface.map(row => [surfaceKey(row), row[2]]))
const observedRows = new Map(observedSurface.map(row => [surfaceKey(row), row[2]]))
for (const key of observedRows.keys()) {
  if (!recordedRows.has(key)) fail(`${key} carries pinned DSH packages that pinSurface does not record at all`)
}
for (const [key, recorded] of recordedRows) {
  const observed = observedRows.get(key)
  if (observed === undefined) {
    fail(`${key} no longer carries any pinned DSH package, but pinSurface records ${recorded.length}`)
  }
  const unrecorded = observed.filter(name => !recorded.includes(name))
  const missing = recorded.filter(name => !observed.includes(name))
  if (unrecorded.length > 0 || missing.length > 0) {
    fail(`${key} does not match pinSurface — in the tree but not recorded: ${unrecorded.join(', ') || '(none)'}; recorded but not in the tree: ${missing.join(', ') || '(none)'}`)
  }
}

for (const { path, field, entries } of pinned) {
  for (const [name, range] of entries) {
    if (range !== upstream.runtimePackageVersion) {
      fail(`${path} ${field}.${name} is ${range}, not the recorded DSH runtime package version ${upstream.runtimePackageVersion}`)
    }
  }
}

// The `resolutions` half of the surface. A selector and the patch it points at
// are ONE unit that moves together (`handoffs/resolver-charter.md`, ENVIRONMENT):
// the selector's range, the `patch:` locator's version, and the patch FILENAME
// all name the pinned release. Half-updating them is silent — Yarn is content to
// apply a patch through a selector no installed tree ever matches.
//
// Yarn honours `resolutions` in the ROOT manifest only, so a block in a workspace
// package is a silent no-op — and it would also sit outside this guard while still
// being counted by the watch script's bump surface, which enumerates `resolutions`
// in every manifest. Refusing it keeps the two enumerations over the same set.
for (const [path, manifest] of manifests) {
  if (path !== 'package.json' && manifest.resolutions !== undefined) {
    fail(`${path} declares resolutions; Yarn honours them in the root manifest only`)
  }
}
const selectorPattern = /^(?<name>.+)@npm:(?<range>.+)$/u
const targetPattern = /^patch:(?<name>.+)@npm%3A(?<locator>[^#]+)#\.\/patches\/(?<file>[^#]+)$/u
// The version segment of `<stem>@<version>.patch`, parsed rather than suffix-tested,
// so the assertion is anchored to the filename's structure the way the root-script
// chain guards above compare whole segments instead of substrings.
const patchFilePattern = /^(?<stem>.+)@(?<version>[^@]+)\.patch$/u
const patchedShapes = new Map()
for (const [selector, target] of Object.entries(workspace.resolutions ?? {})) {
  // Selectors are matched leniently on purpose: `resolutions` legitimately holds
  // plain `"<package>": "<range>"` keys (and non-DSH ones like `koffi`), which are
  // no business of this guard. An unparsed key is treated as a bare package name so
  // that a DSH package written in a form we do not understand still fails here
  // rather than slipping through the filter unguarded.
  const selected = selectorPattern.exec(selector)?.groups ?? { name: selector, range: null }
  if (!isUpstreamPackage(selected.name)) continue
  if (selected.range === null) {
    fail(`root resolutions selector ${selector} must name the package as <package>@npm:<range>`)
  }
  const shape = selected.range === upstream.runtimePackageVersion
    ? 'exact'
    : selected.range === `^${upstream.runtimePackageVersion}` ? 'caret' : null
  // Both of the next two failures are also how a HOLD-BACK presents: option 3 of
  // the eval decision tree (`.engineering/upstream-watch.md`) inherits a release
  // but pins one package back through `resolutions`, which lands here either as a
  // selector naming the old version or as a target that is not one of our patches.
  // Failing is deliberate. A hold-back is a durable claim, and standard 9 requires
  // durable claims to carry a retirement condition; tripping the gate makes one an
  // explicit reviewed change rather than a manifest line nobody revisits. Where a
  // hold-back gets DECLARED so this guard can admit it is an RM ruling, raised on
  // #12 — until it lands, the conservative answer is the safe one either way.
  if (shape === null) {
    fail(`root resolutions selector ${selector} does not pin the recorded DSH runtime package version ${upstream.runtimePackageVersion} (an undeclared hold-back looks like this)`)
  }
  const patched = targetPattern.exec(target)?.groups
  if (patched === undefined) {
    fail(`root resolutions["${selector}"] overrides a pinned DSH package with something other than a ./patches target — an undeclared hold-back`)
  }
  if (patched.name !== selected.name) {
    fail(`root resolutions["${selector}"] patches ${patched.name}, a different package`)
  }
  if (patched.locator !== upstream.runtimePackageVersion) {
    fail(`root resolutions["${selector}"] patches version ${patched.locator}, not the pinned ${upstream.runtimePackageVersion}`)
  }
  const patchFile = patchFilePattern.exec(patched.file)?.groups
  if (patchFile === undefined) {
    fail(`patches/${patched.file} is not named <package>@<version>.patch`)
  }
  if (patchFile.version !== upstream.runtimePackageVersion) {
    fail(`patches/${patched.file} is named for version ${patchFile.version}, not the pinned ${upstream.runtimePackageVersion}`)
  }
  if (!existsSync(resolve(root, 'patches', patched.file))) {
    fail(`root resolutions["${selector}"] points at patches/${patched.file}, which does not exist`)
  }
  patchedShapes.set(selected.name, [...(patchedShapes.get(selected.name) ?? []), shape].sort())
}
// Version-independent, so it survives a pin bump untouched and fences the hazard
// the pin-bump checklist calls out by name: some packages carry both an exact and
// a caret selector, some only one, and a half-updated selector set leaves part of
// the installed tree unpatched without `yarn install` complaining. Snapshotting
// the SHAPES makes a dropped or added selector a named failure in both directions.
const patchedPackages = [
  ['@deepseek-ai/dsh-app-boot', ['caret', 'exact']],
  ['@deepseek-ai/dsh-client-ui-directory-picker-browse', ['caret', 'exact']],
  ['@deepseek-ai/dsh-client-ui-workspace', ['caret', 'exact']],
  ['@deepseek-ai/dsh-llm-deepseek', ['caret']],
  ['@deepseek-ai/dsh-sandbox-windows-acl', ['caret', 'exact']],
  ['@deepseek-ai/dsh-subagent', ['caret', 'exact']],
  ['@deepseek-ai/dsh-subagent-in-process-driver', ['caret', 'exact']],
]
const observedPatched = [...patchedShapes].sort(([left], [right]) => left.localeCompare(right))
if (JSON.stringify(observedPatched) !== JSON.stringify(patchedPackages)) {
  fail(`the patched-package selector set moved: expected ${JSON.stringify(patchedPackages)}, found ${JSON.stringify(observedPatched)}`)
}

const noteRecord = readFileSync(resolve(root, noteRecordPath), 'utf8')
for (const notePath of notePaths) {
  // Hash the committed blob, not the working tree: checkout line endings
  // differ per host, while HEAD:<path> is identical everywhere.
  const expected = run('git', ['rev-parse', `HEAD:${notePath}`])
  const recordLine = `${basename(notePath)}: ${expected}`
  if (!noteRecord.split(/\r?\n/u).includes(recordLine)) {
    fail(`${noteRecordPath} is stale for ${notePath}`)
  }
}

const readmeRecord = readFileSync(resolve(root, 'README.i18n.yaml'), 'utf8')
for (const readmeName of ['README.md', 'README.en.md']) {
  const expected = run('git', ['rev-parse', `HEAD:${readmeName}`])
  const recordLine = `${readmeName}: ${expected}`
  if (!readmeRecord.split(/\r?\n/u).includes(recordLine)) {
    fail(`README.i18n.yaml is stale for ${readmeName}`)
  }
}

process.stdout.write(`verify-layout: Yarn workspace and upstream ${upstream.commit.slice(0, 10)} are consistent\n`)
