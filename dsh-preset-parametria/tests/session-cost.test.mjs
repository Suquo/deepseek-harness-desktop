/**
 * Fences for the per-generation cost and per-step timing join.
 *
 * Two things are held here that a reader of the numbers alone cannot check:
 *
 * 1. An unknown price never becomes a zero. Every way of not knowing a rate is
 *    a distinct, reported state, and none of them is allowed to be absorbed
 *    into a total that then reads like a complete one.
 * 2. The price-source measurement recorded on issue #5 is reproducible from
 *    this tree. The two rate sets in `RATE_SOURCES` are the pinned pi-ai
 *    catalogue's and OpenRouter's live `/api/v1/models` values for the same
 *    model on the same date, and the fence asserts the 2x gap between them —
 *    so if either is ever re-seeded, the fence fails rather than letting the
 *    "a shipped table drifts" finding quietly stop being true.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FREE, PRICED, SessionCostError, UNPRICED, UNTOKENIZED,
  BILLED, STATUSES, foldRunTelemetry, parseSessionEvents, priceRun, priceStep, responseIdOf,
  withBilledCost,
} from '../scripts/session-cost.mjs'

/** The fixture run's real totals, harvested from the operator's session export (issue #6). */
const FIXTURE_TOTALS = { inputTokens: 450139, cacheReadTokens: 1486141, outputTokens: 31209, cacheWriteTokens: 0 }

/**
 * `google/gemini-3.6-flash` in USD per million tokens, from the two candidate
 * table sources, measured 2026-08-20.
 */
const RATE_SOURCES = {
  /** `@earendil-works/pi-ai/dist/providers/data/openrouter.json`, catalogue generated 2026-07-25. */
  pinnedCatalogue: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0.083333 },
  /** `GET https://openrouter.ai/api/v1/models`, public and unauthenticated. */
  liveModelsApi: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0416666666666667 },
}

function assistantMessage({ turn, step, time, usage, provider = 'openrouter', model = 'google/gemini-3.6-flash', responseId }) {
  return {
    type: 'assistant/message', time,
    data: {
      turn, step,
      ...usage === undefined ? {} : { usage },
      message: {
        role: 'assistant', content: [],
        source: {
          kind: 'model', provider, model,
          ...responseId === undefined ? {} : { replayState: { response: { kind: 'pi-ai', version: 2, responseId } } },
        },
      },
    },
  }
}

/** One turn, two steps: the first calls a tool, the second answers. */
function fixtureEvents() {
  return [
    { type: 'session', id: 'session-fixture', createdAt: 1000 },
    { type: 'turn/start', time: 1000, data: { turn: 1 } },
    { type: 'step/start', time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage({ turn: 1, step: 1, time: 3000, usage: { inputTokens: 100, outputTokens: 10 }, responseId: 'gen-aaa' }),
    { type: 'tool/call', time: 3000, data: { turn: 1, step: 1, callId: 'call_1', name: 'pwsh' } },
    { type: 'tool/result', time: 4500, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'call_1' } } } },
    { type: 'step/end', time: 5000, data: { turn: 1, step: 1 } },
    { type: 'step/start', time: 5000, data: { turn: 1, step: 2 } },
    assistantMessage({ turn: 1, step: 2, time: 6000, usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 }, responseId: 'gen-bbb' }),
    { type: 'step/end', time: 7000, data: { turn: 1, step: 2 } },
    { type: 'turn/end', time: 7000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

const FLASH_TABLE = { openrouter: { 'google/gemini-3.6-flash': RATE_SOURCES.liveModelsApi } }

/** Money is summed bucket by bucket, so an expectation written as one expression differs in the last bit. */
function assertUsd(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `expected ${String(actual)} to equal ${String(expected)} within a float ulp`,
  )
}

test('the fold attributes timing, tokens, model and the OpenRouter generation id per step', () => {
  const { steps, sessionId } = foldRunTelemetry(fixtureEvents())
  assert.equal(sessionId, 'session-fixture')
  assert.equal(steps.length, 2)

  const [first, second] = steps
  // Wall time is step/start -> step/end; llmMs is step/start -> assistant/message,
  // which is the `sessionStats` projection's own definition, so the two compare.
  assert.deepEqual(
    { wallMs: first.wallMs, llmMs: first.llmMs, toolMs: first.toolMs },
    { wallMs: 4000, llmMs: 2000, toolMs: 1500 },
  )
  assert.deepEqual(
    { wallMs: second.wallMs, llmMs: second.llmMs, toolMs: second.toolMs },
    { wallMs: 2000, llmMs: 1000, toolMs: 0 },
  )
  assert.deepEqual(
    steps.map(step => ({ provider: step.provider, model: step.model, responseId: step.responseId })),
    [
      { provider: 'openrouter', model: 'google/gemini-3.6-flash', responseId: 'gen-aaa' },
      { provider: 'openrouter', model: 'google/gemini-3.6-flash', responseId: 'gen-bbb' },
    ],
  )
  assert.deepEqual(first.toolNames, ['pwsh'])
})

test('a step with no responseId folds without one rather than inventing a join key', () => {
  const events = fixtureEvents().map(event => (
    event.type === 'assistant/message' && event.data.step === 2
      ? assistantMessage({ turn: 1, step: 2, time: 6000, usage: { inputTokens: 20, outputTokens: 5 } })
      : event
  ))
  const { steps } = foldRunTelemetry(events)
  assert.equal(steps[1].responseId, undefined)
  assert.equal(responseIdOf({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }), undefined)
})

test('the four buckets are priced disjointly and never double counted', () => {
  // 100 uncached in + 10 out, at 0.75 / 3.75 per Mtok.
  const line = priceStep(
    { usage: { inputTokens: 100, outputTokens: 10 }, provider: 'openrouter', model: 'google/gemini-3.6-flash' },
    FLASH_TABLE,
  )
  assert.equal(line.status, PRICED)
  assertUsd(line.usd, (0.75 * 100 + 3.75 * 10) / 1e6)

  // A cacheRead-heavy step must be rated at the cacheRead rate, not the input
  // rate: pi-ai computes `input = prompt_tokens - cacheRead - cacheWrite`
  // (openai-completions.js), so adding the two together would bill the same
  // tokens twice at ten times the rate.
  const cached = priceStep(
    { usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 }, provider: 'openrouter', model: 'google/gemini-3.6-flash' },
    FLASH_TABLE,
  )
  assertUsd(cached.usd, (0.75 * 20 + 3.75 * 5 + 0.075 * 90) / 1e6)
})

test('a model with no table entry is unpriced, kept out of the total, and named', () => {
  const { summary } = priceRun(foldRunTelemetry(fixtureEvents()).steps, { openrouter: {} })
  assert.equal(summary.usd, 0)
  assert.equal(summary.pricedSteps, 0)
  assert.equal(summary.covered, false)
  assert.equal(summary.unpriced.length, 2)
  assert.equal(summary.unpriced[0].status, UNPRICED)
  assert.match(summary.unpriced[0].reason, /no price entry for openrouter\/google\/gemini-3\.6-flash/)
  // The tokens are still reported in full — not knowing a rate is not a reason
  // to blank a surface (fail-open).
  assert.equal(summary.totals.inputTokens, 120)
  assert.equal(summary.totals.outputTokens, 15)
})

test('an unpriced step never lets a partial total pass as the run cost', () => {
  const table = { openrouter: { 'google/gemini-3.6-flash': RATE_SOURCES.liveModelsApi } }
  const events = fixtureEvents().map(event => (
    event.type === 'assistant/message' && event.data.step === 2
      ? assistantMessage({ turn: 1, step: 2, time: 6000, usage: { inputTokens: 20, outputTokens: 5 }, model: 'x-ai/grok-4.5' })
      : event
  ))
  const { summary } = priceRun(foldRunTelemetry(events).steps, table)
  assert.equal(summary.pricedSteps, 1)
  assert.equal(summary.steps, 2)
  // `covered` is the claim a caller must consult before calling `usd` the cost.
  assert.equal(summary.covered, false)
  assert.ok(summary.usd > 0)
})

test('a rated-zero model is free, which is a different state from unpriced', () => {
  const free = priceStep(
    { usage: { inputTokens: 100, outputTokens: 10 }, provider: 'openrouter', model: 'a/free' },
    { openrouter: { 'a/free': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  )
  assert.equal(free.status, FREE)
  assert.equal(free.usd, 0)
  const unknown = priceStep(
    { usage: { inputTokens: 100, outputTokens: 10 }, provider: 'openrouter', model: 'openrouter/auto' },
    { openrouter: {} },
  )
  assert.equal(unknown.status, UNPRICED)
  assert.equal(unknown.usd, undefined)
  // Both would render "$0.0000" under a naive report. They must not compare equal.
  assert.notEqual(free.status, unknown.status)
})

test('the offline seam mirrors billed without performing reconciliation', () => {
  const estimate = priceStep(
    { usage: { inputTokens: 100 }, provider: 'openrouter', model: 'google/gemini-3.6-flash' },
    FLASH_TABLE,
  )
  const billed = withBilledCost(estimate, 0)
  assert.deepEqual(billed, { status: BILLED, usd: 0, estimate })
  assert.deepEqual(STATUSES, [PRICED, FREE, UNPRICED, UNTOKENIZED, BILLED])
  assert.throws(() => withBilledCost(estimate, -1), /finite nonnegative/)
})

test('a table that rates only some of the buckets the run used prices none of them', () => {
  // The trap: `cacheRead` missing while the step is 90% cache reads would
  // silently drop that bucket and understate the step by an order of magnitude.
  const partial = priceStep(
    { usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 }, provider: 'openrouter', model: 'a/partial' },
    { openrouter: { 'a/partial': { input: 0.75, output: 3.75 } } },
  )
  assert.equal(partial.status, UNPRICED)
  assert.match(partial.reason, /no cacheRead rate, and the step used 90 cacheRead tokens/)

  // The same table is fine for a step that used no cache reads at all: a rate
  // is only required for a bucket that carries tokens.
  const clean = priceStep(
    { usage: { inputTokens: 20, outputTokens: 5 }, provider: 'openrouter', model: 'a/partial' },
    { openrouter: { 'a/partial': { input: 0.75, output: 3.75 } } },
  )
  assert.equal(clean.status, PRICED)
})

test('a step that recorded no usage is untokenized, not free and not priced', () => {
  const line = priceStep({ provider: 'openrouter', model: 'google/gemini-3.6-flash' }, FLASH_TABLE)
  assert.equal(line.status, UNTOKENIZED)
  assert.equal(line.usd, undefined)
})

test('the pinned pi-ai catalogue prices the harvested run at exactly twice the live table', () => {
  const row = { usage: FIXTURE_TOTALS, provider: 'openrouter', model: 'google/gemini-3.6-flash' }
  const catalogue = priceStep(row, { openrouter: { 'google/gemini-3.6-flash': RATE_SOURCES.pinnedCatalogue } })
  const live = priceStep(row, { openrouter: { 'google/gemini-3.6-flash': RATE_SOURCES.liveModelsApi } })
  assert.equal(catalogue.status, PRICED)
  assert.equal(live.status, PRICED)
  assert.equal(live.usd.toFixed(4), '0.5661')
  assert.equal(catalogue.usd.toFixed(4), '1.1322')
  assert.equal((catalogue.usd / live.usd).toFixed(3), '2.000')
})

test('a malformed log is refused by name rather than folded into a partial run', () => {
  assert.throws(() => parseSessionEvents('{"type":"session"}\nnot json\n'), SessionCostError)
  assert.throws(() => parseSessionEvents('{"type":"session"}\nnot json\n'), /line 2 is not valid JSON/)
})
