/** Desktop Host plugin for on-demand OpenRouter generation-cost reconciliation. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SessionId, type SurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-query'
import z from '@deepseek-ai/schemastery'
import type {} from './runtime.ts'
import {
  MAX_OPENROUTER_BILLING_REQUEST_BYTES,
  OPENROUTER_BILLING_PATH,
  parseOpenRouterBillingRequest,
  type OpenRouterBillingRequest,
  type OpenRouterBillingResponse,
  type OpenRouterBillingResult,
} from './openrouter-billing-contract.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-openrouter-billing'
export const inject = ['desktopRuntime', 'webServer', 'credentials', 'sessionQuery']
export interface Config {}
export const Config: z<Config> = z.object({})

/** Fixed provider endpoint; no caller may override it. */
export const OPENROUTER_GENERATION_ENDPOINT = 'https://openrouter.ai/api/v1/generation'
export const MAX_GENERATIONS_PER_PASS = 64
export const MAX_CONCURRENT_GENERATION_REQUESTS = 4
export const OPENROUTER_GENERATION_TIMEOUT_MS = 5_000
export const MAX_OPENROUTER_RESPONSE_BYTES = 64 * 1024

export interface OpenRouterGenerationRef {
  readonly step: number
  readonly responseId: string
}

export type OpenRouterBillingTransport = (url: string, init: RequestInit) => Promise<Response>

export interface OpenRouterBillingReconcilerOptions {
  readonly request?: OpenRouterBillingTransport
  readonly maxGenerations?: number
  readonly concurrency?: number
  readonly timeoutMs?: number
}

/**
 * Success-only, generation-owned provider lookup cache.
 * Operational misses resolve to `null` and are deliberately absent from the cache.
 */
export class OpenRouterBillingReconciler {
  readonly #request: OpenRouterBillingTransport
  readonly #maxGenerations: number
  readonly #concurrency: number
  readonly #timeoutMs: number
  readonly #costs = new Map<string, number>()
  readonly #inFlight = new Map<string, Promise<number | null>>()
  readonly #lifetime = new AbortController()
  #disposed = false

  constructor(options: OpenRouterBillingReconcilerOptions = {}) {
    this.#request = options.request ?? ((url, init) => globalThis.fetch(url, init))
    this.#maxGenerations = options.maxGenerations ?? MAX_GENERATIONS_PER_PASS
    this.#concurrency = options.concurrency ?? MAX_CONCURRENT_GENERATION_REQUESTS
    this.#timeoutMs = options.timeoutMs ?? OPENROUTER_GENERATION_TIMEOUT_MS
  }

  async reconcile(
    refs: readonly OpenRouterGenerationRef[],
    apiKey: string | undefined,
  ): Promise<OpenRouterBillingResponse> {
    const unique = deduplicateGenerationRefs(refs)
    if (apiKey !== undefined && !this.#disposed) {
      const pending = unique
        .filter(ref => !this.#costs.has(ref.responseId))
        .slice(0, this.#maxGenerations)
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < pending.length && !this.#disposed) {
          const ref = pending[cursor]
          cursor += 1
          if (ref !== undefined) await this.#lookup(ref.responseId, apiKey)
        }
      }
      const workers = Math.min(this.#concurrency, pending.length)
      await Promise.all(Array.from({ length: workers }, worker))
    }

    const results: OpenRouterBillingResult[] = unique.map(({ step, responseId }) => {
      const usd = this.#costs.get(responseId)
      return usd === undefined ? { step, status: 'estimated' } : { step, status: 'billed', usd }
    })
    const billed = results.filter(result => result.status === 'billed').length
    return {
      results,
      availability: billed === results.length ? 'complete' : billed === 0 ? 'unavailable' : 'partial',
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#lifetime.abort()
    this.#costs.clear()
    this.#inFlight.clear()
  }

  async #lookup(responseId: string, apiKey: string): Promise<number | null> {
    const cached = this.#costs.get(responseId)
    if (cached !== undefined) return cached
    const current = this.#inFlight.get(responseId)
    if (current !== undefined) return current

    const operation = this.#requestGeneration(responseId, apiKey)
      .then((usd) => {
        if (usd !== null && !this.#disposed) this.#costs.set(responseId, usd)
        return usd
      })
      .finally(() => { this.#inFlight.delete(responseId) })
    this.#inFlight.set(responseId, operation)
    return operation
  }

  async #requestGeneration(responseId: string, apiKey: string): Promise<number | null> {
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    this.#lifetime.signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, this.#timeoutMs)
    timeout.unref?.()
    try {
      const url = new URL(OPENROUTER_GENERATION_ENDPOINT)
      url.searchParams.set('id', responseId)
      const response = await this.#request(url.href, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
      if (response.status !== 200) return null
      const body = await readLimitedBody(response)
      return billedUsdFrom(body)
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
      this.#lifetime.signal.removeEventListener('abort', abort)
    }
  }
}

/** Find valid pi-ai/OpenRouter generation join keys on one turn's durable surface. */
export function extractOpenRouterGenerationRefs(
  events: readonly SurfaceEvent[],
  turn: number,
): OpenRouterGenerationRef[] {
  const refs: OpenRouterGenerationRef[] = []
  for (const event of events) {
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    const source = event.data.message.source
    if (source.kind !== 'model') continue
    const replay = record(source.replayState)
    const response = record(replay?.response)
    const responseId = response?.responseId
    if (response?.kind !== 'pi-ai' || response.version !== 2) continue
    if (typeof responseId !== 'string' || !/^gen-[A-Za-z0-9_-]{1,240}$/u.test(responseId)) continue
    refs.push({ step: event.data.step, responseId })
  }
  return deduplicateGenerationRefs(refs)
}

export interface OpenRouterBillingPassDependencies {
  readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>
  resolveCredential(): Promise<string | undefined>
  readonly reconciler: OpenRouterBillingReconciler
  report(category: 'credential-unavailable' | 'credential-resolution-failed'): void
}

/** Reconcile one validated session/turn without exposing its provider join keys. */
export async function reconcileSessionTurn(
  request: OpenRouterBillingRequest,
  dependencies: OpenRouterBillingPassDependencies,
): Promise<OpenRouterBillingResponse | undefined> {
  let surface: SessionSurfaceSnapshot
  try {
    surface = await dependencies.readSurface(SessionId(request.sessionId))
  } catch {
    return undefined
  }
  const refs = extractOpenRouterGenerationRefs(surface.events, request.turn)
  let apiKey: string | undefined
  try {
    apiKey = await dependencies.resolveCredential()
  } catch {
    dependencies.report('credential-resolution-failed')
  }
  if (apiKey === undefined) dependencies.report('credential-unavailable')
  return dependencies.reconciler.reconcile(refs, apiKey)
}

/** Serve one same-origin, bounded reconciliation request. */
export async function handleOpenRouterBillingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  reconcile: (request: OpenRouterBillingRequest) => Promise<OpenRouterBillingResponse | undefined>,
  report: (category: 'invalid-body' | 'unexpected-failure') => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (req.headers.origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finishJson(res, 415, { error: 'content type must be application/json' })
  }
  let request: OpenRouterBillingRequest | undefined
  try {
    request = parseOpenRouterBillingRequest(await readJson(req))
  } catch {
    report('invalid-body')
  }
  if (request === undefined) return finishJson(res, 400, { error: 'invalid billing reconciliation request' })
  try {
    const response = await reconcile(request)
    if (response === undefined) return finishJson(res, 404, { error: 'session not found' })
    finishJson(res, 200, response)
  } catch {
    report('unexpected-failure')
    finishJson(res, 500, { error: 'billing reconciliation failed' })
  }
}

/** Mount the Host-only route in the desktop overlay generation. */
export function apply(ctx: Context, _config: Config): void {
  if (ctx.get('desktopRuntime') === undefined) throw new Error(`${name} requires the desktop launcher`)
  if (ctx.webServer.host !== '127.0.0.1') throw new Error(`${name} requires a loopback Web server`)
  const expectedOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const reconciler = new OpenRouterBillingReconciler()
  const reportPass = (category: 'credential-unavailable' | 'credential-resolution-failed'): void => {
    ctx.logger.warn(`${name}: ${category}`)
  }
  const dependencies: OpenRouterBillingPassDependencies = {
    readSurface: sessionId => ctx.sessionQuery.readSurface(sessionId),
    resolveCredential: async () => (await ctx.credentials.resolve(credentialRef('OPENROUTER_API_KEY')))?.value,
    reconciler,
    report: reportPass,
  }
  ctx.effect(() => {
    const removeRoute = ctx.webServer.register({
      kind: 'exact',
      path: OPENROUTER_BILLING_PATH,
      handler: (req, res) => handleOpenRouterBillingRequest(
        req,
        res,
        expectedOrigin,
        request => reconcileSessionTurn(request, dependencies),
        category => { ctx.logger.warn(`${name}: ${category}`) },
      ),
    })
    return () => {
      removeRoute()
      reconciler.dispose()
    }
  }, 'dsh-plugin-desktop: OpenRouter billed-cost reconciliation route')
}

function deduplicateGenerationRefs(refs: readonly OpenRouterGenerationRef[]): OpenRouterGenerationRef[] {
  const ids = new Set<string>()
  const steps = new Set<number>()
  return refs.filter((ref) => {
    if (ids.has(ref.responseId) || steps.has(ref.step)) return false
    ids.add(ref.responseId)
    steps.add(ref.step)
    return true
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function billedUsdFrom(body: string): number | null {
  let value: unknown
  try {
    value = JSON.parse(body) as unknown
  } catch {
    return null
  }
  const data = record(record(value)?.data)
  const totalCost = data?.total_cost
  return typeof totalCost === 'number' && Number.isFinite(totalCost) && totalCost >= 0 ? totalCost : null
}

async function readLimitedBody(response: Response): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^[0-9]+$/u.test(declared)
    && BigInt(declared) > BigInt(MAX_OPENROUTER_RESPONSE_BYTES)) throw new Error('response too large')
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
      if (bytes > MAX_OPENROUTER_RESPONSE_BYTES) {
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_OPENROUTER_BILLING_REQUEST_BYTES) throw new Error('request too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}
