/**
 * Drift fences over everything the installer MIRRORS from the desktop launcher.
 *
 * `--default` writes one file that belongs to another package:
 * `<userData>/profile-selection/state.json`. Four separate facts have to stay
 * true for that write to land where the launcher will read it, and every one
 * of them lives in `dsh-plugin-desktop/src`:
 *
 *   1. the application name that names `userData`  (`main.ts` PRODUCT_NAME)
 *   2. how that name becomes a directory           (`bin.ts`)
 *   3. the path of the state file under it         (`main.ts` selectionStatePath)
 *   4. the document's version and default profile  (`profile-manager.ts`)
 *
 * The installer cannot import any of them: it is dependency-free `.mjs` and
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
  SELECTION_STATE_SEGMENTS,
  SELECTION_STATE_VERSION,
  defaultDesktopUserDataDirectory,
  selectionStatePath,
} from '../scripts/install-profile.mjs'

/** Read one launcher source file as text. */
function launcherSource(name) {
  return readFileSync(join(REPO_ROOT, 'dsh-plugin-desktop', 'src', name), 'utf8')
}

/**
 * The source text of one exported function, from its declaration to the next
 * top-level declaration.
 *
 * Anchoring the search this way is what keeps the captures below honest: a
 * literal matched anywhere in the file could belong to an unrelated string,
 * while a literal matched inside the named function is the one that function
 * actually uses.
 * @param source - the file text.
 * @param name - the exported function name.
 * @returns the function's source span.
 */
function functionSpan(source, name) {
  const start = source.indexOf(`export function ${name}(`)
  assert.notEqual(start, -1, `${name} is no longer an exported function declaration`)
  const rest = source.slice(start + 1)
  const end = rest.search(/\n\}\n/)
  assert.notEqual(end, -1, `${name} has no recognizable end`)
  return rest.slice(0, end)
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
    // The value is only the userData name because it reaches app.setName before
    // the first getPath('userData'). Without this line the constant would be
    // display text and the mirror would be resting on nothing.
    assert.match(main, /\bapp\.setName\(PRODUCT_NAME\)/)
  })

  it('is the same name in every platform branch of the launcher\'s headless mirror', () => {
    const span = functionSpan(launcherSource('bin.ts'), 'defaultDesktopUserDataDirectory')
    const windows = capture(span, /return path\.join\(appData, '([^']*)'\)/, 'the win32 branch')
    const macos = capture(
      span,
      /return path\.join\(homeDirectory, 'Library', 'Application Support', '([^']*)'\)/,
      'the darwin branch',
    )
    const linux = capture(span, /: config, '([^']*)'\)/, 'the linux branch')
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
})

describe('the shape a first picker selection writes', () => {
  it('is the shape the installer seeds: pending set, active and last-known-good untouched', () => {
    // The installer's claim is that `--default` writes nothing the picker
    // would not write itself on a pristine machine. That claim is only true
    // while selectDesktopProfile's non-reselect branch keeps this shape, so
    // the sentence is checked rather than asserted in a comment.
    const span = functionSpan(launcherSource('profile-manager.ts'), 'selectDesktopProfile')
    for (const field of [
      /\bversion: STATE_VERSION,/,
      /\bactive: current\.active,/,
      /\bpending: name,/,
      /\blastKnownGood: current\.lastKnownGood,/,
    ]) {
      assert.match(span, field, 'selectDesktopProfile no longer writes a first selection as a pending one')
    }
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
