#!/usr/bin/env node
/**
 * Per-generation cost and per-step timing over a DSH session log.
 *
 * This is the JOIN, alone. It is deliberately separate from where the numbers
 * come from and from where they are drawn, because those two are the parts
 * issue #5 still has open rulings on:
 *
 *   - the PRICE SOURCE is an argument, not a constant. The table shape is
 *     `{ <provider>: { <modelId>: { input, output, cacheRead, cacheWrite } } }`
 *     in USD per million tokens, which is byte-for-byte the shape pi-ai's own
 *     model catalogue already uses (`cost` in
 *     `@earendil-works/pi-ai/dist/providers/data/*.json`). A hand-seeded file,
 *     that catalogue, OpenRouter's live `/api/v1/models`, or a reconciliation
 *     against real billed cost all produce this same table, so whichever one
 *     the owner rules for drops in here unchanged.
 *   - the SURFACE is a caller's problem. `foldRunTelemetry` and `priceRun`
 *     return plain data; this file's CLI is one consumer, an in-UI panel is
 *     another, and neither is baked in.
 *
 * WHAT IS NEVER DONE HERE: an unknown price is never rendered as zero. A model
 * with no table entry, or with an entry that fails to price a bucket the run
 * actually used, reports `unpriced` and is EXCLUDED from the priced total,
 * which is reported alongside the count of what it could not cover. A run
 * whose cost line reads `$0.00` must mean the tokens were free, not that
 * nobody knew the rate.
 *
 * Usage:
 *   node scripts/session-cost.mjs <export-dir|session.jsonl> [--prices <file>] [--json]
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BIN = 'session-cost'

/** A cost line that could not be computed reports why, so a caller never prints a guess as a fact. */
export const UNPRICED = 'unpriced'
/** Every bucket the run used is rated at zero — a free model, which is a known price, not a missing one. */
export const FREE = 'free'
/** Rated in full. */
export const PRICED = 'priced'
/** The step assembled no usage report at all (cancelled or interrupted before the provider answered). */
export const UNTOKENIZED = 'untokenized'
/** Reconciled against the provider's generation record; the list-rate estimate remains nested. */
export const BILLED = 'billed'

/**
 * Every status {@link priceStep} can report, as one list.
 *
 * DERIVED from the constants above rather than restating their spellings, so
 * this cannot drift from them by a typo. Its purpose is to be comparable: the
 * desktop client declares the same set as `COST_STATUSES`, and
 * `dsh-plugin-desktop/tests/client-cost-parity.spec.ts` requires the two sets
 * to be equal in BOTH directions. A status added to either implementation and
 * not the other fails there — which the first version of that sweep could not
 * catch, because it enumerated only the desktop side.
 */
export const STATUSES = [PRICED, FREE, UNPRICED, UNTOKENIZED, BILLED]

/**
 * Overlay a validated provider charge without discarding the original estimate.
 * This helper is pure: the offline CLI never performs provider reconciliation.
 * @param {object} estimate - one result from {@link priceStep}.
 * @param {number} usd - provider-backed billed USD.
 * @returns {object} the billed line.
 */
export function withBilledCost(estimate, usd) {
  if (!Number.isFinite(usd) || usd < 0) throw new TypeError('billed cost must be a finite nonnegative number')
  return { status: BILLED, usd, estimate }
}

/** The four disjoint buckets upstream records, in the order a report reads them. */
export const BUCKETS = /** @type {const} */ ([
  ['inputTokens', 'input'],
  ['cacheReadTokens', 'cacheRead'],
  ['cacheWriteTokens', 'cacheWrite'],
  ['outputTokens', 'output'],
])

/** Raised for an input this tool refuses rather than guesses at. */
export class SessionCostError extends Error {}

/**
 * Read a session log from an export directory or a `session.jsonl` path.
 * @param {string} target - export directory or the jsonl file itself.
 * @returns {object[]} parsed events in log order.
 */
export function readSessionEvents(target) {
  let file = target
  try {
    if (statSync(target).isDirectory()) file = join(target, 'session.jsonl')
  } catch {
    throw new SessionCostError(`${BIN}: cannot read ${target}`)
  }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new SessionCostError(`${BIN}: cannot read ${file}`)
  }
  return parseSessionEvents(text)
}

/**
 * Parse a session log body.
 * @param {string} text - the jsonl body.
 * @returns {object[]} parsed events in log order.
 */
export function parseSessionEvents(text) {
  const events = []
  let line = 0
  for (const raw of text.split(/\r?\n/)) {
    line += 1
    if (raw.trim() === '') continue
    try {
      events.push(JSON.parse(raw))
    } catch {
      throw new SessionCostError(`${BIN}: line ${String(line)} is not valid JSON`)
    }
  }
  return events
}

function stepKey(turn, step) {
  return `${String(turn)}/${String(step)}`
}

/**
 * The OpenRouter generation id, when the route recorded one.
 *
 * pi-ai stores the provider's response id in the adapter-private replay state
 * of the assembled assistant message. For an OpenRouter route this is the
 * `gen-…` id that `GET /api/v1/generation` is keyed by, so it is the join key
 * to real billed cost — the one piece of provenance that makes reconciliation
 * possible without touching a pinned package.
 * @param {object} message - the assistant message record.
 * @returns {string | undefined} the response id when present.
 */
export function responseIdOf(message) {
  const response = message?.source?.replayState?.response
  return typeof response?.responseId === 'string' ? response.responseId : undefined
}

/**
 * Fold a session log into per-step telemetry.
 *
 * Wall time is `step/start` to `step/end`, which is what an operator watching
 * the app experiences. `llmMs` is `step/start` to `assistant/message`, matching
 * the `sessionStats` projection's own definition so the two are comparable.
 * `toolMs` pairs `tool/call` with `tool/result` by `callId`, likewise.
 * @param {object[]} events - parsed session events in log order.
 * @returns {{ steps: object[], sessionId: string | undefined }} per-step rows.
 */
export function foldRunTelemetry(events) {
  /** @type {Map<string, object>} */
  const steps = new Map()
  /** @type {Map<string, { key: string, time: number, name: string }>} */
  const pendingCalls = new Map()
  let sessionId
  const at = (turn, step) => {
    const key = stepKey(turn, step)
    let row = steps.get(key)
    if (row === undefined) {
      row = {
        turn, step,
        startTime: undefined, endTime: undefined, messageTime: undefined,
        usage: undefined, provider: undefined, model: undefined,
        responseId: undefined, toolMs: 0, toolNames: [],
      }
      steps.set(key, row)
    }
    return row
  }

  for (const event of events) {
    const data = event?.data
    switch (event?.type) {
      case 'session':
        sessionId = event.id
        break
      case 'step/start':
        at(data.turn, data.step).startTime = event.time
        break
      case 'step/end':
        at(data.turn, data.step).endTime = event.time
        break
      case 'assistant/message': {
        const row = at(data.turn, data.step)
        row.messageTime = event.time
        if (data.usage !== undefined) row.usage = data.usage
        row.provider = data.message?.source?.provider
        row.model = data.message?.source?.model
        row.responseId = responseIdOf(data.message)
        break
      }
      case 'tool/call':
        pendingCalls.set(data.callId, { key: stepKey(data.turn, data.step), time: event.time, name: data.name })
        at(data.turn, data.step).toolNames.push(data.name)
        break
      case 'tool/result': {
        const callId = data.message?.source?.callId
        const call = callId === undefined ? undefined : pendingCalls.get(callId)
        if (call !== undefined) {
          pendingCalls.delete(callId)
          const row = steps.get(call.key)
          if (row !== undefined) row.toolMs += event.time - call.time
        }
        break
      }
      default:
        break
    }
  }

  const rows = [...steps.values()]
    .sort((a, b) => a.turn - b.turn || a.step - b.step)
    .map(row => ({
      ...row,
      wallMs: row.startTime !== undefined && row.endTime !== undefined ? row.endTime - row.startTime : undefined,
      llmMs: row.startTime !== undefined && row.messageTime !== undefined ? row.messageTime - row.startTime : undefined,
    }))
  return { steps: rows, sessionId }
}

/**
 * Look a model's rates up in a price table.
 * @param {object} table - `{ provider: { model: { input, output, cacheRead, cacheWrite } } }` in USD/Mtok.
 * @param {string | undefined} provider - route name recorded on the message.
 * @param {string | undefined} model - model id recorded on the message.
 * @returns {object | undefined} the rate record, when the table has one.
 */
export function ratesFor(table, provider, model) {
  if (provider === undefined || model === undefined) return undefined
  const rates = table?.[provider]?.[model]
  return typeof rates === 'object' && rates !== null ? rates : undefined
}

/**
 * Resolve the rates in force for a prompt of this size.
 *
 * Mirrors pi-ai's own tier resolution (`dist/models.js` `calculateCost`) and
 * the desktop client's `ratesInForce`, which
 * `dsh-plugin-desktop/tests/client-cost-parity.spec.ts` holds equal to this
 * one: the threshold is compared against the WHOLE prompt (input + both cache
 * buckets) and the highest matched threshold wins, so tiers may be listed in
 * any order. `x-ai/grok-4.5` really does double every rate above 200,000
 * prompt tokens, and a long-context Parametria run crosses that line
 * routinely.
 * @param {object} rates - the model's rate record.
 * @param {object} usage - the step's token buckets.
 * @returns {object} the flat rates to multiply by.
 */
export function ratesInForce(rates, usage) {
  const promptTokens = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  let winner = rates
  let matched = -1
  for (const tier of rates.tiers ?? []) {
    if (promptTokens > tier.inputTokensAbove && tier.inputTokensAbove > matched) {
      winner = tier
      matched = tier.inputTokensAbove
    }
  }
  return winner
}

/**
 * Price one folded step.
 *
 * A bucket the run actually used but the table does not rate makes the whole
 * step `unpriced`: rating three buckets out of four and calling the result a
 * cost would understate it silently, which is the failure this whole tool
 * exists to avoid.
 * @param {object} row - a folded step.
 * @param {object} table - the price table.
 * @returns {{ status: string, usd?: number, reason?: string }} the cost line.
 */
export function priceStep(row, table) {
  if (row.usage === undefined) return { status: UNTOKENIZED, reason: 'the step recorded no usage report' }
  const rates = ratesFor(table, row.provider, row.model)
  if (rates === undefined) {
    const key = `${row.provider ?? '?'}/${row.model ?? '?'}`
    return { status: UNPRICED, reason: `no price entry for ${key}` }
  }
  const inForce = ratesInForce(rates, row.usage)
  let usd = 0
  let rated = 0
  for (const [field, rate] of BUCKETS) {
    const tokens = row.usage[field] ?? 0
    if (tokens === 0) continue
    const perMillion = inForce[rate]
    if (typeof perMillion !== 'number' || !Number.isFinite(perMillion)) {
      return { status: UNPRICED, reason: `${row.provider ?? '?'}/${row.model ?? '?'} has no ${rate} rate, and the step used ${String(tokens)} ${rate} tokens` }
    }
    usd += (perMillion / 1_000_000) * tokens
    rated += perMillion
  }
  return { status: rated === 0 ? FREE : PRICED, usd }
}

/**
 * Price a whole run.
 *
 * `usd` is the sum of what could be priced ONLY. Anything else is counted, not
 * absorbed: a caller that prints `usd` without also printing `unpriced` is
 * printing a floor, and `covered` says so outright.
 * @param {object[]} rows - folded steps.
 * @param {object} table - the price table.
 * @returns {object} per-step lines and the run summary.
 */
export function priceRun(rows, table) {
  const lines = rows.map(row => ({ ...row, cost: priceStep(row, table) }))
  const totals = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  let usd = 0
  let priced = 0
  const unpriced = []
  let wallMs = 0
  let llmMs = 0
  let toolMs = 0
  for (const line of lines) {
    for (const [field] of BUCKETS) totals[field] += line.usage?.[field] ?? 0
    wallMs += line.wallMs ?? 0
    llmMs += line.llmMs ?? 0
    toolMs += line.toolMs
    if (line.cost.status === PRICED || line.cost.status === FREE) {
      usd += line.cost.usd ?? 0
      priced += 1
    } else {
      unpriced.push({ turn: line.turn, step: line.step, status: line.cost.status, reason: line.cost.reason })
    }
  }
  const models = [...new Set(lines.filter(l => l.model !== undefined).map(l => `${String(l.provider)}/${String(l.model)}`))]
  return {
    lines,
    summary: {
      steps: lines.length,
      pricedSteps: priced,
      covered: lines.length === 0 || priced === lines.length,
      usd,
      unpriced,
      totals,
      wallMs,
      llmMs,
      toolMs,
      models,
    },
  }
}

function ms(value) {
  return value === undefined ? '—' : `${(value / 1000).toFixed(1)}s`
}

function money(cost) {
  if (cost.status === PRICED || cost.status === FREE) return `$${(cost.usd ?? 0).toFixed(4)}`
  return cost.status
}

/**
 * Render the run as a fixed-width report.
 * @param {object} run - the `priceRun` result.
 * @returns {string} the report body.
 */
export function formatReport(run) {
  const head = ['turn/step', 'model', 'wall', 'llm', 'tool', 'in', 'cacheRd', 'out', 'cost'].join('\t')
  const body = run.lines.map(line => [
    `${String(line.turn)}/${String(line.step)}`,
    line.model ?? '—',
    ms(line.wallMs),
    ms(line.llmMs),
    ms(line.toolMs),
    String(line.usage?.inputTokens ?? 0),
    String(line.usage?.cacheReadTokens ?? 0),
    String(line.usage?.outputTokens ?? 0),
    money(line.cost),
  ].join('\t'))
  const s = run.summary
  const tail = [
    '',
    `steps            ${String(s.steps)} (${String(s.pricedSteps)} priced)`,
    `models           ${s.models.join(', ') || '—'}`,
    `wall             ${ms(s.wallMs)}   llm ${ms(s.llmMs)}   tool ${ms(s.toolMs)}`,
    `tokens           in ${String(s.totals.inputTokens)} · cacheRead ${String(s.totals.cacheReadTokens)} · cacheWrite ${String(s.totals.cacheWriteTokens)} · out ${String(s.totals.outputTokens)}`,
    s.covered
      ? `cost             $${s.usd.toFixed(4)}`
      : `cost             $${s.usd.toFixed(4)} OVER ${String(s.pricedSteps)}/${String(s.steps)} STEPS — a floor, not the run's cost`,
  ]
  if (!s.covered) {
    for (const gap of s.unpriced) tail.push(`  unpriced ${String(gap.turn)}/${String(gap.step)}: ${String(gap.reason)}`)
  }
  return [head, ...body, ...tail].join('\n')
}

function parseArgs(argv) {
  const options = { target: undefined, prices: undefined, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--prices') {
      index += 1
      options.prices = argv[index]
      if (options.prices === undefined) throw new SessionCostError(`${BIN}: --prices needs a file path`)
    } else if (arg.startsWith('--')) throw new SessionCostError(`${BIN}: unknown option ${arg}`)
    else if (options.target === undefined) options.target = arg
    else throw new SessionCostError(`${BIN}: unexpected argument ${arg}`)
  }
  if (options.target === undefined) {
    throw new SessionCostError(`${BIN}: usage: node scripts/session-cost.mjs <export-dir|session.jsonl> [--prices <file>] [--json]`)
  }
  return options
}

/** True only when this module is the process entry point (`pathToFileURL` is what makes that comparison correct on Windows drive paths). */
const RUN_AS_CLI = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (RUN_AS_CLI) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const table = options.prices === undefined ? {} : JSON.parse(readFileSync(options.prices, 'utf8'))
    const run = priceRun(foldRunTelemetry(readSessionEvents(options.target)).steps, table)
    process.stdout.write(options.json ? `${JSON.stringify(run.summary, null, 2)}\n` : `${formatReport(run)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof SessionCostError ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export { BIN }
