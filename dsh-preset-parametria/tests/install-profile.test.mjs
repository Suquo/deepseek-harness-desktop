/**
 * Fences over the installer, including its refusal path.
 *
 * The installer writes into a directory the operator also edits by hand, so
 * "overwrite everything" is not an option and "never overwrite" would make the
 * package undeliverable. The claim it takes over each managed file is recorded
 * in a receipt and released by `--force`; these tests hold both halves.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { PACKAGE_ROOT, indexRows, readComposition } from './helpers.mjs'
import {
  InstallError,
  RECEIPT_NAME,
  defaultSelectionState,
  install,
  managedFiles,
  parseArgs,
  resolveHome,
  selectionStatePath,
  writeDefaultSelection,
} from '../scripts/install-profile.mjs'

const homes = []
const freshHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-parametria-'))
  homes.push(home)
  return home
}

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

const PRESET_YML = '.agent-presets/parametria/agent.cordis.yml'
const PROFILE_PATCH = 'profiles/parametria/cordis.patch.yml'

/** Absolute destination of one managed file inside a Harness home. */
const destination = (home, managedPath) => join(home, ...managedPath.split('/'))

/**
 * Assert an installed file is byte-identical to the source artifact the
 * installer claims to copy.
 *
 * This is the identity assertion, not a substring probe. A regex like
 * `/parametria-vision/` passes on any file that merely mentions the route —
 * including the operator's own edit, or a half-written copy — so it cannot
 * distinguish "the packaged artifact landed" from "something with that text
 * is there". Hashing the whole file states the claim the installer actually
 * makes, and names the file when it fails.
 * @param home - the Harness home installed into.
 * @param managedPath - the managed path, as `managedFiles()` keys it.
 */
function assertInstalledMatchesSource(home, managedPath) {
  const expected = managedFiles(PACKAGE_ROOT).get(managedPath)
  assert.ok(expected !== undefined, `${managedPath} is not a managed file`)
  const actual = readFileSync(destination(home, managedPath))
  assert.equal(
    createHash('sha256').update(actual).digest('hex'),
    createHash('sha256').update(expected).digest('hex'),
    `${managedPath} on disk differs from the packaged artifact`,
  )
}

describe('the managed file set', () => {
  const files = managedFiles(PACKAGE_ROOT)

  it('carries the preset composition, its metadata, and its skill root', () => {
    for (const name of [PRESET_YML, '.agent-presets/parametria/preset.yml', '.agent-presets/parametria/skills/.gitkeep']) {
      assert.ok(files.has(name), `${name} is not installed`)
    }
  })

  it('carries the profile manifest, patch layer, and pnpm settings', () => {
    for (const name of [
      'profiles/parametria/package.json',
      PROFILE_PATCH,
      'profiles/parametria/pnpm-workspace.yaml',
    ]) {
      assert.ok(files.has(name), `${name} is not installed`)
    }
  })

  it('installs nothing outside the two directories it owns', () => {
    for (const name of files.keys()) {
      assert.match(name, /^(?:\.agent-presets|profiles)\/parametria\//)
    }
  })

  it('never installs a skill file into the preset-local root', () => {
    const skills = [...files.keys()].filter(name => name.startsWith('.agent-presets/parametria/skills/'))
    assert.deepEqual(skills, ['.agent-presets/parametria/skills/.gitkeep'])
  })
})

describe('a first install', () => {
  const home = freshHome()
  const result = install({ home })

  it('writes every managed file', () => {
    assert.deepEqual(result.written.sort(), [...managedFiles(PACKAGE_ROOT).keys()].sort())
    assert.deepEqual(result.unchanged, [])
  })

  it('lands the preset where the user preset root is scanned', () => {
    assertInstalledMatchesSource(home, PRESET_YML)
  })

  it('lands a preset whose validator row still parses as the declaration it is', () => {
    // Parsed back from the INSTALLED copy, so this holds the artifact the
    // harness will actually read rather than the one in the repository.
    const installed = indexRows(readComposition(destination(home, PRESET_YML)))
    const row = installed.get('delegation/tool-subagent-validator')
    assert.equal(row.name, '@deepseek-ai/dsh-tool-subagent')
    assert.equal(row.config.toolName, 'subagent_validator')
    assert.deepEqual(row.config.agentOptions, {
      provider: 'parametria-vision',
      model: 'google/gemini-3.6-flash',
    })
  })

  it('records a receipt beside the profile, where no discovery scan reaches it', () => {
    // Profile discovery iterates `$DSH_HOME/profiles` for directories, so a
    // dotfile one level deeper is invisible to it.
    const receipt = JSON.parse(readFileSync(join(home, 'profiles', 'parametria', RECEIPT_NAME), 'utf8'))
    assert.equal(receipt.preset, 'parametria')
    assert.equal(Object.keys(receipt.files).length, managedFiles(PACKAGE_ROOT).size)
  })
})

describe('a re-install', () => {
  it('is a no-op when nothing changed', () => {
    const home = freshHome()
    install({ home })
    const again = install({ home })
    assert.deepEqual(again.written, [])
    assert.equal(again.unchanged.length, managedFiles(PACKAGE_ROOT).size)
  })

  it('replaces a file the installer itself wrote and the operator did not touch', () => {
    const home = freshHome()
    install({ home })
    // Simulate a stale previous version: content differs from the package, but
    // the receipt still records the hash the installer last wrote.
    const path = join(home, 'profiles', 'parametria', 'cordis.patch.yml')
    const receiptPath = join(home, 'profiles', 'parametria', RECEIPT_NAME)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    writeFileSync(path, '# stale previous version\n[]\n')
    receipt.files[PROFILE_PATCH] = createHash('sha256').update('# stale previous version\n[]\n').digest('hex')
    writeFileSync(receiptPath, JSON.stringify(receipt, undefined, 2) + '\n')
    const result = install({ home })
    assert.deepEqual(result.written, [PROFILE_PATCH])
    assertInstalledMatchesSource(home, PROFILE_PATCH)
  })
})

describe('a locally modified file', () => {
  /** A fresh home whose installed patch layer the operator has since edited. */
  const editedHome = () => {
    const home = freshHome()
    install({ home })
    writeFileSync(join(home, 'profiles', 'parametria', 'cordis.patch.yml'), '# the operator edited this\n[]\n')
    return home
  }

  it('stops the install and names the file', () => {
    assert.throws(() => install({ home: editedHome() }), error => {
      assert.ok(error instanceof InstallError)
      assert.match(error.message, /refusing to overwrite/)
      assert.match(error.message, /cordis\.patch\.yml/)
      return true
    })
  })

  it('leaves the edit in place, and writes nothing else either', () => {
    const home = editedHome()
    const presetPath = join(home, '.agent-presets', 'parametria', 'agent.cordis.yml')
    writeFileSync(presetPath, '[]\n')
    assert.throws(() => install({ home }), InstallError)
    assert.match(readFileSync(join(home, 'profiles', 'parametria', 'cordis.patch.yml'), 'utf8'), /the operator edited this/)
    // The refusal is all-or-nothing: a conflict anywhere stops every write, so
    // a partly-upgraded profile is not a state this installer can produce.
    assert.equal(readFileSync(presetPath, 'utf8'), '[]\n')
  })

  it('is released by --force, which re-records the receipt', () => {
    const home = editedHome()
    const result = install({ home, force: true })
    assert.ok(result.written.includes(PROFILE_PATCH))
    assertInstalledMatchesSource(home, PROFILE_PATCH)
    // With the claim re-taken, an ordinary re-install is a no-op again.
    assert.deepEqual(install({ home }).written, [])
  })
})

describe('the receipt itself', () => {
  const receiptPathIn = home => join(home, 'profiles', 'parametria', RECEIPT_NAME)

  it('stops the install when unreadable, rather than guessing at ownership', () => {
    // Continuing would reclassify every managed file as operator-owned and
    // refuse a legitimate upgrade with a message about edits nobody made.
    const home = freshHome()
    install({ home })
    writeFileSync(receiptPathIn(home), '{ not json')
    assert.throws(() => install({ home }), error => {
      assert.ok(error instanceof InstallError)
      assert.match(error.message, /receipt .* is unreadable/)
      return true
    })
  })

  it('honours the --force the unreadable-receipt message offers', () => {
    // The diagnostic names --force as the way through; this is the assertion
    // that keeps that sentence true.
    const home = freshHome()
    install({ home })
    writeFileSync(receiptPathIn(home), '{ not json')
    const result = install({ home, force: true })
    assert.deepEqual(result.written, [])
    assert.equal(JSON.parse(readFileSync(receiptPathIn(home), 'utf8')).preset, 'parametria')
  })

  it('treats a receipt version it does not know as no claim at all', () => {
    // A future format's hashes may mean something else, so every managed file
    // reverts to operator-owned: an unmodified file still matches byte for
    // byte and passes, while a changed one is refused rather than clobbered.
    const home = freshHome()
    install({ home })
    writeFileSync(receiptPathIn(home), JSON.stringify({ version: 99, files: {} }))
    assert.deepEqual(install({ home }).written, [])
    writeFileSync(join(home, 'profiles', 'parametria', 'cordis.patch.yml'), '# newer format, edited\n[]\n')
    writeFileSync(receiptPathIn(home), JSON.stringify({ version: 99, files: {} }))
    assert.throws(() => install({ home }), InstallError)
  })
})

describe('a pre-existing profile the installer never wrote', () => {
  it('is treated as operator-owned, not as a stale install', () => {
    const home = freshHome()
    mkdirSync(join(home, 'profiles', 'parametria'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'parametria', 'cordis.patch.yml'), '[]\n')
    assert.throws(() => install({ home }), InstallError)
  })
})

describe('--dry-run', () => {
  it('reports the writes without making them', () => {
    const home = freshHome()
    const result = install({ home, dryRun: true })
    assert.ok(result.written.length > 0)
    assert.throws(() => readFileSync(join(home, '.agent-presets', 'parametria', 'agent.cordis.yml')))
  })
})

describe('--default, which seeds the desktop profile selection', () => {
  /** A fresh Harness home paired with an empty Electron userData directory. */
  const freshPair = () => {
    const home = freshHome()
    const userDataDir = join(freshHome(), 'DSH Desktop')
    return { home, userDataDir, statePath: selectionStatePath(userDataDir) }
  }

  it('writes the document a first picker selection would write', () => {
    const { home, userDataDir, statePath } = freshPair()
    const result = install({ home, setDefault: true, userDataDir })
    assert.equal(result.defaultSelection.statePath, statePath)
    // The whole document, not a probe for the profile name: a state that also
    // carried `active: parametria` would contain the same name and mean
    // something the installer has no standing to assert.
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), {
      version: 1,
      active: 'desktop',
      pending: 'parametria',
      lastKnownGood: 'desktop',
    })
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), defaultSelectionState())
  })

  it('seeds a selection naming a profile that is already on disk', () => {
    // A pending profile the launcher cannot find is rolled straight back, so
    // the state is only meaningful once the profile files have landed.
    const { home, userDataDir } = freshPair()
    install({ home, setDefault: true, userDataDir })
    const pending = JSON.parse(readFileSync(selectionStatePath(userDataDir), 'utf8')).pending
    assert.ok(existsSync(join(home, 'profiles', pending, 'package.json')))
  })

  it('is opt-in: an ordinary install leaves the selection state absent', () => {
    const { home, userDataDir, statePath } = freshPair()
    const result = install({ home, userDataDir: undefined })
    assert.equal(result.defaultSelection, undefined)
    assert.ok(!existsSync(statePath))
    assert.ok(!existsSync(userDataDir))
  })

  it('refuses an existing selection, naming the file and the surface that still works', () => {
    const { home, userDataDir, statePath } = freshPair()
    mkdirSync(join(userDataDir, 'profile-selection'), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ version: 1, active: 'desktop', lastKnownGood: 'desktop' }))
    assert.throws(() => install({ home, setDefault: true, userDataDir }), error => {
      assert.ok(error instanceof InstallError)
      assert.match(error.message, /refusing to overwrite an existing desktop profile selection/)
      assert.match(error.message, /state\.json/)
      // The message offers the tray picker as the way through; this keeps that
      // sentence a true one.
      assert.match(error.message, /tray picker/)
      return true
    })
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).pending, undefined)
  })

  it('raises that refusal before writing anything at all', () => {
    // All-or-nothing, the same property the managed-file conflict has: a
    // --default that cannot be honoured must not leave a half-applied install.
    const { home, userDataDir, statePath } = freshPair()
    mkdirSync(join(userDataDir, 'profile-selection'), { recursive: true })
    writeFileSync(statePath, '{}')
    assert.throws(() => install({ home, setDefault: true, userDataDir }), InstallError)
    assert.ok(!existsSync(join(home, 'profiles', 'parametria', 'package.json')))
    assert.ok(!existsSync(join(home, '.agent-presets', 'parametria', 'agent.cordis.yml')))
  })

  it('is not released by --force, which claims only this installer\'s own files', () => {
    // --force releases the receipt claim over files under $DSH_HOME. The
    // selection state is another package's, outside that home, and moves the
    // operator's running application — no flag here may overwrite it.
    const { home, userDataDir, statePath } = freshPair()
    mkdirSync(join(userDataDir, 'profile-selection'), { recursive: true })
    writeFileSync(statePath, '{}')
    assert.throws(() => install({ home, setDefault: true, userDataDir, force: true }), InstallError)
    assert.equal(readFileSync(statePath, 'utf8'), '{}')
  })

  it('refuses at the syscall, not only at the plan', () => {
    // The existence check produces the readable diagnostic; `flag: 'wx'` is
    // what makes the guarantee independent of it. Calling the writer directly
    // is the state appearing between the two.
    const { userDataDir, statePath } = freshPair()
    mkdirSync(join(userDataDir, 'profile-selection'), { recursive: true })
    writeFileSync(statePath, '{}')
    assert.throws(() => writeDefaultSelection(statePath), InstallError)
    assert.equal(readFileSync(statePath, 'utf8'), '{}')
  })

  it('reports the seed under --dry-run without creating it', () => {
    const { home, userDataDir, statePath } = freshPair()
    const result = install({ home, setDefault: true, userDataDir, dryRun: true })
    assert.deepEqual(result.defaultSelection.state, defaultSelectionState())
    assert.ok(!existsSync(statePath))
    assert.ok(!existsSync(userDataDir))
  })

  it('writes the state as privately as the launcher keeps it', { skip: process.platform === 'win32' }, () => {
    // Windows reports POSIX mode bits it does not enforce, so the claim is
    // only checkable where the launcher's own 0o700/0o600 mean something.
    const { home, userDataDir, statePath } = freshPair()
    install({ home, setDefault: true, userDataDir })
    assert.equal(statSync(join(userDataDir, 'profile-selection')).mode & 0o777, 0o700)
    assert.equal(statSync(statePath).mode & 0o777, 0o600)
  })
})

describe('argument and home resolution', () => {
  it('reads --home, --force, and --dry-run', () => {
    assert.deepEqual(parseArgs(['--force', '--dry-run', '--home', 'C:/tmp/home']), {
      force: true,
      dryRun: true,
      setDefault: false,
      homeOverride: 'C:/tmp/home',
    })
  })

  it('reads --default, and --user-data-dir as an absolute override', () => {
    assert.equal(parseArgs(['--default']).setDefault, true)
    assert.equal(parseArgs([]).setDefault, false)
    const parsed = parseArgs(['--default', '--user-data-dir', 'data'])
    assert.equal(parsed.setDefault, true)
    assert.equal(parsed.userDataDir, join(process.cwd(), 'data'))
  })

  it('refuses --user-data-dir on its own rather than silently ignoring it', () => {
    assert.throws(() => parseArgs(['--user-data-dir', 'data']), /only applies with --default/)
    assert.throws(() => parseArgs(['--default', '--user-data-dir']), /--user-data-dir needs a directory/)
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    assert.throws(() => parseArgs(['--everything']), InstallError)
    assert.throws(() => parseArgs(['--home']), InstallError)
  })

  it('prefers DSH_HOME and falls back to ~/.dsh, matching resolveDshHome', () => {
    const previous = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = join(tmpdir(), 'explicit-home')
      assert.equal(resolveHome(undefined), join(tmpdir(), 'explicit-home'))
      delete process.env.DSH_HOME
      assert.match(resolveHome(undefined), /[\\/]\.dsh$/)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
