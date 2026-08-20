/**
 * Drift fences over everything the installer MIRRORS from the desktop launcher.
 *
 * `--default` writes one file that belongs to another package:
 * `<userData>/profile-selection/state.json`. Six values have to stay true for
 * that write to land where the launcher will read it, in the form it expects,
 * and every one of them lives in `dsh-plugin-desktop/src`:
 *
 *   1. the application name that names `userData`  (`main.ts` PRODUCT_NAME)
 *   2. how that name becomes a directory           (`bin.ts`)
 *   3. the path of the state file under it         (`main.ts` selectionStatePath)
 *   4. the document's format version               (`profile-manager.ts`)
 *   5. the fallback profile name                   (`profile-manager.ts`)
 *   6. the directory and file modes                (`profile-manager.ts`)
 *
 * The installer cannot import any of them: it imports only node builtins, and
 * `yarn check` runs this package BEFORE `dsh-plugin-desktop` is built, so there
 * is no compiled module to reach for. The values are therefore duplicated, and
 * these fences are what make the duplication safe — they read the launcher's
 * SOURCE and fail when the two sides stop agreeing.
 *
 * Each assertion is anchored to a declaration rather than to loose text, so a
 * rename or a refactor that moves one of these values fails here with a
 * pointer to what must be re-derived, instead of passing on a substring that
 * happens to survive. A failure is not necessarily a bug in the launcher: it
 * means the mirror in `scripts/install-profile.mjs` is now stale.
 *
 * This is also the tripwire for the rebrand migration already on the board:
 * changing `app.setName` moves `userData` wholesale, and the installer has to
 * move with it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REPO_ROOT } from './helpers.mjs'
import {
  DESKTOP_PRODUCT_NAME,
  DESKTOP_PROFILE_NAME,
  SELECTION_DIRECTORY_MODE,
  SELECTION_FILE_MODE,
  SELECTION_STATE_SEGMENTS,
  SELECTION_STATE_VERSION,
  defaultDesktopUserDataDirectory,
  defaultSelectionState,
  selectionStatePath,
} from '../scripts/install-profile.mjs'

/** Read one launcher source file as text. */
function launcherSource(name) {
  return readFileSync(join(REPO_ROOT, 'dsh-plugin-desktop', 'src', name), 'utf8')
}

/**
 * The source text of one exported function, from its declaration to its
 * column-zero closing brace.
 *
 * Anchoring the search this way is what keeps the captures below honest: a
 * literal matched anywhere in the file could belong to an unrelated string,
 * while one matched inside the named function is the one that function uses.
 *
 * The span itself has to be anchored too, or the anchoring is a fiction. Two
 * of the field patterns further down (`version: STATE_VERSION,` and
 * `lastKnownGood: current.lastKnownGood,`) also occur in sibling functions of
 * `profile-manager.ts`, so a span that over-shot its target would keep
 * matching those from the next function down and fail only partially — a fence
 * passing on text that happened to survive, which is precisely what this file
 * claims to prevent. Hence the declaration is matched at column zero, the end
 * is the first column-zero `}`, and over-shoot is asserted against rather than
 * assumed away.
 * @param source - the file text.
 * @param name - the exported function name.
 * @returns the function's source span.
 */
function functionSpan(source, name) {
  const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'))
  assert.notEqual(start, -1, `${name} is no longer a top-level function declaration`)
  const rest = source.slice(start)
  const end = rest.search(/^\}$/m)
  assert.notEqual(end, -1, `${name} has no recognizable end`)
  const span = rest.slice(0, end)
  assert.ok(
    !/^(?:export |async function |function |const |class )/m.test(span.slice(1)),
    `${name}'s span overshot into a following declaration — assertions would match the wrong function`,
  )
  return span
}

/** The single capture of one anchored pattern, asserted to exist. */
function capture(source, pattern, what) {
  const match = source.match(pattern)
  assert.ok(match !== null, `${what} no longer matches ${pattern} — re-derive the installer's mirror`)
  return match[1]
}

describe('the application name that names userData', () => {
  it('is the string main.ts passes to app.setName, which the installer mirrors', () => {
    const main = launcherSource('main.ts')
    const declared = capture(main, /^const PRODUCT_NAME = '([^']*)'$/m, 'main.ts PRODUCT_NAME')
    assert.equal(
      declared,
      DESKTOP_PRODUCT_NAME,
      'main.ts renamed the Electron application: userData moved, and --default now writes to the old location',
    )
    // The value only names userData because it reaches app.setName BEFORE the
    // first getPath('userData'); asserting the call merely exists would leave
    // a refactor free to move it below bootstrap and relocate userData
    // silently. This ordering is also what makes the packaged
    // electron-builder `productName` irrelevant to the installer.
    //
    // Textual position is NOT execution order here — every getPath('userData')
    // inside `start()` sits earlier in the file than `run()` and executes
    // later. So the claim is checked where it actually holds: inside `run()`,
    // which is the entry point, setName must come before both the first
    // userData read and the call into `start()`; and `start()` must have no
    // other caller that could beat it.
    const run = functionSpan(main, 'run')
    const setName = run.indexOf('app.setName(PRODUCT_NAME)')
    assert.notEqual(setName, -1, 'run() no longer passes PRODUCT_NAME to app.setName')
    assert.ok(
      setName < run.indexOf('await start()'),
      'app.setName no longer precedes start(): userData would be named by Electron, not PRODUCT_NAME',
    )
    assert.ok(
      setName < run.indexOf("app.getPath('userData')"),
      "app.setName no longer precedes run()'s own getPath('userData')",
    )
    assert.equal(
      main.split('await start()').length - 1,
      1,
      'start() gained a second call site — one of them may now run before app.setName',
    )
  })

  it('is the same name in every platform branch of the launcher\'s headless mirror', () => {
    const span = functionSpan(launcherSource('bin.ts'), 'defaultDesktopUserDataDirectory')
    const windows = capture(span, /return path\.join\(appData, '([^']*)'\)/, 'the win32 branch')
    const macos = capture(
      span,
      /return path\.join\(homeDirectory, 'Library', 'Application Support', '([^']*)'\)/,
      'the darwin branch',
    )
    // The linux branch needs its whole shape pinned, not just the trailing
    // name. Capturing only `: config, '<name>')` would leave the XDG read and
    // the `.config` fallback unasserted — so a launcher that moved to, say,
    // `.local/share` would keep this green while the installer went on seeding
    // the old directory forever.
    const linuxBase = capture(
      span,
      /const config = environment\.(\w+)\n/,
      'the linux XDG environment read',
    )
    const linuxFallback = capture(
      span,
      /path\.join\(homeDirectory, '([^']*)'\)\n?\s*: config,/,
      'the linux fallback directory',
    )
    const linux = capture(span, /: config, '([^']*)'\)/, 'the linux branch')
    assert.equal(linuxBase, 'XDG_CONFIG_HOME')
    assert.equal(linuxFallback, '.config')
    assert.deepEqual([windows, macos, linux], Array(3).fill(DESKTOP_PRODUCT_NAME))
  })

  it('produces the same three directories the installer resolves', () => {
    // The direction the previous test does not cover: the launcher's literals
    // could agree while our reimplementation of the surrounding path shape
    // drifted.
    assert.equal(
      defaultDesktopUserDataDirectory('win32', { APPDATA: 'C:\\Users\\Example\\AppData\\Roaming' }, 'ignored'),
      `C:\\Users\\Example\\AppData\\Roaming\\${DESKTOP_PRODUCT_NAME}`,
    )
    assert.equal(
      defaultDesktopUserDataDirectory('darwin', {}, '/Users/example'),
      `/Users/example/Library/Application Support/${DESKTOP_PRODUCT_NAME}`,
    )
    assert.equal(
      defaultDesktopUserDataDirectory('linux', {}, '/home/example'),
      `/home/example/.config/${DESKTOP_PRODUCT_NAME}`,
    )
    assert.equal(
      defaultDesktopUserDataDirectory('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/example'),
      `/xdg/${DESKTOP_PRODUCT_NAME}`,
    )
  })

  it('refuses rather than guessing when APPDATA is unavailable', () => {
    assert.throws(
      () => defaultDesktopUserDataDirectory('win32', {}, 'ignored'),
      /--user-data-dir/,
    )
  })
})

describe('the selection state file', () => {
  it('sits at the path main.ts reads it from', () => {
    const main = launcherSource('main.ts')
    const match = main.match(/selectionStatePath = join\(app\.getPath\('userData'\), '([^']*)', '([^']*)'\)/)
    assert.ok(match !== null, 'main.ts no longer composes selectionStatePath from two userData segments')
    assert.deepEqual([match[1], match[2]], [...SELECTION_STATE_SEGMENTS])
    assert.equal(selectionStatePath('/data'), join('/data', ...SELECTION_STATE_SEGMENTS))
  })

  it('carries the format version and fallback profile the launcher declares', () => {
    const manager = launcherSource('profile-manager.ts')
    assert.equal(
      Number(capture(manager, /^const STATE_VERSION = (\d+)$/m, 'profile-manager.ts STATE_VERSION')),
      SELECTION_STATE_VERSION,
      'the selection state format changed version: a seeded document of the old version is discarded as corrupt',
    )
    assert.equal(
      capture(manager, /^const DEFAULT_PROFILE_NAME = '([^']*)'$/m, 'profile-manager.ts DEFAULT_PROFILE_NAME'),
      DESKTOP_PROFILE_NAME,
    )
  })

  it('is written as privately as the launcher declares it must be', () => {
    // These two are mirrored in the installer as well, so leaving them out of
    // the fence would let the launcher tighten its own state while the
    // installer kept writing the looser mode — with every test still green,
    // because the mode test asserts a literal rather than deriving it.
    const manager = launcherSource('profile-manager.ts')
    assert.equal(
      capture(manager, /^const STATE_DIRECTORY_MODE = (0o\d+)$/m, 'profile-manager.ts STATE_DIRECTORY_MODE'),
      `0o${SELECTION_DIRECTORY_MODE.toString(8)}`,
    )
    assert.equal(
      capture(manager, /^const STATE_FILE_MODE = (0o\d+)$/m, 'profile-manager.ts STATE_FILE_MODE'),
      `0o${SELECTION_FILE_MODE.toString(8)}`,
    )
  })
})

describe('the shape a first picker selection writes', () => {
  it('is the shape the installer seeds: pending set, active and last-known-good untouched', () => {
    // The installer's claim is that `--default` writes nothing the picker
    // would not write itself on a pristine machine — so the claim is checked
    // rather than asserted in a comment.
    //
    // The check is over a CLOSED key set taken from one object literal, not a
    // set of independent field matches. Matching fields individually against
    // the whole function would let a new key (say `selectedAt`) appear in the
    // launcher's document with every assertion still green, quietly falsifying
    // the "byte-for-byte" claim; and two of these field patterns also occur in
    // sibling literals, so "found somewhere" is not "found here".
    const span = functionSpan(launcherSource('profile-manager.ts'), 'selectDesktopProfile')
    const branch = span.match(/\n\s*: \{\n([\s\S]*?)\n\s*\}/)
    assert.ok(
      branch !== null,
      'selectDesktopProfile no longer writes a first selection as a distinct object literal',
    )
    const fields = [...branch[1].matchAll(/^\s*(\w+): (.+?),?$/gm)].map(match => [match[1], match[2]])
    assert.deepEqual(fields, [
      ['version', 'STATE_VERSION'],
      ['active', 'current.active'],
      ['pending', 'name'],
      ['lastKnownGood', 'current.lastKnownGood'],
    ], 'selectDesktopProfile no longer writes a first selection as a pending one, unchanged elsewhere')

    // The reverse direction: the installer's own document must carry exactly
    // that key set, in that order. Without this the fence would only watch the
    // launcher, and the installer could drift alone.
    assert.deepEqual(Object.keys(defaultSelectionState()), fields.map(([key]) => key))
  })

  it('is adopted only through the launcher\'s own rollback contract', () => {
    // Why seeding `pending` rather than `active` is the safe choice: startup
    // refuses an unselectable pending profile and falls back, and only a
    // healthy mount promotes last-known-good. Both are load-bearing for the
    // installer's refusal-free failure mode on a broken profile.
    const startup = functionSpan(launcherSource('profile-manager.ts'), 'beginDesktopProfileStartup')
    assert.match(startup, /if \(isSelectable\(home, current\.pending\)\) \{\n\s*profileName = current\.pending/)
    assert.match(startup, /profileName = isSelectable\(home, current\.lastKnownGood\)\n?\s*\? current\.lastKnownGood/)
    const healthy = functionSpan(launcherSource('profile-manager.ts'), 'markDesktopProfileHealthy')
    assert.match(healthy, /\blastKnownGood: name,/)
  })
})
