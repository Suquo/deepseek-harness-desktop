/**
 * Fences over the machine-wide plane: WHERE the `parametria-vision` route is
 * declared, and the guest discipline the installer follows to put it there.
 *
 * Issue #1's root cause was a scope mismatch, not a bad route. The agent preset
 * installs into `$DSH_HOME/.agent-presets/`, which every profile scans, and it
 * pins `subagent_validator` to `parametria-vision`; while that route lived in
 * the `parametria` profile, any other profile ran the persona, spawned the
 * validator with the right route config, and killed every child at its first
 * request with `no adapter registered for provider "parametria-vision"`. So the
 * plane the route sits on is now a load-bearing fact, and these tests state it
 * in both directions: the machine block declares the route, and the profile
 * patch does NOT declare it again.
 *
 * The second half is the ownership discipline. `$DSH_HOME/cordis.patch.yml` is
 * upstream's layer for the OPERATOR; this package is a guest between its own
 * markers. `planMachinePatch` is pure so every branch of "never clobber" is
 * checkable here rather than being a property of how carefully the writer was
 * written.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { PACKAGE_ROOT, readComposition } from './helpers.mjs'
import {
  MACHINE_PATCH_BEGIN,
  MACHINE_PATCH_END,
  MACHINE_PATCH_FILENAME,
  MACHINE_PATCH_RECEIPT_KEY,
  RECEIPT_NAME,
  findManagedBlock,
  install,
  machinePatchBlock,
  planMachinePatch,
} from '../scripts/install-profile.mjs'

const homes = []
const freshHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-parametria-machine-'))
  homes.push(home)
  return home
}

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

const digest = (value) => createHash('sha256').update(value).digest('hex')
const block = machinePatchBlock()
const machineRows = readComposition(join(PACKAGE_ROOT, 'machine', MACHINE_PATCH_FILENAME))
const profileRows = readComposition(join(PACKAGE_ROOT, 'profile', MACHINE_PATCH_FILENAME))

describe('which plane declares the route', () => {
  it('declares parametria-vision in the machine-wide block', () => {
    const row = machineRows.find(entry => entry?.id === 'llm-pi-ai')
    assert.ok(row !== undefined, 'the machine block must target the llm-pi-ai row')
    assert.deepEqual(Object.keys(row.config.providers), ['parametria-vision'])
  })

  it('does not declare it a second time in the profile layer', () => {
    // Upstream applies the home layer AFTER the profile's, and an id-targeted
    // patch replaces the row's whole config — so a profile copy would be
    // outranked and could only ever drift into a lie. This is the direction a
    // well-meaning revert would break.
    assert.equal(
      profileRows.find(entry => entry?.id === 'llm-pi-ai'),
      undefined,
      'the profile patch declares llm-pi-ai again; the machine layer outranks it, so the copy can only drift',
    )
  })

  it('keeps the profile layer to the row it still owns', () => {
    assert.deepEqual(profileRows.map(entry => entry.id), ['agent-presets'])
  })
})

describe('planning a write into the operator\'s machine patch', () => {
  it('creates the file as exactly a header and one copy of the block', () => {
    // The WHOLE document, not just "the block is findable in it":
    // `findManagedBlock` returns the first match, so a probe for it passes on a
    // file carrying the block twice — which is what a careless edit to this
    // branch produces, and what a mutation of it slipped past.
    const plan = planMachinePatch(undefined, block)
    assert.equal(plan.action, 'create')
    assert.equal(plan.next.split(MACHINE_PATCH_BEGIN).length - 1, 1, 'the block must appear exactly once')
    assert.equal(plan.next.endsWith(`${block}\n`), true)
    assert.equal(plan.next.slice(0, plan.next.length - `${block}\n`.length).trimEnd().startsWith('# $DSH_HOME/'), true)
  })

  it('appends to an operator-authored file without touching a byte of it', () => {
    const existing = '- id: session-cost\n  name: dsh-plugin-session-cost\n'
    const plan = planMachinePatch(existing, block)
    assert.equal(plan.action, 'append')
    assert.ok(plan.next.startsWith(existing), 'the operator\'s own entries must survive verbatim')
    assert.equal(findManagedBlock(plan.next).text, block)
  })

  it('reports an unchanged block rather than rewriting the file', () => {
    const { next } = planMachinePatch(undefined, block)
    assert.deepEqual(planMachinePatch(next, block), { action: 'unchanged' })
  })

  it('replaces only its own block on a version bump, leaving the rest in place', () => {
    const existing = `# operator header\n\n${block}\n\n- id: session-cost\n`
    const nextBlock = `${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n  config: {}\n${MACHINE_PATCH_END}`
    const plan = planMachinePatch(existing, nextBlock, { previousDigest: digest(block) })
    assert.equal(plan.action, 'update')
    assert.ok(plan.next.startsWith('# operator header\n'))
    assert.ok(plan.next.includes('- id: session-cost'))
    assert.equal(findManagedBlock(plan.next).text, nextBlock)
  })

  it('refuses a machine patch that already targets the llm-pi-ai row itself', () => {
    // Two entries for one row is legal upstream — the later replaces the
    // earlier's whole config — so appending would silently delete one of the
    // two intents. Refusing is the only answer that keeps both visible.
    const plan = planMachinePatch('- id: llm-pi-ai\n  config:\n    providers: {}\n', block)
    assert.equal(plan.action, 'conflict')
    assert.match(plan.reason, /already targets the llm-pi-ai row/u)
  })

  it('refuses a block edited since it was written, and --force releases that', () => {
    const edited = `${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n  config: {}\n${MACHINE_PATCH_END}`
    const previousDigest = digest(block)
    assert.equal(planMachinePatch(edited, block, { previousDigest }).action, 'conflict')
    assert.equal(planMachinePatch(edited, block, { previousDigest, force: true }).action, 'update')
  })

  it('refuses a block it has no receipt for', () => {
    // Someone else's markers, or a receipt the operator moved aside: an
    // unknown claim is not this installer's to overwrite.
    const plan = planMachinePatch(`${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n${MACHINE_PATCH_END}`, block)
    assert.equal(plan.action, 'conflict')
    assert.match(plan.reason, /no receipt/u)
  })

  it('refuses an opening marker with no closing one instead of guessing its extent', () => {
    const plan = planMachinePatch(`${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n`, block)
    assert.equal(plan.action, 'conflict')
    assert.match(plan.reason, /no closing marker/u)
  })
})

describe('installing the machine-wide route', () => {
  it('writes the block, records its digest, and re-installs idempotently', () => {
    const home = freshHome()
    const first = install({ home })
    assert.equal(first.machinePatch.action, 'create')
    const path = join(home, MACHINE_PATCH_FILENAME)
    assert.equal(findManagedBlock(readFileSync(path, 'utf8')).text, block)
    const receipt = JSON.parse(readFileSync(join(home, 'profiles', 'parametria', RECEIPT_NAME), 'utf8'))
    assert.equal(receipt.files[MACHINE_PATCH_RECEIPT_KEY], digest(block))
    assert.equal(install({ home }).machinePatch.action, 'unchanged')
  })

  it('refuses before writing anything when the machine patch conflicts', () => {
    // The refusal has to come first for the same reason `--default`'s does: a
    // run that stops half way has already changed the machine.
    const home = freshHome()
    writeFileSync(join(home, MACHINE_PATCH_FILENAME), '- id: llm-pi-ai\n  config: {}\n')
    assert.throws(() => install({ home }), /refusing to edit the machine-wide patch layer/u)
    assert.throws(
      () => readFileSync(join(home, 'profiles', 'parametria', 'package.json'), 'utf8'),
      { code: 'ENOENT' },
      'the profile files must not land when the machine patch is refused',
    )
  })

  it('leaves the file alone on a rehearsal, and says so', () => {
    const home = freshHome()
    const result = install({ home, dryRun: true })
    assert.equal(result.machinePatch.action, 'would-create')
    assert.throws(() => readFileSync(join(home, MACHINE_PATCH_FILENAME), 'utf8'), { code: 'ENOENT' })
  })
})
