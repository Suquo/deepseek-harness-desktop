import { describe, expect, it } from 'vitest'
import type { AssistantMessageNode, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { RateTable } from '../src/client/cost-model.ts'
import { costHeadline, costProvenance, foldGeneration, foldTurnCost, rateProvenance, turnOfMessage } from '../src/client/turn-cost.ts'

const TABLE: RateTable = {
  openrouter: { 'google/gemini-3.6-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 } },
}

interface StepFixture {
  turn: number
  step: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  model?: string
  start?: number
  firstToken?: number
  completed?: number
  messageId?: string
  noUsage?: true
}

function assistant(fixture: StepFixture): AssistantMessageNode {
  const model = fixture.model ?? 'google/gemini-3.6-flash'
  return {
    kind: 'assistant',
    seq: fixture.turn * 100 + fixture.step,
    time: fixture.completed ?? 0,
    turn: fixture.turn,
    step: fixture.step,
    blocks: [],
    ...fixture.messageId === undefined ? {} : { messageId: fixture.messageId as MessageId },
    ...fixture.noUsage === true ? {} : {
      usage: {
        inputTokens: fixture.inputTokens ?? 0,
        outputTokens: fixture.outputTokens ?? 0,
        cacheReadTokens: fixture.cacheReadTokens ?? 0,
      },
    },
    provenance: { provider: 'openrouter', model },
    timing: {
      stepStartTime: fixture.start ?? null,
      firstTokenTime: fixture.firstToken ?? null,
      completedTime: fixture.completed ?? 0,
    },
  }
}

/** Two steps of one turn: a tool step then the closing answer. */
function twoStepTurn(): ConversationNode[] {
  return [
    assistant({ turn: 1, step: 1, inputTokens: 100, outputTokens: 10, start: 1000, firstToken: 1400, completed: 3000 }),
    assistant({ turn: 1, step: 2, inputTokens: 20, outputTokens: 5, cacheReadTokens: 90, start: 5000, firstToken: 5200, completed: 6000, messageId: 'msg-closing' }),
  ]
}

const TIMINGS = new Map([[1, { startTime: 1000, endTime: 7000 }]])

describe('addressing a turn from the slot owner props', () => {
  it('resolves the turn behind the closing message identity', () => {
    expect(turnOfMessage(twoStepTurn(), 'msg-closing')).toBe(1)
  })

  it('returns undefined for a message the loaded window does not hold', () => {
    // Older turns page out; a badge for one has nothing truthful to report and
    // must render nothing rather than a zero.
    expect(turnOfMessage(twoStepTurn(), 'msg-scrolled-away')).toBeUndefined()
    expect(turnOfMessage([], 'msg-closing')).toBeUndefined()
  })
})

describe('folding one generation', () => {
  it('derives model time and time-to-first-token from the recorded boundaries', () => {
    const line = foldGeneration(assistant({ turn: 1, step: 1, inputTokens: 100, outputTokens: 10, start: 1000, firstToken: 1400, completed: 3000 }), TABLE)
    expect(line).toMatchObject({ turn: 1, step: 1, llmMs: 2000, ttftMs: 400, provider: 'openrouter' })
    expect(line.cost.status).toBe('priced')
  })

  it('omits a duration whose start boundary fell outside the window', () => {
    // `stepStartTime: null` documents exactly this; a duration measured from a
    // missing start would be the epoch, not a latency.
    const line = foldGeneration(assistant({ turn: 1, step: 1, inputTokens: 10, completed: 3000 }), TABLE)
    expect(line.llmMs).toBeUndefined()
    expect(line.ttftMs).toBeUndefined()
  })

  it('reports a generation with no usage record as untokenized, not as free', () => {
    const line = foldGeneration(assistant({ turn: 1, step: 1, noUsage: true, start: 1000, completed: 2000 }), TABLE)
    expect(line.tokens).toBeUndefined()
    expect(line.cost.status).toBe('untokenized')
  })

  it('overlays a provider charge while retaining the original estimate', () => {
    const line = foldGeneration(
      assistant({ turn: 1, step: 1, inputTokens: 100, outputTokens: 10, completed: 2000 }),
      TABLE,
      0,
    )
    expect(line.cost.status).toBe('billed')
    expect(line.cost).toMatchObject({ status: 'billed', usd: 0, estimate: { status: 'priced' } })
  })
})

describe('folding a turn', () => {
  it('sums the buckets, the model time, and the money', () => {
    const cost = foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS)
    expect(cost.generations).toHaveLength(2)
    expect(cost.tokens).toEqual({ inputTokens: 120, outputTokens: 15, cacheReadTokens: 90, cacheWriteTokens: 0 })
    expect(cost.llmMs).toBe(3000)
    expect(cost.covered).toBe(true)
    expect(cost.usd).toBeCloseTo((0.75 * 120 + 3.75 * 15 + 0.075 * 90) / 1e6, 12)
    expect(cost.billedUsd).toBe(0)
    expect(cost.estimatedUsd).toBe(cost.usd)
    expect(cost.billedGenerations).toBe(0)
    expect(cost.estimatedGenerations).toBe(2)
    expect(cost.fullyBilled).toBe(false)
    expect(cost.models).toEqual(['openrouter/google/gemini-3.6-flash'])
  })

  it('separates wall time from model time, which is where the tool cost shows up', () => {
    const cost = foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS)
    // 6000ms wall against 3000ms of model: the other half went to tools. On the
    // harvested run that split was 383.5s of tools against 253.2s of model.
    expect(cost.wallMs).toBe(6000)
    expect(cost.nonModelMs).toBe(3000)
  })

  it('leaves both wall figures undefined while the turn is still open', () => {
    // A difference from an unknown is unknown — not zero.
    const open = foldTurnCost(twoStepTurn(), 1, TABLE, new Map([[1, { startTime: 1000 }]]))
    expect(open.wallMs).toBeUndefined()
    expect(open.nonModelMs).toBeUndefined()
    expect(foldTurnCost(twoStepTurn(), 1, TABLE).wallMs).toBeUndefined()
  })

  it('ignores other turns entirely', () => {
    const nodes = [...twoStepTurn(), assistant({ turn: 2, step: 1, inputTokens: 999999, completed: 9000 })]
    expect(foldTurnCost(nodes, 1, TABLE, TIMINGS).tokens.inputTokens).toBe(120)
  })

  it('marks a turn whose first step paged out, so a partial total is never read as whole', () => {
    const truncated = [assistant({ turn: 1, step: 7, inputTokens: 10, outputTokens: 1, completed: 3000 })]
    expect(foldTurnCost(truncated, 1, TABLE, TIMINGS).stepsOutsideWindow).toBe(true)
    expect(foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS).stepsOutsideWindow).toBe(false)
  })
})

describe('coverage is reported, never absorbed', () => {
  it('keeps an unpriced generation out of the total and drops coverage', () => {
    const mixed = [
      assistant({ turn: 1, step: 1, inputTokens: 100, outputTokens: 10, start: 1000, completed: 3000 }),
      assistant({ turn: 1, step: 2, inputTokens: 40, outputTokens: 4, model: 'x-ai/grok-4.5', start: 5000, completed: 6000 }),
    ]
    const cost = foldTurnCost(mixed, 1, TABLE, TIMINGS)
    expect(cost.covered).toBe(false)
    expect(cost.unpriced).toEqual([{ step: 2, reason: 'no live rate for openrouter/x-ai/grok-4.5' }])
    // The tokens of the unpriced step are still counted and shown: a missing
    // rate is not a reason to blank the telemetry (fail-open).
    expect(cost.tokens.inputTokens).toBe(140)
    expect(cost.usd).toBeCloseTo((0.75 * 100 + 3.75 * 10) / 1e6, 12)
  })

  it('an empty turn is not a covered turn', () => {
    const cost = foldTurnCost([], 1, TABLE, TIMINGS)
    expect(cost.covered).toBe(false)
    expect(cost.generations).toHaveLength(0)
  })
})

describe('the headline a reader sees', () => {
  it('marks a partially priced turn as a floor rather than a total', () => {
    const covered = foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS)
    expect(costHeadline(covered)).toMatch(/^\$0\.\d{4}$/)

    const mixed = foldTurnCost([
      assistant({ turn: 1, step: 1, inputTokens: 100, outputTokens: 10, completed: 3000 }),
      assistant({ turn: 1, step: 2, inputTokens: 40, model: 'x-ai/grok-4.5', completed: 6000 }),
    ], 1, TABLE, TIMINGS)
    expect(costHeadline(mixed).startsWith('≥')).toBe(true)

    const none = foldTurnCost([assistant({ turn: 1, step: 1, inputTokens: 40, model: 'x-ai/grok-4.5', completed: 1 })], 1, TABLE, TIMINGS)
    expect(costHeadline(none)).toBe('unpriced')
    expect(costHeadline(foldTurnCost([], 1, TABLE))).toBe('no generations')
  })

  it('keeps provider-backed and estimated money visibly separate', () => {
    const mixed = foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS, new Map([[1, 0.125]]))
    expect(mixed.billedUsd).toBe(0.125)
    expect(mixed.billedGenerations).toBe(1)
    expect(mixed.estimatedGenerations).toBe(1)
    expect(mixed.covered).toBe(true)
    expect(costHeadline(mixed)).toMatch(/^\$0\.1250 billed \+ ~\$0\.\d{4} est\.$/)

    const billed = foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS, new Map([[1, 0.125], [2, 0]]))
    expect(billed.fullyBilled).toBe(true)
    expect(billed.estimatedUsd).toBe(0)
    expect(costHeadline(billed)).toBe('$0.1250 billed')
  })

  it('lets a billed observation cover an estimate whose list rate was unknown', () => {
    const unknown = [assistant({ turn: 1, step: 1, inputTokens: 40, model: 'x-ai/grok-4.5', completed: 1 })]
    const cost = foldTurnCost(unknown, 1, TABLE, TIMINGS, new Map([[1, 0.5]]))
    expect(cost.covered).toBe(true)
    expect(cost.unpriced).toEqual([])
    expect(costHeadline(cost)).toBe('$0.5000 billed')
    expect(cost.generations[0]?.cost).toMatchObject({
      status: 'billed', estimate: { status: 'unpriced' },
    })
  })

  it('always states where the rates came from, including when they did not arrive', () => {
    expect(rateProvenance(undefined, 0, undefined)).toMatch(/Reading live OpenRouter rates/)
    expect(rateProvenance(undefined, 0, 'Failed to fetch')).toMatch(/unavailable \(Failed to fetch\).*tokens and timings are exact/)
    const stamped = rateProvenance(Date.parse('2026-08-20T09:15:00Z'), 276, undefined)
    expect(stamped).toMatch(/276 live OpenRouter list rates read at /)
    // The estimate must never present itself as the invoice.
    expect(stamped).toMatch(/List price, not the invoice/)
  })

  it('states billed coverage without hiding estimate provenance', () => {
    const cost = foldTurnCost(twoStepTurn(), 1, TABLE, TIMINGS, new Map([[1, 0.1]]))
    const provenance = costProvenance(cost, Date.parse('2026-08-20T09:15:00Z'), 276, undefined)
    expect(provenance).toMatch(/^1 of 2 generations reconciled to OpenRouter billing\./)
    expect(provenance).toMatch(/Estimated from 276 live OpenRouter list rates/)
  })
})
