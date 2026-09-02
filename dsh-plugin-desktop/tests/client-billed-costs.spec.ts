import { describe, expect, it, vi } from 'vitest'
import {
  BilledCostSource,
  MAX_BILLING_CLIENT_RESPONSE_BYTES,
  billedTurnState,
  type BilledCostRequest,
} from '../src/client/billed-costs.ts'
import { OPENROUTER_BILLING_PATH } from '../src/openrouter-billing-contract.ts'

function billingResponse(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, init)
}

describe('explicit-demand billed cost source', () => {
  it('does no I/O during construction, subscription, or snapshot reads', () => {
    const request = vi.fn<BilledCostRequest>()
    const source = new BilledCostSource(request)
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)

    expect(billedTurnState(source.getSnapshot(), 'session-one', 1)).toEqual({ status: 'idle', costs: new Map() })
    expect(request).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('posts one whole-turn request and caches a complete response client-side', async () => {
    const request = vi.fn<BilledCostRequest>(async () => billingResponse({
      results: [{ step: 1, status: 'billed', usd: 0 }, { step: 2, status: 'billed', usd: 0.25 }],
      availability: 'complete',
    }))
    const source = new BilledCostSource(request)

    await source.reconcile('session-fixture', 3)
    await source.reconcile('session-fixture', 3)

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(OPENROUTER_BILLING_PATH, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-fixture', turn: 3 }),
      cache: 'no-store',
      redirect: 'error',
    }))
    const headers = new Headers(request.mock.calls[0]?.[1].headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
    expect(billedTurnState(source.getSnapshot(), 'session-fixture', 3)).toEqual({
      status: 'complete', costs: new Map([[1, 0], [2, 0.25]]),
    })
  })

  it('coalesces concurrent clicks and retries unresolved steps on the next click', async () => {
    let release: (() => void) | undefined
    const first = new Promise<void>(resolve => { release = resolve })
    const request = vi.fn<BilledCostRequest>(async () => {
      if (request.mock.calls.length === 1) await first
      return billingResponse({
        results: request.mock.calls.length === 1
          ? [{ step: 1, status: 'billed', usd: 0.1 }, { step: 2, status: 'estimated' }]
          : [{ step: 1, status: 'billed', usd: 0.1 }, { step: 2, status: 'billed', usd: 0.2 }],
        availability: request.mock.calls.length === 1 ? 'partial' : 'complete',
      })
    })
    const source = new BilledCostSource(request)
    const one = source.reconcile('session-fixture', 2)
    const same = source.reconcile('session-fixture', 2)
    expect(one).toBe(same)
    expect(request).toHaveBeenCalledOnce()
    release?.()
    await one

    await source.reconcile('session-fixture', 2)
    expect(request).toHaveBeenCalledTimes(2)
    expect(billedTurnState(source.getSnapshot(), 'session-fixture', 2)).toEqual({
      status: 'complete', costs: new Map([[1, 0.1], [2, 0.2]]),
    })
  })

  it('retains prior billed values across a malformed response and permits retry', async () => {
    const replies = [
      billingResponse({ results: [{ step: 1, status: 'billed', usd: 0.1 }], availability: 'partial' }),
      new Response('{'),
      billingResponse({ results: [{ step: 2, status: 'billed', usd: 0.2 }], availability: 'complete' }),
    ]
    const request = vi.fn(async () => replies.shift()!)
    const source = new BilledCostSource(request)

    await source.reconcile('session-fixture', 2)
    await source.reconcile('session-fixture', 2)
    expect(billedTurnState(source.getSnapshot(), 'session-fixture', 2)).toMatchObject({
      status: 'error', costs: new Map([[1, 0.1]]),
    })
    await source.reconcile('session-fixture', 2)
    expect(billedTurnState(source.getSnapshot(), 'session-fixture', 2)).toEqual({
      status: 'complete', costs: new Map([[1, 0.1], [2, 0.2]]),
    })
  })

  it('rejects duplicate, negative, and oversized Host results without losing retryability', async () => {
    const replies = [
      billingResponse({ results: [{ step: 1, status: 'billed', usd: -1 }], availability: 'complete' }),
      billingResponse({
        results: [{ step: 1, status: 'estimated' }, { step: 1, status: 'estimated' }],
        availability: 'partial',
      }),
      new Response('{}', { headers: { 'content-length': String(MAX_BILLING_CLIENT_RESPONSE_BYTES + 1) } }),
    ]
    const request = vi.fn(async () => replies.shift()!)
    const source = new BilledCostSource(request)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await source.reconcile('session-fixture', 1)
      expect(billedTurnState(source.getSnapshot(), 'session-fixture', 1).status).toBe('error')
    }
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('ignores a late response and notifications after disposal', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    const source = new BilledCostSource(async () => {
      await pending
      return billingResponse({ results: [{ step: 1, status: 'billed', usd: 1 }], availability: 'complete' })
    })
    const listener = vi.fn()
    source.subscribe(listener)
    const pass = source.reconcile('session-fixture', 1)
    const before = source.getSnapshot()
    source.dispose()
    release?.()
    await pass

    expect(source.getSnapshot()).toBe(before)
    expect(listener).toHaveBeenCalledOnce()
    await expect(source.reconcile('session-fixture', 1)).resolves.toBeUndefined()
  })
})
