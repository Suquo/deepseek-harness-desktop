/**
 * Fences over the `parametria-vision` route — the half of issue #1 that makes
 * a blind validator impossible rather than merely unlikely.
 *
 * The route is hand-declared, so it inherits NOTHING from the installed pi-ai
 * catalog: an unstated capacity silently falls back to the route defaults
 * (262,144 context / 32,768 output) and shrinks the model, and an unstated
 * `input` falls back to `[text]`, which is the exact failure this route exists
 * to prevent. Every declared value is therefore diffed against the installed
 * catalog entry, so an upstream pin that changes the model's real shape fails
 * the gate instead of quietly mis-sizing or blinding the validator.
 *
 * The route is read from `machine/cordis.patch.yml` — the block the installer
 * merges into `$DSH_HOME/cordis.patch.yml` — because the preset that pins it is
 * machine-wide too. `tests/machine-patch.test.mjs` holds the plane itself: that
 * the profile layer no longer declares this route and the machine layer does.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PACKAGE_ROOT, indexRows, openrouterCatalogEntry, readComposition } from './helpers.mjs'

const MODEL_ID = 'google/gemini-3.6-flash'
const patchPath = join(PACKAGE_ROOT, 'machine', 'cordis.patch.yml')
const patchText = readFileSync(patchPath, 'utf8')
const providers = readComposition(patchPath)
  .find(entry => entry?.id === 'llm-pi-ai')
  .config.providers
const route = providers['parametria-vision']
const model = route.models.find(entry => entry.id === MODEL_ID)
const catalog = openrouterCatalogEntry(MODEL_ID)
const validator = indexRows(readComposition(join(PACKAGE_ROOT, 'preset', 'agent.cordis.yml')))
  .get('delegation/tool-subagent-validator')

describe('the preset and the machine-wide layer agree on the route', () => {
  // The coupling is a plain string match across two files in two different
  // planes — the preset's `agentOptions.provider` (agent plane) and the machine
  // block's `providers` dict key (host plane). Nothing in either file
  // references the other, so a one-sided rename produces
  // `LlmError('UNKNOWN_PROVIDER')` at request time rather than at composition
  // time. These assertions state the invariant where it can be checked.
  it('pins the validator to a route the machine block actually declares', () => {
    assert.ok(
      Object.hasOwn(providers, validator.config.agentOptions.provider),
      `the validator pins route "${validator.config.agentOptions.provider}", `
      + `which machine/cordis.patch.yml does not declare (declared: ${Object.keys(providers).join(', ')})`,
    )
  })

  it('pins the validator to a model that route actually serves', () => {
    assert.ok(
      route.models.some(entry => entry.id === validator.config.agentOptions.model),
      `the validator pins model "${validator.config.agentOptions.model}", which the route does not list`,
    )
  })
})

describe('the parametria-vision route', () => {
  it('is serviceable: a hand-declared route needs api, baseURL, and a non-empty models list', () => {
    // Resolution refuses the whole route otherwise, which would take the
    // validator's model with it.
    assert.equal(typeof route.api, 'string')
    assert.equal(typeof route.baseURL, 'string')
    assert.ok(Array.isArray(route.models) && route.models.length > 0)
  })

  it('references a credential rather than carrying one', () => {
    // `apiKeyEnv` is resolved per request through ctx.credentials, so no
    // secret belongs in this repository.
    assert.equal(route.apiKeyEnv, 'OPENROUTER_API_KEY')
    assert.doesNotMatch(patchText, /sk-[A-Za-z0-9_-]{8}/, 'the patch file appears to contain a literal API key')
  })

  it('declares no route-level defaultInput that could mask a missing entry modality', () => {
    // A route default would answer for any model whose entry says nothing,
    // which would hide exactly the mistake the entry-level fence below
    // catches.
    assert.equal(route.defaultInput, undefined)
  })

  it('serves exactly the one model the validator is pinned to', () => {
    assert.deepEqual(route.models.map(entry => entry.id), [MODEL_ID])
  })
})

describe(`the ${MODEL_ID} entry against the installed pi-ai catalog`, () => {
  it('names a model the installed catalog still ships', () => {
    assert.ok(
      catalog !== undefined,
      `the installed pi-ai catalog no longer ships ${MODEL_ID}; the route would serve a model nothing can verify`,
    )
  })

  it('accepts images', () => {
    // The load-bearing declaration: the harness refuses an image BEFORE it is
    // attached when the resolved modalities omit one, naming the model. Absent
    // this, a validator reads a screenshot as absent and reports a clean pass.
    assert.deepEqual(model.input, ['text', 'image'])
    assert.deepEqual(catalog.input, ['text', 'image'], 'the catalog no longer declares image input for this model')
  })

  it('matches the catalog endpoint and protocol', () => {
    assert.equal(route.api, catalog.api)
    assert.equal(route.baseURL, catalog.baseUrl)
  })

  it('matches the catalog capacities, so nothing falls back to the route guesses', () => {
    assert.equal(model.contextWindow, catalog.contextWindow)
    assert.equal(model.maxTokens, catalog.maxTokens)
  })

  it('speaks the catalog\'s reasoning dialect', () => {
    assert.equal(route.compat.thinkingFormat, catalog.compat.thinkingFormat)
  })

  it('keeps the model reasoning-capable, as the catalog describes it', () => {
    // A hand-declared model that declares no `reasoningEfforts` does not
    // reason at all, which would silently downgrade it.
    assert.equal(catalog.reasoning, true)
    assert.deepEqual(Object.keys(model.reasoningEfforts).sort(), ['high', 'off'])
    // `off:` is valueless on purpose — Off is offered and sends nothing.
    assert.equal(model.reasoningEfforts.off, null)
    assert.equal(model.reasoningEfforts.high, 'high')
  })

  it('carries the catalog display name', () => {
    assert.equal(model.name, catalog.name)
  })
})
