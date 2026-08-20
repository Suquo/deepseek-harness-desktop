/**
 * The rule issue #53 earned: this preset never declares a valueless `off:` in
 * a `reasoningEfforts` block.
 *
 * The premise that spelling was written on — upstream's own, at
 * `packages/llm/llm-pi-ai/src/catalog.ts:657-661` — is that a declared-but-
 * valueless `off` means "offer Off, send nothing". MEASURED at the current pin
 * it is dialect-specific, and false for the dialect this preset's only route
 * speaks. Under `thinkingFormat: openrouter` the valueless spelling leaves
 * `thinkingLevelMap.off` ABSENT rather than `null` (`catalog.ts:711-719`), and
 * pi-ai's OpenRouter branch (`dist/api/openai-completions.js:598-608`) reads
 * "absent" as "send the disable":
 *
 *   else if (model.thinkingLevelMap?.off !== null) {
 *       openRouterParams.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
 *   }
 *
 * (`openRouterParams` is the request params object itself, aliased one line
 * earlier at `:600` — quoted verbatim so the branch is greppable.)
 *
 * Two validator children died on that body — OpenRouter
 * `400 Reasoning is mandatory for this endpoint and cannot be disabled` — on
 * 2026-08-20 (sessions de0ce2b8, 2c7adafa).
 *
 * So: a level key either carries the wire spelling it intends to send, or it
 * is not declared at all. "Declared with nothing" is the one form that means
 * different things to different dialects, which is exactly what a preset
 * shipped to a machine cannot afford.
 *
 * This is the STATIC half, and it is a sweep rather than a route-specific
 * assertion so a second route added later inherits it. The wire behaviour it
 * stands for is measured end-to-end, both directions, in
 * `dsh-plugin-desktop/tests/parametria-reasoning-wire.spec.ts`.
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PACKAGE_ROOT, readComposition } from './helpers.mjs'

/**
 * Every YAML document this package ships, by package-relative path.
 *
 * Deliberately broad — the point is that a route added to a file nobody thought
 * of still inherits the rule — so the only exclusions are `node_modules` and
 * this directory. The cost of the breadth is that every shipped YAML must be
 * parseable as a composition document, which for a package whose YAML IS its
 * product is a property worth failing on rather than an accident to tolerate.
 */
function shippedYamlFiles(root = PACKAGE_ROOT, found = []) {
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === 'tests') continue
    const path = join(root, name)
    if (statSync(path).isDirectory()) shippedYamlFiles(path, found)
    else if (name.endsWith('.yml') || name.endsWith('.yaml')) found.push(path)
  }
  return found
}

/**
 * Every `reasoningEfforts` block in one parsed document, with enough of its
 * surroundings to name in a failure. Found by walking rather than by the path
 * we expect it at: a block that moves to `modelOverrides`, to a second route,
 * or into a profile patch is the case this sweep exists to still catch.
 */
function reasoningEffortBlocks(value, path, found = []) {
  if (value === null || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) {
    const where = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`
    if (key === 'reasoningEfforts') found.push({ where, efforts: child })
    reasoningEffortBlocks(child, where, found)
  }
  return found
}

const blocks = shippedYamlFiles().flatMap((file) => {
  const label = relative(PACKAGE_ROOT, file).replaceAll('\\', '/')
  return reasoningEffortBlocks(readComposition(file), label)
})

describe('every reasoningEfforts this preset ships', () => {
  it('is actually found by the sweep, so the rule below cannot pass vacuously', () => {
    // Without this, deleting the route — or renaming the field — would turn
    // the rule into an assertion about an empty list.
    assert.ok(
      blocks.length > 0,
      'no reasoningEfforts block was found in any shipped YAML; the sweep below would assert nothing',
    )
  })

  it('never declares a valueless `off:`, which manufactures a reasoning-disable on the wire', () => {
    for (const { where, efforts } of blocks) {
      // `false` is a whole-model declaration ("this model does not reason") and
      // carries no level keys, so it is outside this rule.
      if (efforts === false || efforts === null || typeof efforts !== 'object') continue
      if (!Object.hasOwn(efforts, 'off')) continue
      assert.notEqual(
        efforts.off,
        null,
        `${where}.off is declared with no value. Upstream documents that as "offer Off, send nothing", but`
        + ' under thinkingFormat openrouter it sends {"reasoning":{"effort":"none"}} and OpenRouter answers'
        + ' 400 "Reasoning is mandatory for this endpoint and cannot be disabled" (issue #53). Give `off` the'
        + ' wire spelling you intend to send, or omit the key — an omitted level is pinned to null, which is'
        + ' the state that sends no field at all.',
      )
    }
  })

  it('gives every declared level a non-empty wire spelling', () => {
    // The same rule, stated for the levels upstream refuses outright
    // (`catalog.ts:697-706` allows a null value ONLY on `off`): catching it
    // here names the file and key instead of failing the whole route at mount.
    for (const { where, efforts } of blocks) {
      if (efforts === false || efforts === null || typeof efforts !== 'object') continue
      for (const [level, wire] of Object.entries(efforts)) {
        assert.equal(typeof wire, 'string', `${where}.${level} must carry the wire spelling to send`)
        assert.notEqual(wire.length, 0, `${where}.${level} must not be an empty string`)
      }
    }
  })
})
