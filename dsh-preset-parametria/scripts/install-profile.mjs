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
 * `--default` additionally makes this profile the one a fresh machine boots
 * into, by seeding the desktop launcher's selection state. That state lives
 * OUTSIDE `$DSH_HOME`, in Electron `userData`, and is shared with the running
 * application — see `planDefaultSelection` for the whole contract, which is
 * "write it only when nobody has ever chosen".
 *
 * Usage:
 *   node scripts/install-profile.mjs [--home <dir>] [--force] [--dry-run]
 *                                    [--default [--user-data-dir <dir>]]
 *
 * Exits non-zero on any refusal, so a caller cannot mistake a skipped write
 * for a completed install.
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = 'install-profile'
const PRESET_NAME = 'parametria'
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RECEIPT_NAME = '.dsh-preset-parametria.install.json'
const RECEIPT_VERSION = 1

/**
 * The Electron application name, which is what names the `userData` directory.
 *
 * This is a MIRROR of `PRODUCT_NAME` in `dsh-plugin-desktop/src/main.ts`, the
 * string passed to `app.setName()` before the first `app.getPath('userData')`
 * read. It is deliberately NOT the displayed brand ("Parametria"): the on-disk
 * identity is separate on purpose, and renaming it is a user-data migration
 * rather than a rebrand — `dsh-plugin-desktop/src/index.ts` says so at the
 * `productName` it sets.
 *
 * Duplicated rather than imported because this script imports only node
 * builtins and runs before `dsh-plugin-desktop` is built (`yarn check` orders
 * the preset ahead of it), so there is nothing to import from. The duplication
 * is held by `tests/desktop-selection-drift.test.mjs`, which fails if this
 * string, `main.ts`, and `bin.ts` stop agreeing.
 *
 * The packaged app's electron-builder `productName` is a DIFFERENT string and
 * is deliberately not mirrored here: `app.setName(PRODUCT_NAME)` runs before
 * the first `getPath('userData')` read, so `main.ts` names this directory in
 * packaged builds too. The drift fence asserts that ordering, which is what
 * makes the builder name irrelevant to us.
 */
const DESKTOP_PRODUCT_NAME = 'DSH Desktop'
/** Selection-state location under `userData`, mirroring `main.ts`'s `selectionStatePath`. */
const SELECTION_STATE_SEGMENTS = ['profile-selection', 'state.json']
/** `STATE_VERSION` in `dsh-plugin-desktop/src/profile-manager.ts`. */
const SELECTION_STATE_VERSION = 1
/** `DEFAULT_PROFILE_NAME` in `dsh-plugin-desktop/src/profile-manager.ts`. */
const DESKTOP_PROFILE_NAME = 'desktop'
/** `STATE_DIRECTORY_MODE` / `STATE_FILE_MODE` the launcher enforces on this state. */
const SELECTION_DIRECTORY_MODE = 0o700
const SELECTION_FILE_MODE = 0o600

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
 * Resolve Electron's `userData` directory the way the desktop launcher does.
 *
 * A mirror of `defaultDesktopUserDataDirectory` in
 * `dsh-plugin-desktop/src/bin.ts`, which is itself the headless mirror of what
 * Electron derives from `app.setName(PRODUCT_NAME)`. Held by the drift fence.
 * @param platform - the platform to resolve for.
 * @param environment - the environment supplying `APPDATA` / `XDG_CONFIG_HOME`.
 * @param homeDirectory - the user home, used on macOS and Linux.
 * @returns the absolute `userData` directory.
 */
export function defaultDesktopUserDataDirectory(
  platform = process.platform,
  environment = process.env,
  homeDirectory = homedir(),
) {
  const path = platform === 'win32' ? win32 : posix
  if (platform === 'win32') {
    const appData = environment.APPDATA
    if (appData === undefined || appData.length === 0) {
      throw new InstallError(`${BIN}: APPDATA is unavailable; pass --user-data-dir to locate ${DESKTOP_PRODUCT_NAME}`)
    }
    return path.join(appData, DESKTOP_PRODUCT_NAME)
  }
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', DESKTOP_PRODUCT_NAME)
  }
  const config = environment.XDG_CONFIG_HOME
  const base = config === undefined || config.length === 0 ? path.join(homeDirectory, '.config') : config
  return path.join(base, DESKTOP_PRODUCT_NAME)
}

/**
 * The desktop launcher's profile-selection state file.
 * @param userDataDir - the Electron `userData` directory.
 * @returns the absolute state-file path.
 */
export function selectionStatePath(userDataDir) {
  return join(userDataDir, ...SELECTION_STATE_SEGMENTS)
}

/**
 * The selection document that makes this profile the next boot's choice.
 *
 * This is byte-for-byte what the desktop picker's `selectDesktopProfile`
 * writes for a FIRST selection on pristine state: the profile goes in
 * `pending`, while `active` and `lastKnownGood` stay on `desktop`. Seeding
 * `active` directly would assert a health this installer cannot know; seeding
 * `pending` inherits the launcher's rollback contract instead — the profile is
 * only adopted if it is genuinely selectable at boot, and only promoted to
 * `lastKnownGood` once its shell has actually mounted.
 * @returns the state document to write.
 */
export function defaultSelectionState() {
  return {
    version: SELECTION_STATE_VERSION,
    active: DESKTOP_PROFILE_NAME,
    pending: PRESET_NAME,
    lastKnownGood: DESKTOP_PROFILE_NAME,
  }
}

/**
 * Decide whether the selection state may be seeded.
 *
 * The test is that the file does NOT exist — which is stricter than "the user
 * has not chosen", and deliberately so. The launcher rewrites this file on
 * every boot, and an explicit pick of `desktop` produces a document identical
 * to the pristine default, so once the file exists no reading of it can
 * distinguish "never chose" from "chose, and chose the other one". Absence is
 * the only unambiguous signal, so absence is the whole permission.
 *
 * The cost is that `--default` refuses on a machine that has already launched
 * the application. That refusal has a one-click remedy — the tray profile
 * picker, whose choice already persists — and the message says so.
 * @param statePath - the selection-state file.
 * @returns `'write'`, or `'exists'` when an operator-owned selection is present.
 */
export function planDefaultSelection(statePath) {
  return existsSync(statePath) ? 'exists' : 'write'
}

/**
 * Seed the selection state, refusing an existing file at the syscall.
 *
 * `flag: 'wx'` is what actually enforces "only when absent": the check in
 * `planDefaultSelection` produces the readable diagnostic, but it is this flag
 * that makes the guarantee independent of it, so a selection created between
 * the two cannot be clobbered.
 *
 * `mkdirSync`'s `mode` applies only to directories it creates, so an existing
 * `profile-selection/` keeps whatever permissions it had. The launcher solves
 * that with an explicit `chmodSync` after its own `mkdirSync`, and this does
 * the same — otherwise the claim that these modes match the launcher's would
 * be false for exactly the case that matters, a directory left behind by an
 * interrupted write.
 * @param statePath - the selection-state file.
 * @param whenLate - context appended to a failure raised after other writes.
 * @returns the state document written.
 */
export function writeDefaultSelection(statePath, whenLate = '') {
  const stateDir = dirname(statePath)
  // Directory preparation is wrapped separately from the state write, and
  // deliberately does NOT map EEXIST to the "a selection already exists"
  // refusal: an EEXIST here means something occupies the DIRECTORY path (a
  // file where `profile-selection/` belongs), which is a different fault with
  // a different remedy. Only the state write below can prove a selection.
  try {
    mkdirSync(stateDir, { recursive: true, mode: SELECTION_DIRECTORY_MODE })
    const directoryStat = lstatSync(stateDir)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new InstallError(`${BIN}: profile selection state directory is not private: ${stateDir}`)
    }
    chmodSync(stateDir, SELECTION_DIRECTORY_MODE)
  } catch (cause) {
    throw new InstallError(seedFailedMessage(statePath, cause) + whenLate)
  }
  const state = defaultSelectionState()
  try {
    writeFileSync(statePath, `${JSON.stringify(state, undefined, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: SELECTION_FILE_MODE,
    })
  } catch (cause) {
    if (cause?.code === 'EEXIST') throw new InstallError(refuseDefaultMessage(statePath) + whenLate)
    // Every other failure is the seed's, not the profile install's. Rethrowing
    // it raw would surface a bare errno with no indication of which step
    // failed — and, on the late path, none that the profile is already in
    // place. Naming the step is what keeps the exit code readable.
    throw new InstallError(seedFailedMessage(statePath, cause) + whenLate)
  }
  return state
}

/** One diagnostic for every non-refusal seed failure, naming the step. */
function seedFailedMessage(statePath, cause) {
  const detail = cause instanceof InstallError ? cause.message : String(cause)
  return `${BIN}: could not seed the desktop profile selection at ${statePath}: ${detail}`
}

/** The refusal `--default` prints, naming the surface that still works. */
function refuseDefaultMessage(statePath) {
  return `${BIN}: refusing to overwrite an existing desktop profile selection:\n`
    + `  ${statePath}\n`
    + 'That file records the profile this machine boots, and the installer cannot tell a\n'
    + 'deliberate choice from a default one. Select the profile in the desktop tray picker\n'
    + `instead — that choice persists — or remove the file to seed ${PRESET_NAME} as the default.`
}

/**
 * The sentence appended when the seed fails AFTER the profile files landed.
 *
 * The pre-check keeps the common refusal all-or-nothing, but it cannot cover a
 * selection that appears mid-run: the seed is written last, on purpose, so the
 * profile it names exists by the time it is named. A failure there leaves a
 * correctly installed profile that simply is not the default, and saying so is
 * the difference between a readable exit 1 and one that reads as "nothing
 * happened".
 */
const SEED_FAILED_LATE = '\n'
  + `${BIN}: the profile itself installed successfully — only the default selection was not set.`

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
 *
 * `setDefault` additionally seeds the desktop launcher's selection state. An
 * already-existing selection is refused BEFORE any file is written, alongside
 * the managed-file conflicts, so the ordinary refusal leaves nothing behind.
 * The state itself is written LAST, once the profile it names actually exists
 * on disk — a `pending` selection pointing at a profile that is not there yet
 * would just be rolled back by the launcher.
 *
 * Those two facts bound the guarantee precisely, and it is narrower than
 * "all-or-nothing": a selection that appears BETWEEN the check and the write
 * is refused at the syscall, after the profile files have landed. That run
 * exits non-zero with the profile correctly installed and simply not the
 * default, and the message says exactly that rather than reading as though
 * nothing happened.
 *
 * `--force` is deliberately NOT a release for this claim. It releases this
 * installer's own claim over files it wrote under `$DSH_HOME`; the selection
 * state is neither this installer's nor inside that home, and no flag here
 * should be able to move an operator's running application to another profile.
 * @returns a summary of what was written, kept, and skipped.
 */
export function install({
  home,
  force = false,
  dryRun = false,
  packageRoot = PACKAGE_ROOT,
  setDefault = false,
  userDataDir,
} = {}) {
  // The CLI refuses this pair in `parseArgs`; an API caller gets the same
  // answer rather than a silently inert argument.
  if (userDataDir !== undefined && !setDefault) {
    throw new InstallError(`${BIN}: userDataDir only applies with setDefault`)
  }
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
  let statePath
  if (setDefault) {
    statePath = selectionStatePath(userDataDir ?? defaultDesktopUserDataDirectory())
    if (planDefaultSelection(statePath) === 'exists') throw new InstallError(refuseDefaultMessage(statePath))
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
  // `action` is the discriminator, not the caller's memory of `dryRun`: a
  // consumer that only sees `{ statePath, state }` cannot tell a durable write
  // from a rehearsal, and would report a default that was never set.
  let defaultSelection
  if (statePath !== undefined) {
    defaultSelection = dryRun
      ? { statePath, action: 'would-write', state: defaultSelectionState() }
      : { statePath, action: 'written', state: writeDefaultSelection(statePath, SEED_FAILED_LATE) }
  }
  return {
    home,
    written,
    unchanged,
    receiptPath,
    ...(defaultSelection === undefined ? {} : { defaultSelection }),
  }
}

/** Parse argv into install options; throws on an unknown or incomplete flag. */
export function parseArgs(argv) {
  const options = { force: false, dryRun: false, setDefault: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--force') options.force = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--default') options.setDefault = true
    else if (argument === '--home' || argument === '--user-data-dir') {
      const value = argv[index += 1]
      if (value === undefined) throw new InstallError(`${BIN}: ${argument} needs a directory`)
      if (argument === '--home') options.homeOverride = value
      else options.userDataDir = resolve(value)
    } else throw new InstallError(`${BIN}: unknown argument ${JSON.stringify(argument)}`)
  }
  // `--user-data-dir` only ever names where the selection state goes, so on its
  // own it would silently do nothing. Refusing says which flag is missing.
  if (options.userDataDir !== undefined && !options.setDefault) {
    throw new InstallError(`${BIN}: --user-data-dir only applies with --default`)
  }
  return options
}

/**
 * Refuse a `--default` that seeds a selection the launcher would roll back.
 *
 * The launcher resolves its own Harness home from `$DSH_HOME` and never sees
 * `--home`. So `--home <elsewhere> --default` installs the profile into one
 * home and points the real `userData` at a profile the app cannot find: the
 * next start rolls straight back to `desktop` and shows a recovery banner,
 * while this script has already printed that the next start selects
 * Parametria. Refusing is the only way to keep that sentence true.
 *
 * An explicit `--user-data-dir` means the caller is deliberately pairing a
 * home with a matching data root — an isolated instance — so the pair is
 * allowed.
 * @param options - parsed options.
 * @param home - the resolved install home.
 */
function assertDefaultTargetsTheLauncherHome(options, home) {
  if (!options.setDefault || options.userDataDir !== undefined) return
  const launcherHome = resolveHome(undefined)
  if (home === launcherHome) return
  throw new InstallError(
    `${BIN}: --default seeds the selection the desktop launcher reads, and the launcher\n`
    + `resolves its home from $DSH_HOME (${launcherHome}), not from --home (${home}).\n`
    + 'Set $DSH_HOME instead, or pass a matching --user-data-dir for an isolated instance.',
  )
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const { homeOverride, ...options } = parseArgs(process.argv.slice(2))
    const home = resolveHome(homeOverride)
    assertDefaultTargetsTheLauncherHome(options, home)
    const result = install({ ...options, home })
    const verb = options.dryRun ? 'would write' : 'wrote'
    const marker = options.dryRun ? '~' : '+'
    const selection = result.defaultSelection === undefined
      ? `${BIN}: select it with the desktop profile picker, or 'dsh --profile ${PRESET_NAME}'\n`
      : `${BIN}: ${result.defaultSelection.action === 'written' ? 'seeded' : 'would seed'}`
        + ` the desktop profile selection at ${result.defaultSelection.statePath}\n`
        + `${BIN}: the next DSH Desktop start selects ${PRESET_NAME};`
        + ` the tray picker overrides it at any time\n`
    process.stdout.write(
      `${BIN}: ${verb} ${result.written.length} file(s), ${result.unchanged.length} already current, under ${home}\n`
      + result.written.map(name => `  ${marker} ${name}\n`).join('')
      + selection,
    )
  } catch (error) {
    process.stderr.write(`${error instanceof InstallError ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export {
  DESKTOP_PRODUCT_NAME,
  DESKTOP_PROFILE_NAME,
  InstallError,
  PRESET_NAME,
  PROFILE_PNPM_WORKSPACE,
  RECEIPT_NAME,
  SELECTION_DIRECTORY_MODE,
  SELECTION_FILE_MODE,
  SELECTION_STATE_SEGMENTS,
  SELECTION_STATE_VERSION,
  assertDefaultTargetsTheLauncherHome,
}
