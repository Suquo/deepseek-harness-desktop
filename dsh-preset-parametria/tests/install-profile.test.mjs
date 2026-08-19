/**
 * Fences over the installer, including its refusal path.
 *
 * The installer writes into a directory the operator also edits by hand, so
 * "overwrite everything" is not an option and "never overwrite" would make the
 * package undeliverable. The claim it takes over each managed file is recorded
 * in a receipt and released by `--force`; these tests hold both halves.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { PACKAGE_ROOT } from './helpers.mjs'
import {
  InstallError,
  RECEIPT_NAME,
  install,
  managedFiles,
  parseArgs,
  resolveHome,
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
    const installed = readFileSync(join(home, '.agent-presets', 'parametria', 'agent.cordis.yml'), 'utf8')
    assert.match(installed, /toolName: subagent_validator/)
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
    assert.match(readFileSync(path, 'utf8'), /parametria-vision/)
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
    assert.match(readFileSync(join(home, 'profiles', 'parametria', 'cordis.patch.yml'), 'utf8'), /parametria-vision/)
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

describe('argument and home resolution', () => {
  it('reads --home, --force, and --dry-run', () => {
    assert.deepEqual(parseArgs(['--force', '--dry-run', '--home', 'C:/tmp/home']), {
      force: true,
      dryRun: true,
      homeOverride: 'C:/tmp/home',
    })
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
