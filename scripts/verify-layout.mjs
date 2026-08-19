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
for (const name of Object.keys(plugin.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))) {
  if (plugin.dependencies[name] !== upstream.runtimePackageVersion) {
    fail(`${name} must use the recorded DSH runtime package family`)
  }
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
