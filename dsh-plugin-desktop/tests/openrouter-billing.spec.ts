import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { SurfaceEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_OPENROUTER_RESPONSE_BYTES,
  OPENROUTER_GENERATION_ENDPOINT,
  OpenRouterBillingReconciler,
  extractOpenRouterGenerationRefs,
  handleOpenRouterBillingRequest,
  reconcileSessionTurn,
  type OpenRouterBillingTransport,
} from '../src/openrouter-billing.ts'

const ORIGIN = 'http://127.0.0.1:43120'

function jsonRequest(value: unknown, options: { origin?: string; method?: string; contentType?: string } = {}): IncomingMessage {
  const request = Readable.from([JSON.stringify(value)]) as IncomingMessage
  request.method = options.method ?? 'POST'
  request.headers = {
    origin: options.origin ?? ORIGIN,
    'content-type': options.contentType ?? 'application/json',
  }
  return request
}

function response(): ServerResponse & { body: string } {
  const value = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { value.body = body ?? '' }),
  }
  return value as unknown as ServerResponse & { body: string }
}

function assistant(step: number, responseId: unknown, provider = 'parametria-vision'): SurfaceEvent {
  return {
    type: 'assistant/message',
    seq: step,
    time: step,
    surfaceOp: 'append',
    data: {
      turn: 2,
      step,
      message: {
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          provider,
          model: 'google/gemini-3.6-flash',
          replayState: {
            response: {
              kind: 'pi-ai',
              version: 2,
              api: 'openai-completions',
              provider,
              model: 'google/gemini-3.6-flash',
              responseId,
              stopReason: 'stop',
            },
            blocks: [],
          },
        },
      },
    },
  } as unknown as SurfaceEvent
}

function generationResponse(totalCost: unknown): Response {
  return Response.json({ data: { total_cost: totalCost } })
}

describe('durable generation discovery', () => {
  it('accepts valid pi-ai gen ids from custom OpenRouter routes and deduplicates ids and steps', () => {
    const events = [
      assistant(1, 'gen-first'),
      assistant(2, 'gen-first'),
      assistant(1, 'gen-other'),
      assistant(3, 'not-an-openrouter-id'),
      { ...assistant(4, 'gen-wrong-turn'), data: { ...assistant(4, 'gen-wrong-turn').data, turn: 3 } },
    ] as SurfaceEvent[]

    expect(extractOpenRouterGenerationRefs(events, 2)).toEqual([
      { step: 1, responseId: 'gen-first' },
    ])
  })

  it('rejects unknown replay versions and non-model messages', () => {
    const wrongVersion = assistant(1, 'gen-wrong') as unknown as { data: { message: { source: { replayState: { response: { version: number } } } } } }
    wrongVersion.data.message.source.replayState.response.version = 3
    expect(extractOpenRouterGenerationRefs([wrongVersion as unknown as SurfaceEvent], 2)).toEqual([])
  })
})

describe('provider reconciliation', () => {
  it('uses the fixed endpoint and secret header, accepts billed zero, caches success, and retries misses', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const request: OpenRouterBillingTransport = async (url, init) => {
      calls.push({ url, init })
      return url.endsWith('gen-billed') ? generationResponse(0) : new Response(null, { status: 404 })
    }
    const reconciler = new OpenRouterBillingReconciler({ request })
    const refs = [
      { step: 1, responseId: 'gen-billed' },
      { step: 2, responseId: 'gen-pending' },
    ]

    await expect(reconciler.reconcile(refs, 'super-secret')).resolves.toEqual({
      results: [
        { step: 1, status: 'billed', usd: 0 },
        { step: 2, status: 'estimated' },
      ],
      availability: 'partial',
    })
    await reconciler.reconcile(refs, 'super-secret')

    expect(calls.map(call => call.url)).toEqual([
      `${OPENROUTER_GENERATION_ENDPOINT}?id=gen-billed`,
      `${OPENROUTER_GENERATION_ENDPOINT}?id=gen-pending`,
      `${OPENROUTER_GENERATION_ENDPOINT}?id=gen-pending`,
    ])
    for (const call of calls) {
      expect(call.init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
      expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer super-secret')
      expect(new Headers(call.init.headers).get('accept')).toBe('application/json')
    }
  })

  it('does not cache malformed, negative, oversized, or non-200 provider results', async () => {
    const replies = [
      new Response('{'),
      generationResponse(-1),
      new Response('{}', { headers: { 'content-length': String(MAX_OPENROUTER_RESPONSE_BYTES + 1) } }),
      new Response(null, { status: 503 }),
    ]
    const request = vi.fn(async () => replies.shift() ?? generationResponse(0.25))
    const reconciler = new OpenRouterBillingReconciler({ request })
    const refs = [{ step: 1, responseId: 'gen-retry' }]

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(reconciler.reconcile(refs, 'key')).resolves.toMatchObject({
        results: [{ status: 'estimated' }],
      })
    }
    await expect(reconciler.reconcile(refs, 'key')).resolves.toMatchObject({
      results: [{ status: 'billed', usd: 0.25 }],
    })
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('caps each pass, limits concurrency, and shares an in-flight id across passes', async () => {
    let active = 0
    let peak = 0
    const request = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => { setImmediate(resolve) })
      active -= 1
      return generationResponse(0.1)
    })
    const reconciler = new OpenRouterBillingReconciler({ request, maxGenerations: 5, concurrency: 2 })
    const refs = Array.from({ length: 8 }, (_, index) => ({ step: index + 1, responseId: `gen-${String(index + 1)}` }))

    const first = reconciler.reconcile(refs, 'key')
    const overlapping = reconciler.reconcile([refs[0]!], 'key')
    const [result] = await Promise.all([first, overlapping])

    expect(request).toHaveBeenCalledTimes(5)
    expect(peak).toBe(2)
    expect(result.results.filter(item => item.status === 'billed')).toHaveLength(5)
  })

  it('aborts in-flight work and ignores late success after disposal', async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
        setImmediate(resolve)
      })
      return generationResponse(1)
    })
    const reconciler = new OpenRouterBillingReconciler({ request })
    const pending = reconciler.reconcile([{ step: 1, responseId: 'gen-late' }], 'key')
    reconciler.dispose()

    await expect(pending).resolves.toEqual({
      results: [{ step: 1, status: 'estimated' }],
      availability: 'unavailable',
    })
  })
})

describe('one Host pass', () => {
  it('reads one surface, resolves one credential, and returns no id or secret', async () => {
    const request = vi.fn(async () => generationResponse(0.0123))
    const readSurface = vi.fn(async () => ({ session: {}, capturedThroughSeq: 1, events: [assistant(7, 'gen-private')] }))
    const resolveCredential = vi.fn(async () => 'private-key')
    const report = vi.fn()

    const result = await reconcileSessionTurn(
      { sessionId: 'session-fixture', turn: 2 },
      { readSurface, resolveCredential, report, reconciler: new OpenRouterBillingReconciler({ request }) },
    )

    expect(readSurface).toHaveBeenCalledOnce()
    expect(resolveCredential).toHaveBeenCalledOnce()
    expect(result).toEqual({ results: [{ step: 7, status: 'billed', usd: 0.0123 }], availability: 'complete' })
    expect(JSON.stringify(result)).not.toContain('gen-private')
    expect(JSON.stringify(result)).not.toContain('private-key')
    expect(report).not.toHaveBeenCalled()
  })

  it('fails open without a credential and leaves the next pass eligible', async () => {
    const request = vi.fn(async () => generationResponse(1))
    const dependencies = {
      readSurface: vi.fn(async () => ({ session: {}, capturedThroughSeq: 1, events: [assistant(1, 'gen-pending')] })),
      resolveCredential: vi.fn(async () => undefined),
      report: vi.fn(),
      reconciler: new OpenRouterBillingReconciler({ request }),
    }

    await expect(reconcileSessionTurn({ sessionId: 'session-fixture', turn: 2 }, dependencies))
      .resolves.toEqual({ results: [{ step: 1, status: 'estimated' }], availability: 'unavailable' })
    expect(request).not.toHaveBeenCalled()
    expect(dependencies.report).toHaveBeenCalledWith('credential-unavailable')
  })
})

describe('loopback route admission', () => {
  it.each([
    [{ method: 'GET' }, 405],
    [{ origin: 'https://attacker.example' }, 403],
    [{ contentType: 'text/plain' }, 415],
  ])('rejects %j before reconciliation', async (options, statusCode) => {
    const reconcile = vi.fn()
    const res = response()
    await handleOpenRouterBillingRequest(
      jsonRequest({ sessionId: 'session-fixture', turn: 1 }, options), res, ORIGIN, reconcile,
    )
    expect(res.statusCode).toBe(statusCode)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { sessionId: 'wrong', turn: 1 },
    { sessionId: 'session-ok', turn: 0 },
    { sessionId: 'session-ok', turn: 1.5 },
  ])('rejects invalid body %j before reconciliation', async (body) => {
    const reconcile = vi.fn()
    const res = response()
    await handleOpenRouterBillingRequest(jsonRequest(body), res, ORIGIN, reconcile)
    expect(res.statusCode).toBe(400)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('maps a missing session and unexpected failure to stable errors', async () => {
    const missing = response()
    await handleOpenRouterBillingRequest(
      jsonRequest({ sessionId: 'session-fixture', turn: 1 }), missing, ORIGIN, async () => undefined,
    )
    expect(missing.statusCode).toBe(404)
    expect(JSON.parse(missing.body)).toEqual({ error: 'session not found' })

    const failed = response()
    await handleOpenRouterBillingRequest(
      jsonRequest({ sessionId: 'session-fixture', turn: 1 }), failed, ORIGIN,
      async () => { throw new Error('secret provider body') },
    )
    expect(failed.statusCode).toBe(500)
    expect(failed.body).not.toContain('secret provider body')
  })
})
