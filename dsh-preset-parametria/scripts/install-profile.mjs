#!/usr/bin/env node
/**
 * Install the Parametria work profile into a DSH Harness home.
 *
 * Two directories are written, both discovered by upstream defaults so nothing
 * in the deployment's read-only shipped install is touched:
 *
 *   $DSH_HOME/.agent-presets/parametria/   the agent preset (roots scan this
 *                                          because `includeUserRoot` is true)
 *   $DSH_HOME/profiles/parametria/         the desktop profile: bundle
 *                                          manifest, patch layer, pnpm settings
 *
 * Every managed file is recorded in a receipt with its SHA-256. A later run
 * overwrites a file only while it still matches what this installer last
 * wrote; a file the operator has since edited stops the run by name. `--force`
 * is that claim's release — it overwrites regardless and re-records.
 *
 * Usage:
 *   node scripts/install-profile.mjs [--home <dir>] [--force] [--dry-run]
 *
 * Exits non-zero on any refusal, so a caller cannot mistake a skipped write
 * for a completed install.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = 'install-profile'
const PRESET_NAME = 'parametria'
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RECEIPT_NAME = '.dsh-preset-parametria.install.json'
const RECEIPT_VERSION = 1

/** The pnpm settings `initProfile` writes, restated so a hand-built profile matches a `dsh plugin` one. */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

class InstallError extends Error {}

/**
 * Resolve the Harness home the same way upstream `resolveDshHome` does.
 * @param override - an explicit `--home` value, when given.
 * @returns the absolute Harness home directory.
 */
export function resolveHome(override) {
  if (override !== undefined) return resolve(override)
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv !== '' ? resolve(fromEnv) : join(homedir(), '.dsh')
}

/**
 * Every file this package installs, as posix-style destination paths relative
 * to the Harness home paired with the bytes to write there.
 * @param packageRoot - the `dsh-preset-parametria` directory.
 * @returns the managed file map, destination path to contents.
 */
export function managedFiles(packageRoot = PACKAGE_ROOT) {
  const files = new Map()
  const presetSource = join(packageRoot, 'preset')
  for (const relativePath of walk(presetSource)) {
    files.set(
      posix.join('.agent-presets', PRESET_NAME, toPosix(relativePath)),
      readFileSync(join(presetSource, relativePath)),
    )
  }
  const profileSource = join(packageRoot, 'profile')
  for (const name of ['package.json', 'cordis.patch.yml']) {
    files.set(posix.join('profiles', PRESET_NAME, name), readFileSync(join(profileSource, name)))
  }
  files.set(posix.join('profiles', PRESET_NAME, 'pnpm-workspace.yaml'), Buffer.from(PROFILE_PNPM_WORKSPACE))
  return files
}

/** Depth-first list of every file under `dir`, as paths relative to it. */
function walk(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const relativePath = entry.name
    if (entry.isDirectory()) {
      found.push(...walk(join(dir, relativePath)).map(child => join(relativePath, child)))
    } else if (entry.isFile()) {
      found.push(relativePath)
    }
  }
  return found
}

const toPosix = value => value.split(sep).join(posix.sep)
const digest = contents => createHash('sha256').update(contents).digest('hex')

/**
 * Read the receipt this installer last wrote, or an empty one.
 *
 * An unreadable receipt is fatal WITHOUT `--force`, because the claim it
 * records is the only thing separating a stale install from an operator's
 * edit: continuing would silently reclassify every managed file as
 * operator-owned and refuse a legitimate upgrade with a misleading message.
 * `--force` overwrites regardless of the receipt, so under it the unreadable
 * document is genuinely irrelevant and the run proceeds — which is what makes
 * the "pass --force" half of the diagnostic a true statement.
 * @param path - the receipt file.
 * @param force - whether the caller has already elected to overwrite.
 */
function readReceipt(path, force) {
  const empty = { version: RECEIPT_VERSION, files: {} }
  if (!existsSync(path)) return empty
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    if (force) return empty
    throw new InstallError(`${BIN}: receipt ${path} is unreadable; move it aside or pass --force (${String(cause)})`)
  }
  // A receipt version this build does not know cannot be reasoned about: its
  // hashes may mean something else entirely. Treating every file as
  // operator-owned is the conservative reading — a real edit is never
  // overwritten, and an upgrade past this point needs the explicit --force.
  if (parsed?.version !== RECEIPT_VERSION || typeof parsed.files !== 'object' || parsed.files === null) {
    return empty
  }
  return parsed
}

/**
 * Decide what happens to one managed file.
 * @returns `'write'`, `'unchanged'`, or `'conflict'`.
 */
export function planFile(destinationPath, contents, recordedHash, force) {
  if (!existsSync(destinationPath)) return 'write'
  const onDisk = readFileSync(destinationPath)
  const onDiskHash = digest(onDisk)
  if (onDiskHash === digest(contents)) return 'unchanged'
  if (force) return 'write'
  // Absent from the receipt means this installer never wrote it: a
  // pre-existing profile or preset the operator arranged by hand.
  return recordedHash === onDiskHash ? 'write' : 'conflict'
}

/**
 * Install into `home`.
 * @returns a summary of what was written, kept, and skipped.
 */
export function install({ home, force = false, dryRun = false, packageRoot = PACKAGE_ROOT } = {}) {
  const files = managedFiles(packageRoot)
  const receiptPath = join(home, 'profiles', PRESET_NAME, RECEIPT_NAME)
  const receipt = readReceipt(receiptPath, force)
  const plan = new Map()
  const conflicts = []
  for (const [relativePath, contents] of files) {
    const destinationPath = join(home, ...relativePath.split(posix.sep))
    const action = planFile(destinationPath, contents, receipt.files[relativePath], force)
    if (action === 'conflict') conflicts.push(relativePath)
    plan.set(relativePath, { destinationPath, contents, action })
  }
  if (conflicts.length > 0) {
    throw new InstallError(
      `${BIN}: refusing to overwrite locally modified file(s):\n`
      + conflicts.map(name => `  ${join(home, ...name.split(posix.sep))}`).join('\n')
      + '\nRe-run with --force to replace them.',
    )
  }
  const written = []
  const unchanged = []
  for (const [relativePath, { destinationPath, contents, action }] of plan) {
    if (action === 'unchanged') {
      unchanged.push(relativePath)
      continue
    }
    written.push(relativePath)
    if (dryRun) continue
    mkdirSync(dirname(destinationPath), { recursive: true })
    writeFileSync(destinationPath, contents)
  }
  const nextReceipt = {
    version: RECEIPT_VERSION,
    preset: PRESET_NAME,
    files: Object.fromEntries([...files].map(([name, contents]) => [name, digest(contents)])),
  }
  if (!dryRun) {
    mkdirSync(dirname(receiptPath), { recursive: true })
    writeFileSync(receiptPath, JSON.stringify(nextReceipt, undefined, 2) + '\n')
  }
  return { home, written, unchanged, receiptPath }
}

/** Parse argv into install options; throws on an unknown or incomplete flag. */
export function parseArgs(argv) {
  const options = { force: false, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--force') options.force = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--home') {
      const value = argv[index += 1]
      if (value === undefined) throw new InstallError(`${BIN}: --home needs a directory`)
      options.homeOverride = value
    } else throw new InstallError(`${BIN}: unknown argument ${JSON.stringify(argument)}`)
  }
  return options
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const { homeOverride, ...options } = parseArgs(process.argv.slice(2))
    const home = resolveHome(homeOverride)
    const result = install({ ...options, home })
    const verb = options.dryRun ? 'would write' : 'wrote'
    const marker = options.dryRun ? '~' : '+'
    process.stdout.write(
      `${BIN}: ${verb} ${result.written.length} file(s), ${result.unchanged.length} already current, under ${home}\n`
      + result.written.map(name => `  ${marker} ${name}\n`).join('')
      + `${BIN}: select it with the desktop profile picker, or 'dsh --profile ${PRESET_NAME}'\n`,
    )
  } catch (error) {
    process.stderr.write(`${error instanceof InstallError ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export { InstallError, PRESET_NAME, RECEIPT_NAME, PROFILE_PNPM_WORKSPACE }
