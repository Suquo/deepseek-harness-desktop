/** Explicit-demand browser store for Host-reconciled generation charges. */

import {
  OPENROUTER_BILLING_PATH,
  parseOpenRouterBillingResponse,
  type OpenRouterBillingAvailability,
} from '../openrouter-billing-contract.ts'

export const MAX_BILLING_CLIENT_RESPONSE_BYTES = 64 * 1024

export type BilledTurnStatus = 'idle' | 'loading' | OpenRouterBillingAvailability | 'error'

export interface BilledTurnState {
  readonly status: BilledTurnStatus
  readonly costs: ReadonlyMap<number, number>
  readonly message?: string
}

export interface BilledCostsSnapshot {
  readonly revision: number
  readonly turns: ReadonlyMap<string, BilledTurnState>
}

export type BilledCostRequest = (url: string, init: RequestInit) => Promise<Response>

const EMPTY_TURN: BilledTurnState = { status: 'idle', costs: new Map() }

/** Key one turn without letting separators inside a session id collide. */
export function billedTurnKey(sessionId: string, turn: number): string {
  return `${String(sessionId.length)}:${sessionId}:${String(turn)}`
}

/** Read one turn from a source snapshot. */
export function billedTurnState(
  snapshot: BilledCostsSnapshot,
  sessionId: string,
  turn: number,
): BilledTurnState {
  return snapshot.turns.get(billedTurnKey(sessionId, turn)) ?? EMPTY_TURN
}

/** Generation-owned external store shared by every cost badge. */
export class BilledCostSource {
  readonly #request: BilledCostRequest
  readonly #listeners = new Set<() => void>()
  readonly #inFlight = new Map<string, Promise<void>>()
  #snapshot: BilledCostsSnapshot = { revision: 0, turns: new Map() }
  #disposed = false

  constructor(request: BilledCostRequest = (url, init) => globalThis.fetch(url, init)) {
    this.#request = request
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => {}
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  getSnapshot(): BilledCostsSnapshot {
    return this.#snapshot
  }

  /** Run or join one explicit whole-turn pass. */
  reconcile(sessionId: string, turn: number): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    const key = billedTurnKey(sessionId, turn)
    const prior = this.#snapshot.turns.get(key) ?? EMPTY_TURN
    if (prior.status === 'complete') return Promise.resolve()
    const current = this.#inFlight.get(key)
    if (current !== undefined) return current

    this.#set(key, { status: 'loading', costs: prior.costs })
    const operation = this.#run(sessionId, turn, key)
      .finally(() => { this.#inFlight.delete(key) })
    this.#inFlight.set(key, operation)
    return operation
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#inFlight.clear()
    this.#listeners.clear()
  }

  async #run(sessionId: string, turn: number, key: string): Promise<void> {
    try {
      const response = await this.#request(OPENROUTER_BILLING_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sessionId, turn }),
        cache: 'no-store',
        redirect: 'error',
      })
      if (response.status !== 200) throw new Error('host rejected billing reconciliation')
      const parsed = parseOpenRouterBillingResponse(JSON.parse(await readLimitedBody(response)) as unknown)
      if (parsed === undefined) throw new Error('invalid billing reconciliation response')
      if (this.#disposed) return
      const prior = this.#snapshot.turns.get(key) ?? EMPTY_TURN
      const costs = new Map(prior.costs)
      for (const result of parsed.results) {
        if (result.status === 'billed') costs.set(result.step, result.usd)
      }
      this.#set(key, { status: parsed.availability, costs })
    } catch {
      if (this.#disposed) return
      const prior = this.#snapshot.turns.get(key) ?? EMPTY_TURN
      this.#set(key, {
        status: 'error',
        costs: prior.costs,
        message: 'Billed cost unavailable — retry reconciliation.',
      })
    }
  }

  #set(key: string, state: BilledTurnState): void {
    if (this.#disposed) return
    const turns = new Map(this.#snapshot.turns)
    turns.set(key, state)
    this.#snapshot = { revision: this.#snapshot.revision + 1, turns }
    for (const listener of this.#listeners) listener()
  }
}

async function readLimitedBody(response: Response): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^[0-9]+$/u.test(declared)
    && BigInt(declared) > BigInt(MAX_BILLING_CLIENT_RESPONSE_BYTES)) throw new Error('response too large')
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BILLING_CLIENT_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('response too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}
