/**
 * Grounded fence for the validator delegate's delegation-depth cap.
 *
 * The row exists so the persona can MANDATE delegating every visual check to
 * `subagent_validator`. A cap that refuses that spawn makes the mandate
 * unsatisfiable — which is what shipped (issue #18): `maxDepth: 0` produced
 * `Error: subagent depth 1 exceeds maxDepth 0` on every attempt of the first
 * live Parametria run, and the run only verified anything because the
 * orchestrator model happened to be multimodal and read the screenshots itself.
 *
 * The value is therefore not asserted as a literal anyone can re-guess. It is
 * DERIVED from the pinned upstream's own depth arithmetic:
 *
 *   `resolveChildDepth(parent, maxDepth)`
 *   (`deepseek-harness/packages/subagent/subagent/src/child-agent.ts:48-56`)
 *   computes `delegationDepthOf(parent) + 1` and throws `SubagentDepthError`
 *   when that childDepth EXCEEDS `maxDepth`. `maxDepth` is an ABSOLUTE cap on
 *   the child's depth, not a relative budget, and a top-level session agent is
 *   depth 0 (`depth.ts:28-36`) — so this row's child is depth 1.
 *
 * DIVERGENCE DISCLOSURE — read before trusting a green. `delegationDepthOf` and
 * `assertSubagentMaxDepth` are IMPORTED from the pinned upstream and executed
 * here, so the parent-depth reading and the load-time cap validation are the
 * real code. The final comparison (`childDepth > maxDepth` rejects) is the one
 * line reproduced rather than called: `resolveChildDepth` lives in
 * `child-agent.ts`, whose `SubagentDepthError` constructor uses a TypeScript
 * parameter property, and Node's strip-only type stripping refuses to load that
 * file (`TypeScript parameter property is not supported in strip-only mode`).
 * `depth.ts` has no such syntax, which is why the halves that CAN be executed
 * are. If a pin bump makes `child-agent.ts` importable, call it directly and
 * delete this paragraph.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { PACKAGE_ROOT, UPSTREAM_ROOT, indexRows, readComposition } from './helpers.mjs'

const DEPTH_MODULE = join(UPSTREAM_ROOT, 'packages', 'subagent', 'subagent', 'src', 'depth.ts')
// Loaded through Node's built-in type stripping; a pin bump that adds
// non-strippable syntax to this module fails loudly here, which is the signal
// to re-ground rather than to relax the fence.
const { assertSubagentMaxDepth, delegationDepthOf } = await import(pathToFileURL(DEPTH_MODULE).href)

const rows = indexRows(readComposition(join(PACKAGE_ROOT, 'preset', 'agent.cordis.yml')))
const validator = rows.get('delegation/tool-subagent-validator')
const cap = validator.config.maxDepth

/**
 * A freshly started top-level session agent, shaped as `delegationDepthOf`
 * reads one: no runtime `subagentDepth` option and no persisted
 * `delegationDepth` header. This is the parent that runs a Parametria session
 * and calls `subagent_validator`.
 */
const TOP_LEVEL_PARENT = { options: {}, session: { header: {} } }
const PARENT_DEPTH = delegationDepthOf(TOP_LEVEL_PARENT)
const VALIDATOR_DEPTH = PARENT_DEPTH + 1

describe('the validator delegate\'s delegation-depth cap', () => {
  it('reads a top-level Parametria session as depth 0, through upstream\'s own reader', () => {
    assert.equal(
      PARENT_DEPTH, 0,
      'upstream no longer treats a fresh top-level agent as depth 0 — every derivation below rests on this',
    )
  })

  it('declares a numeric cap the upstream loader accepts', () => {
    assert.equal(
      typeof cap, 'number',
      'the `spawn` provider declares `depthLimit: true`, so this row states a real numeric cap; '
      + '`provider-managed` would send NO cap at all',
    )
    // Upstream's own load-time validator: `apply()` runs exactly this call.
    assert.doesNotThrow(() => assertSubagentMaxDepth(cap))
  })

  it('ADMITS the depth-1 child the persona mandates', () => {
    // The bite target. Setting the row back to `maxDepth: 0` fails here by name.
    assert.ok(
      VALIDATOR_DEPTH <= cap,
      `validator row \`maxDepth: ${cap}\` refuses the delegation the persona mandates. `
      + `Upstream starts this child at depth ${VALIDATOR_DEPTH} `
      + `(delegationDepthOf(top-level parent) = ${PARENT_DEPTH}, +1 for the child) and throws `
      + 'SubagentDepthError when the child depth exceeds the cap — the live-run failure in issue #18 '
      + '(`subagent depth 1 exceeds maxDepth 0`). The cap must be at least the depth the child occupies.',
    )
  })

  it('is the tightest such cap, so the validator cannot re-enter this row', () => {
    assert.equal(
      cap, VALIDATOR_DEPTH,
      'a cap above the child\'s own depth would let the validator start a further validator through '
      + 'this same row; a cap below it refuses the mandated spawn. Exactly the child\'s depth is the '
      + 'only value that does neither.',
    )
  })

  it('leaves the plain delegation rows uncapped, as upstream ships them', () => {
    // Stated here because the cap above is easy to over-read: it governs starts
    // made through THIS row only. The sibling rows keep upstream's default of
    // `3`, and capping them was REJECTED as the answer to that (issue #20): it
    // would take the PRIMARY agent's depth-2 delegation away for a problem that
    // is the validator's alone, and it would still miss `ralph` / `workflow`,
    // which request no cap at all. The validator's reach is closed one layer up
    // instead, by this row's `toolFilter` — `validator-leaf.test.mjs` owns that
    // claim. What is left for this assertion is drift: these two rows must keep
    // matching upstream `standard`, which states no cap.
    for (const id of ['delegation/tool-subagent', 'delegation/tool-subagent-fork']) {
      assert.equal(
        rows.get(id).config.maxDepth, undefined,
        `row ${id} gained a depth cap; \`standard\` omits one, so the drift declaration must move first`,
      )
    }
  })
})
