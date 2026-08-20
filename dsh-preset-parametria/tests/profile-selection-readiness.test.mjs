/**
 * Fences over the installer's readiness check — the checked replacement for a
 * hint that cost issue #1 two live runs.
 *
 * The preset installs across two planes with different scopes: the agent preset
 * goes to `$DSH_HOME/.agent-presets/`, which every profile scans, while the
 * `parametria-vision` route its validator pins goes to `profiles/parametria/`
 * and exists for that profile alone. Runs 3 and 4 both booted the `desktop`
 * profile with the preset live, so every validator child carried the right
 * route config and died at its first request with
 * `no adapter registered for provider "parametria-vision"`. The install had
 * reported success both times.
 *
 * These tests hold the three answers apart — READY, UNKNOWN, and REFUSED — and
 * the refusal's exit code, because an unknown reported as either of the others
 * is how that failure stayed invisible.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import {
  DESKTOP_PROFILE_NAME,
  PRESET_NAME,
  classifyProfileSelection,
  readSelectionDocument,
  reportProfileSelection,
  selectionStatePath,
} from '../scripts/install-profile.mjs'

const roots = []
const freshRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-parametria-readiness-'))
  roots.push(root)
  return root
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Write one selection document into a fresh `userData` root. */
function userDataWith(state) {
  const userDataDir = freshRoot()
  const statePath = selectionStatePath(userDataDir)
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, typeof state === 'string' ? state : `${JSON.stringify(state, undefined, 2)}\n`)
  return { userDataDir, statePath }
}

/** Run the check against a paired home and data root, which always opts in. */
function report(userDataDir) {
  return reportProfileSelection({ home: freshRoot(), userDataDir })
}

describe('reading the launcher selection document', () => {
  it('reports an absent file as absent rather than as unusable', () => {
    assert.equal(readSelectionDocument(selectionStatePath(freshRoot())), undefined)
  })

  it('reports an unparseable file as unusable rather than as absent', () => {
    // Absence is the whole permission `--default` needs, so a file this
    // installer merely failed to parse must never read as one.
    const { statePath } = userDataWith('{ not json')
    assert.equal(readSelectionDocument(statePath), null)
  })

  it('reports a non-object document as unusable', () => {
    const { statePath } = userDataWith('"desktop"')
    assert.equal(readSelectionDocument(statePath), null)
  })
})

describe('classifying what the selection means for this preset', () => {
  it('counts a pending choice of this preset as selected, before it is active', () => {
    // This is the shape `--default` seeds and the shape the tray picker writes
    // for a first pick: the launcher promotes it only once the shell mounts.
    assert.deepEqual(
      classifyProfileSelection({ version: 1, active: DESKTOP_PROFILE_NAME, pending: PRESET_NAME, lastKnownGood: DESKTOP_PROFILE_NAME }),
      { kind: 'selected', via: 'pending' },
    )
  })

  it('counts an active choice of this preset as selected', () => {
    assert.deepEqual(
      classifyProfileSelection({ version: 1, active: PRESET_NAME, lastKnownGood: PRESET_NAME }),
      { kind: 'selected', via: 'active' },
    )
  })

  it('lets a pending choice of another profile outrank an active one of this preset', () => {
    // `pending` names what the NEXT start will try, so it decides. Reading
    // `active` here would call a machine ready for a boot that will not happen.
    assert.deepEqual(
      classifyProfileSelection({ version: 1, active: PRESET_NAME, pending: DESKTOP_PROFILE_NAME }),
      { kind: 'other', via: 'pending', chosen: DESKTOP_PROFILE_NAME },
    )
  })

  it('names the other profile it found, which is what makes the refusal actionable', () => {
    // The exact document read off the operator's machine during runs 3 and 4.
    assert.deepEqual(
      classifyProfileSelection({ version: 1, active: DESKTOP_PROFILE_NAME, lastKnownGood: DESKTOP_PROFILE_NAME }),
      { kind: 'other', via: 'active', chosen: DESKTOP_PROFILE_NAME },
    )
  })

  it('keeps absent, unusable, and empty apart', () => {
    assert.deepEqual(classifyProfileSelection(undefined), { kind: 'unseeded' })
    assert.deepEqual(classifyProfileSelection(null), { kind: 'unreadable' })
    assert.deepEqual(classifyProfileSelection({ version: 1 }), { kind: 'unreadable' })
  })
})

describe('the readiness report', () => {
  it('refuses a machine that boots another profile, naming it and the failure it predicts', () => {
    const { userDataDir, statePath } = userDataWith({
      version: 1,
      active: DESKTOP_PROFILE_NAME,
      lastKnownGood: DESKTOP_PROFILE_NAME,
    })
    const { refusal } = report(userDataDir)
    assert.ok(refusal !== undefined, 'a machine selecting another profile must not report a clean install')
    assert.match(refusal, /no adapter registered for provider "parametria-vision"/u)
    assert.ok(refusal.includes(statePath), 'the refusal must name the file the operator has to change')
    assert.ok(refusal.includes(JSON.stringify(DESKTOP_PROFILE_NAME)), 'the refusal must name the profile actually selected')
  })

  it('passes a machine whose selection names this preset', () => {
    const { userDataDir } = userDataWith({
      version: 1,
      active: DESKTOP_PROFILE_NAME,
      pending: PRESET_NAME,
      lastKnownGood: DESKTOP_PROFILE_NAME,
    })
    const { refusal, lines } = report(userDataDir)
    assert.equal(refusal, undefined)
    assert.ok(lines.some(line => line.includes(PRESET_NAME)))
  })

  it('reports an unrecorded selection as unknown, not as ready and not as a refusal', () => {
    const { refusal, lines } = report(freshRoot())
    assert.equal(refusal, undefined)
    assert.ok(lines.some(line => line.includes('no launcher profile selection recorded')))
    assert.ok(
      lines.some(line => line.includes('not mounted')),
      'an unknown still has to say the route is not reachable yet',
    )
  })

  it('reports an unusable selection as unconfirmed rather than inventing an answer', () => {
    const { userDataDir } = userDataWith('{ not json')
    const { refusal, lines } = report(userDataDir)
    assert.equal(refusal, undefined)
    assert.ok(lines.some(line => line.includes('readiness unconfirmed')))
  })

  it('says nothing about the operator machine when the install targeted another home', () => {
    // Test and evidence-harness installs pass `--home <temp>`; judging them
    // against the operator's real launcher state would be noise, and would fail
    // the repository's own gate on any developer machine that boots `desktop`.
    const { lines, refusal } = reportProfileSelection({
      home: freshRoot(),
      launcherHome: freshRoot(),
    })
    assert.equal(refusal, undefined)
    assert.deepEqual(lines.length, 1)
    assert.match(lines[0], /selection check skipped/u)
  })

  it('skips rather than throws when the platform hides the userData root', () => {
    // `defaultDesktopUserDataDirectory` throws without APPDATA on win32. A
    // readiness check is not worth failing an install that otherwise succeeded.
    const home = freshRoot()
    const { lines, refusal } = reportProfileSelection({
      home,
      launcherHome: home,
      platform: 'win32',
      environment: {},
    })
    assert.equal(refusal, undefined)
    assert.match(lines[0], /selection check skipped/u)
  })
})
