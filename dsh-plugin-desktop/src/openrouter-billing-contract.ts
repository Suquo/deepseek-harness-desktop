/** Shared loopback contract for explicit OpenRouter billed-cost reconciliation. */

/** Desktop-owned exact loopback route. */
export const OPENROUTER_BILLING_PATH = '/_dsh/desktop/openrouter-billing/reconcile'

/** Maximum accepted renderer request size. */
export const MAX_OPENROUTER_BILLING_REQUEST_BYTES = 16 * 1024

/** Renderer request. Generation ids deliberately never cross this boundary. */
export interface OpenRouterBillingRequest {
  readonly sessionId: string
  readonly turn: number
}

/** One generation still using its immediate list-rate estimate. */
export interface EstimatedBillingResult {
  readonly step: number
  readonly status: 'estimated'
}

/** One provider-backed generation charge. */
export interface BilledBillingResult {
  readonly step: number
  readonly status: 'billed'
  readonly usd: number
}

export type OpenRouterBillingResult = EstimatedBillingResult | BilledBillingResult
export type OpenRouterBillingAvailability = 'complete' | 'partial' | 'unavailable'

/** Successful response for one explicit whole-turn pass. */
export interface OpenRouterBillingResponse {
  readonly results: readonly OpenRouterBillingResult[]
  readonly availability: OpenRouterBillingAvailability
}

/** Strictly validate an untrusted renderer request. */
export function parseOpenRouterBillingRequest(value: unknown): OpenRouterBillingRequest | undefined {
  if (!isRecord(value)) return undefined
  const { sessionId, turn } = value
  if (typeof sessionId !== 'string' || !/^session-[A-Za-z0-9_-]{1,200}$/u.test(sessionId)) return undefined
  if (!Number.isSafeInteger(turn) || (turn as number) <= 0) return undefined
  return { sessionId, turn: turn as number }
}

/** Strictly validate an untrusted Host response for the browser store. */
export function parseOpenRouterBillingResponse(value: unknown): OpenRouterBillingResponse | undefined {
  if (!isRecord(value) || !Array.isArray(value.results)) return undefined
  if (value.availability !== 'complete' && value.availability !== 'partial' && value.availability !== 'unavailable') {
    return undefined
  }
  const steps = new Set<number>()
  const results: OpenRouterBillingResult[] = []
  for (const candidate of value.results) {
    if (!isRecord(candidate) || !Number.isSafeInteger(candidate.step) || (candidate.step as number) <= 0) return undefined
    const step = candidate.step as number
    if (steps.has(step)) return undefined
    steps.add(step)
    if (candidate.status === 'estimated') results.push({ step, status: 'estimated' })
    else if (candidate.status === 'billed'
      && typeof candidate.usd === 'number'
      && Number.isFinite(candidate.usd)
      && candidate.usd >= 0) {
      results.push({ step, status: 'billed', usd: candidate.usd })
    } else return undefined
  }
  return { results, availability: value.availability }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
