/**
 * Fold one conversation turn into its generations, their timings, and its cost.
 *
 * A "generation" here is one model call — one `assistant/message`, addressed by
 * `(turn, step)`. A Parametria definition build is one turn made of many, and
 * the owner's top-line metrics are that turn's money and its clock, so this
 * folds a turn and keeps the per-step rows underneath it.
 *
 * TIMING COMES FROM TWO PLACES ON PURPOSE. `llmMs` is per generation, derived
 * from the node's own recorded boundaries (`stepStartTime` -> `completedTime`),
 * and `wallMs` is the turn's `turn/start` -> `turn/end`. The gap between the
 * summed `llmMs` and `wallMs` is tool time — which on the harvested run was
 * 383.5s of a 636.8s turn, larger than the 253.2s of model time. A surface that
 * showed only money would hide the bigger lever, so both are surfaced.
 *
 * THE WINDOW IS NOT THE RUN. The client holds a paged node window that
 * compaction rewrites, so a fold sees the generations currently loaded, not
 * necessarily every one the turn ever had. {@link foldTurnCost} reports
 * `stepsOutsideWindow` when a turn's first step is missing, and the surface
 * says so rather than presenting a partial total as a complete one.
 */

import type { AssistantMessageNode, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { CostLine, RateTable, TokenBuckets } from './cost-model.ts'
import { NO_TOKENS, addTokens, formatCost, priceTokens, ratesFor, readTokenBuckets } from './cost-model.ts'

/** One model call inside a turn. */
export interface GenerationLine {
  /** Owning turn. */
  readonly turn: number
  /** Step index inside the turn. */
  readonly step: number
  /** Route that served it, when recorded. */
  readonly provider?: string
  /** Model id, when recorded. */
  readonly model?: string
  /** The four disjoint buckets, when a usage report landed. */
  readonly tokens?: TokenBuckets
  /** `stepStartTime` -> `completedTime`, when both boundaries are in the window. */
  readonly llmMs?: number
  /** `stepStartTime` -> first token, when a delta was recorded. */
  readonly ttftMs?: number
  /** What this generation cost. */
  readonly cost: CostLine
}

/** A turn's rolled-up money, clock and coverage. */
export interface TurnCost {
  /** Turn number. */
  readonly turn: number
  /** Its generations in step order. */
  readonly generations: readonly GenerationLine[]
  /** Summed buckets across every generation that reported usage. */
  readonly tokens: TokenBuckets
  /** `turn/start` -> `turn/end`, when the turn is closed and in-window. */
  readonly wallMs?: number
  /** Summed per-generation model time. */
  readonly llmMs: number
  /**
   * Wall time not spent waiting on the model — tools, mostly.
   * Undefined when `wallMs` is, because a difference from an unknown is unknown.
   */
  readonly nonModelMs?: number
  /** Sum of the generations that could be priced. */
  readonly usd: number
  /** True when EVERY generation was priced; false makes `usd` a floor, not a total. */
  readonly covered: boolean
  /** How many generations could not be priced, and why (first reason wins). */
  readonly unpriced: readonly { readonly step: number; readonly reason: string }[]
  /** Distinct `provider/model` pairs that served the turn. */
  readonly models: readonly string[]
  /**
   * True when the turn's step 1 is not in the loaded window, so earlier
   * generations exist that this fold could not see.
   */
  readonly stepsOutsideWindow: boolean
}

/**
 * Headline text for the collapsed chip.
 *
 * When any generation of the turn is unpriced the sum is a FLOOR, and the chip
 * says so with a `≥` rather than quietly presenting a partial total as the
 * turn's cost.
 * @param cost - the folded turn.
 * @returns the money half of the chip.
 */
export function costHeadline(cost: TurnCost): string {
  if (cost.generations.length === 0) return 'no generations'
  if (cost.unpriced.length === cost.generations.length) return 'unpriced'
  const money = formatCost({ status: 'priced', usd: cost.usd })
  return cost.covered ? money : `≥${money}`
}

/**
 * Provenance line: which rates produced these numbers, and when they were read.
 *
 * The timestamp is not decoration. The rate table this surface refuses to use —
 * the one pinned in the tree — was measured 2x wrong, and the only defence a
 * reader has against a stale estimate is knowing how fresh it is.
 * @param fetchedAt - when the rates were read, when they were.
 * @param modelCount - how many models were rated.
 * @param error - why no rates were read, when none were.
 * @returns the provenance sentence.
 */
export function rateProvenance(fetchedAt: number | undefined, modelCount: number, error: string | undefined): string {
  if (fetchedAt === undefined) {
    return error === undefined
      ? 'Reading live OpenRouter rates…'
      : `Live rates unavailable (${error}) — tokens and timings are exact, costs are not shown.`
  }
  const when = new Date(fetchedAt).toLocaleTimeString()
  return `Estimated from ${String(modelCount)} live OpenRouter list rates read at ${when}. List price, not the invoice.`
}

function isAssistant(node: ConversationNode): node is AssistantMessageNode {
  return node.kind === 'assistant'
}

/**
 * Find which turn a finalized assistant message belongs to.
 *
 * The `conversation.chat.assistant-actions` slot addresses its contributors by
 * `messageId` alone, so this is the hop from that identity to the turn whose
 * cost the badge reports.
 * @param nodes - the loaded conversation nodes.
 * @param messageId - the addressed message identity.
 * @returns the turn number, or undefined when the message is not in the window.
 */
export function turnOfMessage(nodes: readonly ConversationNode[], messageId: string): number | undefined {
  for (const node of nodes) {
    if (isAssistant(node) && node.messageId === messageId) return node.turn
  }
  return undefined
}

/**
 * Derive one generation's row.
 * @param node - a finalized assistant node.
 * @param table - the live rate table.
 * @returns the row.
 */
export function foldGeneration(node: AssistantMessageNode, table: RateTable): GenerationLine {
  const tokens = readTokenBuckets(node.usage)
  const provider = node.provenance?.provider ?? node.requestConfig?.provider
  const model = node.provenance?.model ?? node.requestConfig?.model
  const label = `${provider ?? '?'}/${model ?? '?'}`
  const start = node.timing?.stepStartTime ?? null
  const firstToken = node.timing?.firstTokenTime ?? null
  const completed = node.timing?.completedTime
  return {
    turn: node.turn,
    step: node.step,
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...tokens === undefined ? {} : { tokens },
    ...start === null || completed === undefined ? {} : { llmMs: Math.max(0, completed - start) },
    ...start === null || firstToken === null ? {} : { ttftMs: Math.max(0, firstToken - start) },
    cost: priceTokens(tokens, ratesFor(table, provider, model), label),
  }
}

/**
 * Fold every loaded generation of one turn.
 * @param nodes - the loaded conversation nodes.
 * @param turn - the turn to fold.
 * @param table - the live rate table.
 * @param turnTimings - the snapshot's exact turn boundaries.
 * @returns the turn's rolled-up cost and clock.
 */
export function foldTurnCost(
  nodes: readonly ConversationNode[],
  turn: number,
  table: RateTable,
  turnTimings?: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>,
): TurnCost {
  const generations = nodes
    .filter(isAssistant)
    .filter(node => node.turn === turn)
    .sort((a, b) => a.step - b.step)
    .map(node => foldGeneration(node, table))

  let tokens = NO_TOKENS
  let llmMs = 0
  let usd = 0
  let priced = 0
  const unpriced: { step: number; reason: string }[] = []
  const models = new Set<string>()
  for (const line of generations) {
    if (line.tokens !== undefined) tokens = addTokens(tokens, line.tokens)
    llmMs += line.llmMs ?? 0
    if (line.model !== undefined) models.add(`${line.provider ?? '?'}/${line.model}`)
    if (line.cost.status === 'priced' || line.cost.status === 'free') {
      usd += line.cost.usd
      priced += 1
    } else {
      unpriced.push({ step: line.step, reason: line.cost.reason })
    }
  }

  const timing = turnTimings?.get(turn)
  const wallMs = timing?.endTime === undefined ? undefined : Math.max(0, timing.endTime - timing.startTime)
  const firstStep = generations[0]?.step

  return {
    turn,
    generations,
    tokens,
    ...wallMs === undefined ? {} : { wallMs },
    llmMs,
    ...wallMs === undefined ? {} : { nonModelMs: Math.max(0, wallMs - llmMs) },
    usd,
    covered: generations.length > 0 && priced === generations.length,
    unpriced,
    models: [...models],
    stepsOutsideWindow: firstStep !== undefined && firstStep > 1,
  }
}
