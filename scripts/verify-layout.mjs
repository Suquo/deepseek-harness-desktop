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

for (const [owner, manifest] of [
  ['root', workspace],
  ['desktop', plugin],
  ['fabric', fabric],
  ['market', market],
  ['preset', preset],
]) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'resolutions']) {
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
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const pinned = []
for (const [path, manifest] of [
  ['package.json', workspace],
  ...workspaces.map(([name, manifest]) => [`${name}/package.json`, manifest]),
]) {
  for (const field of dependencyFields) {
    const entries = Object.entries(manifest[field] ?? {}).filter(([name]) => isUpstreamPackage(name))
    if (entries.length > 0) pinned.push({ path, field, entries })
  }
}
// The second direction. "Every entry matches the pin" is vacuously true of a
// field that lost its entries, a workspace that stopped depending on the family,
// or a manifest deleted outright — so the surface itself is snapshotted, exactly
// as the `workspaces` list above is. An entry appearing, an entry disappearing,
// or a whole manifest/field joining or leaving fails here before the version
// assertion gets the chance to pass over nothing. Counts rather than names: the
// 157 names would be a second copy of two manifests, churned by every release.
// The gap that leaves is one addition plus one removal of equal size, in the same
// field, in the same commit — which moves package identity rather than the pin,
// and whose surviving entries the version assertion below still holds to the pin.
// These three numbers are the ones `.engineering/upstream-watch.md` quotes as the
// bump-surface worklist (96 + 61 + 9 = 166); this is the enforced copy.
const pinSurface = [
  ['dsh-plugin-desktop/package.json', 'dependencies', 96],
  ['dsh-community-market/package.json', 'devDependencies', 32],
  ['dsh-community-market/package.json', 'peerDependencies', 29],
]
const observedSurface = pinned.map(({ path, field, entries }) => [path, field, entries.length])
if (JSON.stringify(observedSurface) !== JSON.stringify(pinSurface)) {
  fail(`the upstream pin surface moved: expected ${JSON.stringify(pinSurface)}, found ${JSON.stringify(observedSurface)}`)
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
const selectorPattern = /^(?<name>.+)@npm:(?<range>.+)$/u
const targetPattern = /^patch:(?<name>.+)@npm%3A(?<locator>[^#]+)#\.\/patches\/(?<file>[^#]+)$/u
const patchedShapes = new Map()
for (const [selector, target] of Object.entries(workspace.resolutions ?? {})) {
  const selected = selectorPattern.exec(selector)?.groups
  if (selected === undefined) fail(`root resolutions selector ${selector} is not a <package>@npm:<range> selector`)
  if (!isUpstreamPackage(selected.name)) continue
  const shape = selected.range === upstream.runtimePackageVersion
    ? 'exact'
    : selected.range === `^${upstream.runtimePackageVersion}` ? 'caret' : null
  if (shape === null) {
    fail(`root resolutions selector ${selector} does not pin the recorded DSH runtime package version ${upstream.runtimePackageVersion}`)
  }
  const patched = targetPattern.exec(target)?.groups
  if (patched === undefined) fail(`root resolutions["${selector}"] must resolve to a patch under ./patches`)
  if (patched.name !== selected.name) {
    fail(`root resolutions["${selector}"] patches ${patched.name}, a different package`)
  }
  if (patched.locator !== upstream.runtimePackageVersion) {
    fail(`root resolutions["${selector}"] patches version ${patched.locator}, not the pinned ${upstream.runtimePackageVersion}`)
  }
  if (!patched.file.endsWith(`@${upstream.runtimePackageVersion}.patch`)) {
    fail(`patches/${patched.file} is not named for the pinned version ${upstream.runtimePackageVersion}`)
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
