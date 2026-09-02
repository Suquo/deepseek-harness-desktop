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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  refuseMachinePatchMessage,
  writeMachinePatch,
} from '../scripts/install-profile.mjs'

/** The operator-facing refusal one conflict plan produces. */
const refusalFor = (plan) => refuseMachinePatchMessage('C:\\Users\\someone\\.dsh\\cordis.patch.yml', plan)

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

  it('keeps the profile layer to the rows it still owns', () => {
    // One id-targeted row (the preset default) plus one id-less insert entry
    // (the two subagent provider mounts — pinned exhaustively by
    // profile-patch.test.mjs; this fence only keeps the SHAPE of the layer
    // from growing unnoticed).
    assert.deepEqual(profileRows.map(entry => entry.id), ['agent-presets', undefined])
    assert.deepEqual(
      profileRows.filter(entry => entry.id === undefined).map(entry => Object.keys(entry)),
      [['insert']],
    )
  })
})

describe('the machine block\'s own shape', () => {
  // The structural guards `tests/profile-patch.test.mjs` puts on the profile
  // layer, carried to this one — and they matter MORE here, because upstream
  // applies this layer last, so a stray key here outranks the same key there.
  it('is a top-level list, which is the only shape the loader accepts', () => {
    // A patch file that parses to anything else throws at boot — and this file
    // is merged into a document that governs EVERY profile, so that boot
    // failure would not be scoped to the Parametria one.
    assert.ok(Array.isArray(machineRows))
    assert.ok(machineRows.length > 0)
  })

  it('changes rows through `config` and nothing else', () => {
    // Every key beyond `id`/`name` is copied onto the target ROW, not merged
    // into its config: a `disabled: true`, a `group`, or an `isolate` realm
    // added here would unmount or relocate `llm-pi-ai` for every profile on the
    // machine, while the route-shape fences in `vision-route.test.mjs` kept
    // passing, because those only ever look inside `config`.
    for (const entry of machineRows) {
      assert.deepEqual(
        Object.keys(entry).sort(), ['config', 'id'],
        `machine entry ${entry.id} carries a key beyond id/config`,
      )
    }
  })

  it('targets exactly the one row it exists for, and inserts nothing', () => {
    // A closed set, in both directions: this block rides in the operator's own
    // machine-wide file, so anything it targets beyond the validator's route is
    // reach this package never asked for.
    assert.deepEqual(machineRows.map(entry => entry.id), ['llm-pi-ai'])
    assert.deepEqual(machineRows.filter(entry => entry?.insert !== undefined), [])
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
    assert.match(plan.reason, /mentions the llm-pi-ai row outside/u)
  })

  it('checks for that row on EVERY branch, not only where it appends', () => {
    // The branch an already-installed machine takes. An operator row added
    // after our block is applied after it too, replacing the row's whole config
    // — so "unchanged, route already current" would be a successful install
    // over a dead route: issue #1's silent success, rebuilt on the new plane.
    const theirRow = '\n- id: llm-pi-ai\n  config:\n    providers: {}\n'
    const installed = planMachinePatch(undefined, block).next
    for (const [branch, existing] of [
      ['unchanged', `${installed}${theirRow}`],
      ['update', `${installed.replace('- id: llm-pi-ai', '- id: llm-pi-ai # edited')}${theirRow}`],
      ['append', `# just theirs\n${theirRow}`],
    ]) {
      const plan = planMachinePatch(existing, block, { previousDigest: digest(block) })
      assert.equal(plan.action, 'conflict', `the ${branch} branch skipped the llm-pi-ai check`)
      assert.equal(plan.releasable, false)
    }
  })

  it('catches spellings a line-shaped pattern would miss', () => {
    // No YAML parser is available here (node builtins only), so the check is a
    // deliberately over-broad substring rather than a line pattern: flow style,
    // a trailing comment, and a quoted id all have to refuse, because the
    // failure it prevents is silent and a false refusal is not.
    for (const existing of [
      '- {id: llm-pi-ai, config: {}}\n',
      '- id: llm-pi-ai # mine\n',
      "- id: 'llm-pi-ai'\n",
    ]) {
      assert.equal(planMachinePatch(existing, block).action, 'conflict', existing)
    }
  })

  it('refuses a second managed block rather than writing under it', () => {
    // Two copies and the LAST one wins, so a stale duplicate outranks the block
    // just written — the same upstream rule, with our own text on both sides.
    const doubled = `${planMachinePatch(undefined, block).next}\n${block}\n`
    assert.equal(planMachinePatch(doubled, block, { previousDigest: digest(block) }).action, 'conflict')
  })

  it('refuses to append to a document that is not a block sequence', () => {
    // `[]` is a VALID empty patch list — `prepareDesktopProfile` writes exactly
    // that for a root config — and appending `- …` to it produces YAML upstream
    // refuses to parse. Upstream is fail-loud there ("must fail loud at boot,
    // never be silently skipped"), so this would take a working machine and
    // stop it booting under EVERY profile, reported as a successful install.
    for (const existing of ['[]\n', 'insert: []\n', 'just-a-scalar\n']) {
      const plan = planMachinePatch(existing, block)
      assert.equal(plan.action, 'conflict', existing)
      assert.match(plan.reason, /not a block-sequence document/u)
      assert.equal(plan.releasable, false)
    }
  })

  it('still appends to the shapes that can take an entry', () => {
    for (const existing of ['# only comments\n', '- id: session-cost\n', '\n\n', '- id: x\n  config:\n    a: 1\n']) {
      assert.equal(planMachinePatch(existing, block).action, 'append', existing)
    }
  })

  it('offers --force only where --force actually releases something', () => {
    // A refusal that advertises a flag which will refuse again is a loop, and
    // `--force` releases this installer's claim over its OWN block — never the
    // operator's configuration, and never a block whose extent is unknown. The
    // two halves are asserted together so neither can drift alone.
    const releasable = [
      planMachinePatch(`${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n${MACHINE_PATCH_END}`, block),
      planMachinePatch(
        `${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n  config: {}\n${MACHINE_PATCH_END}`,
        block,
        { previousDigest: digest(block) },
      ),
    ]
    for (const plan of releasable) {
      assert.equal(plan.releasable, true, plan.reason)
      assert.match(refusalFor(plan), /re-run with --force/u)
      assert.equal(planMachinePatch(
        `${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n${MACHINE_PATCH_END}`,
        block,
        { force: true },
      ).action, 'update')
    }
    const unreleasable = [
      planMachinePatch('- id: llm-pi-ai\n  config: {}\n', block, { force: true }),
      planMachinePatch(`${MACHINE_PATCH_BEGIN}\n- id: llm-pi-ai\n`, block, { force: true }),
    ]
    for (const plan of unreleasable) {
      assert.equal(plan.action, 'conflict', 'force must not lift a refusal over the operator\'s own content')
      assert.equal(plan.releasable, false, plan.reason)
      assert.doesNotMatch(
        refusalFor(plan),
        /re-run with --force/u,
        'this refusal must not advertise a flag that refuses again',
      )
      assert.match(refusalFor(plan), /--force does NOT release this one/u)
    }
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

  it('writes through a temp file and leaves none behind', () => {
    // A truncating write of a document upstream parses strictly is not a lost
    // edit but an unbootable machine, under every profile, so the contents land
    // by rename. The temp name is this installer's, and it must not survive.
    const home = freshHome()
    install({ home })
    const strays = readdirSync(home).filter(name => name.includes('.tmp'))
    assert.deepEqual(strays, [], `left a temporary file behind: ${strays.join(', ')}`)
  })

  it('refuses when the file changed under the plan, rather than clobbering the change', () => {
    // The plan is computed from a snapshot and nothing at the syscall enforces
    // it, so the writer re-verifies. Staged at the writer because that is where
    // the window is: a file that appeared after a `create` was planned.
    const home = freshHome()
    const path = join(home, MACHINE_PATCH_FILENAME)
    const theirs = '- id: session-cost\n  name: dsh-plugin-session-cost\n'
    writeFileSync(path, theirs)
    assert.throws(
      () => writeMachinePatch(path, planMachinePatch(undefined, block).next, undefined),
      /changed while this install was running/u,
    )
    assert.equal(readFileSync(path, 'utf8'), theirs, 'the file that appeared must survive untouched')
  })

  it('leaves the file alone on a rehearsal, and says so', () => {
    const home = freshHome()
    const result = install({ home, dryRun: true })
    assert.equal(result.machinePatch.action, 'would-create')
    assert.throws(() => readFileSync(join(home, MACHINE_PATCH_FILENAME), 'utf8'), { code: 'ENOENT' })
  })
})
