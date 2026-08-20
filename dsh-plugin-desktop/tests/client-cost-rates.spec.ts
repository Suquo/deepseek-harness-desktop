import { describe, expect, it, vi } from 'vitest'
import type { RateSnapshot } from '../src/client/cost-rates.ts'
import {
  NO_RATES, OPENROUTER_MODELS_URL, OPENROUTER_PROVIDER,
  RateSource, fetchOpenRouterRates, parseOpenRouterModels,
} from '../src/client/cost-rates.ts'

/** A trimmed `GET /api/v1/models` body in the shape OpenRouter really returns. */
const PAYLOAD = {
  data: [
    {
      id: 'google/gemini-3.6-flash',
      pricing: {
        prompt: '0.00000075',
        completion: '0.00000375',
        input_cache_read: '0.000000075',
        input_cache_write: '0.0000000416666666666667',
        web_search: '0.014',
      },
    },
    {
      id: 'x-ai/grok-4.5',
      pricing: {
        prompt: '0.000002',
        completion: '0.000006',
        input_cache_read: '0.0000003',
        overrides: [{ min_prompt_tokens: 200000, prompt: '0.000004', completion: '0.000012', input_cache_read: '0.0000006' }],
      },
    },
    { id: 'vendor/free-model', pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/unpriced-model', pricing: { completion: '0.000001' } },
    { id: 'vendor/no-pricing-object' },
  ],
}

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('parsing the live catalogue', () => {
  it('converts USD-per-token strings into USD per million tokens', () => {
    const { table, modelCount } = parseOpenRouterModels(PAYLOAD)
    expect(modelCount).toBe(3)
    const flash = table[OPENROUTER_PROVIDER]?.['google/gemini-3.6-flash']
    expect(flash?.input).toBeCloseTo(0.75, 10)
    expect(flash?.output).toBeCloseTo(3.75, 10)
    expect(flash?.cacheRead).toBeCloseTo(0.075, 10)
    expect(flash?.cacheWrite).toBeCloseTo(0.0416666666666667, 10)
  })

  it('carries volume overrides through as tiers', () => {
    const { table } = parseOpenRouterModels(PAYLOAD)
    const grok = table[OPENROUTER_PROVIDER]?.['x-ai/grok-4.5']
    expect(grok?.tiers).toHaveLength(1)
    expect(grok?.tiers?.[0]).toMatchObject({ inputTokensAbove: 200000 })
    expect(grok?.tiers?.[0]?.input).toBeCloseTo(4, 10)
    expect(grok?.tiers?.[0]?.cacheRead).toBeCloseTo(0.6, 10)
    // This is the class the pinned catalogue drops entirely: 0 of its 276
    // OpenRouter entries carry a tier, so a table built from it understates
    // every long-context grok run by half.
  })

  it('keeps a genuinely free model and drops a model it cannot rate', () => {
    const { table } = parseOpenRouterModels(PAYLOAD)
    const models = table[OPENROUTER_PROVIDER] ?? {}
    expect(models['vendor/free-model']).toEqual({ input: 0, output: 0 })
    // Absent from the table on purpose: absent reaches the surface as
    // "unpriced", whereas a defaulted zero would read as "free".
    expect(models['vendor/unpriced-model']).toBeUndefined()
    expect(models['vendor/no-pricing-object']).toBeUndefined()
  })

  it('omits a cache rate the provider does not publish rather than inventing one', () => {
    const { table } = parseOpenRouterModels({ data: [{ id: 'a/b', pricing: { prompt: '0.000001', completion: '0.000002' } }] })
    const rates = table[OPENROUTER_PROVIDER]?.['a/b']
    expect(rates).toEqual({ input: 1, output: 2 })
    expect('cacheRead' in (rates ?? {})).toBe(false)
  })

  it('treats an unrecognisable body as no rates at all', () => {
    for (const body of [null, undefined, {}, { data: 'nope' }, { data: [] }, 42]) {
      expect(parseOpenRouterModels(body)).toEqual({ table: {}, modelCount: 0 })
    }
  })
})

describe('reading the rates fails open', () => {
  it('asks the public catalogue endpoint and stamps the read time', async () => {
    const fetchImpl = vi.fn(async () => response(PAYLOAD))
    const before = Date.now()
    const snapshot = await fetchOpenRouterRates(undefined, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledWith(OPENROUTER_MODELS_URL, expect.objectContaining({ headers: { accept: 'application/json' } }))
    expect(snapshot.modelCount).toBe(3)
    expect(snapshot.fetchedAt).toBeGreaterThanOrEqual(before)
  })

  it('never rejects — a refusal, a bad body, or a thrown fetch all become an empty table with the reason', async () => {
    const refused = await fetchOpenRouterRates(undefined, (async () => response({}, false, 503)) as unknown as typeof fetch)
    expect(refused).toEqual({ ...NO_RATES, error: 'OpenRouter answered 503' })

    const empty = await fetchOpenRouterRates(undefined, (async () => response({ data: [] })) as unknown as typeof fetch)
    expect(empty).toEqual({ ...NO_RATES, error: 'OpenRouter returned no priced models' })

    const offline = await fetchOpenRouterRates(undefined, (async () => { throw new Error('Failed to fetch') }) as unknown as typeof fetch)
    expect(offline).toEqual({ ...NO_RATES, error: 'Failed to fetch' })

    // The contract that matters: no arm of this leaves the surface without a
    // table to render against.
    for (const snapshot of [refused, empty, offline]) expect(snapshot.table).toEqual({})
  })
})

describe('the shared rate read', () => {
  it('reads once however many badges subscribe, and serves the fail-open table until it lands', async () => {
    let settle: (snapshot: RateSnapshot) => void = () => {}
    const read = vi.fn(async () => new Promise<RateSnapshot>((resolve) => { settle = resolve }))
    const source = new RateSource(read)

    expect(source.getSnapshot()).toEqual(NO_RATES)
    const seen: number[] = []
    const off1 = source.subscribe(() => seen.push(1))
    const off2 = source.subscribe(() => seen.push(2))
    const off3 = source.subscribe(() => seen.push(3))
    // A conversation mounts one badge per turn; a fetch per badge would hammer
    // a third-party endpoint for a table that does not change mid-session.
    expect(read).toHaveBeenCalledTimes(1)

    off2()
    settle({ table: { openrouter: { 'a/b': { input: 1, output: 2 } } }, modelCount: 1, fetchedAt: 5 })
    await vi.waitFor(() => { expect(seen.length).toBeGreaterThan(0) })

    expect(source.getSnapshot().modelCount).toBe(1)
    expect(seen).toEqual([1, 3])
    off1()
    off3()
  })

  it('aborts an in-flight read on disposal and absorbs the rejection', async () => {
    const read = vi.fn(async (signal: AbortSignal) => {
      return new Promise<RateSnapshot>((_, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) })
      })
    })
    const source = new RateSource(read)
    source.subscribe(() => {})
    const signal = read.mock.calls[0]?.[0]
    expect(signal?.aborted).toBe(false)

    source.dispose()
    expect(signal?.aborted).toBe(true)
    // Shell teardown aborts this read. A rejection escaping here would be an
    // unhandled rejection on every ordinary generation dispose.
    await expect(source.whenSettled()).resolves.toMatchObject({ table: {}, error: 'aborted' })
    expect(source.getSnapshot().table).toEqual({})
  })
})
