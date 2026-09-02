import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RateSource } from './cost-rates.ts'
import type { BilledCostSource } from './billed-costs.ts'
import { billedTurnState } from './billed-costs.ts'
import { formatCost, formatDuration } from './cost-model.ts'
import { costHeadline, costProvenance, foldTurnCost, selectCostNodes, turnOfMessage } from './turn-cost.ts'

/** Values the cost-surface registration hands every badge. */
export interface TurnCostBadgeInjected {
  /** The generation-owned, once-per-client live rate read. */
  readonly rateSource: RateSource
  /** The generation-owned, explicit-demand provider billing source. */
  readonly billedCostSource: BilledCostSource
}

/** Full props of one badge in the assistant action row. */
export type TurnCostBadgeProps = PropsRuntime<'conversation.chat.assistant-actions'> & TurnCostBadgeInjected

/**
 * Per-generation cost and per-step timing for one finished turn.
 *
 * Rendered into upstream's own assistant action row, so it sits with the turn
 * it describes and inherits its lifecycle. Collapsed it is one chip: money and
 * clock, the owner's two top-line metrics. Opened it is the per-step table
 * underneath them.
 * @param props - the slot's owner share plus the injected rate source.
 * @returns the badge.
 */
export function TurnCostBadge({ messageId, useSession, rateSource, billedCostSource }: TurnCostBadgeProps) {
  const subscribe = useCallback((listener: () => void) => rateSource.subscribe(listener), [rateSource])
  const getSnapshot = useCallback(() => rateSource.getSnapshot(), [rateSource])
  const rates = useSyncExternalStore(subscribe, getSnapshot)
  const subscribeBilled = useCallback((listener: () => void) => billedCostSource.subscribe(listener), [billedCostSource])
  const getBilledSnapshot = useCallback(() => billedCostSource.getSnapshot(), [billedCostSource])
  const billedSnapshot = useSyncExternalStore(subscribeBilled, getBilledSnapshot)

  const nodes = useSession(selectCostNodes)
  const sessionId = useSession(state => state.sessionId)
  const turnTimings = useSession(state => state.chat.legacy.turnTimings)
  const turn = useMemo(() => turnOfMessage(nodes, messageId), [nodes, messageId])
  const billed = useMemo(
    () => turn === undefined ? undefined : billedTurnState(billedSnapshot, sessionId, turn),
    [billedSnapshot, sessionId, turn],
  )
  const cost = useMemo(
    () => turn === undefined ? undefined : foldTurnCost(nodes, turn, rates.table, turnTimings, billed?.costs),
    [nodes, turn, rates.table, turnTimings, billed],
  )

  // A message whose turn left the loaded window has nothing truthful to report,
  // and an empty chip beside every older message would be noise.
  if (cost === undefined || cost.generations.length === 0) return null

  return (
    <details className="dshDesktopCostBadge">
      <summary className="dshDesktopCostChip" title="Per-generation cost and per-step timing">
        <span className="dshDesktopCostMoney">{costHeadline(cost)}</span>
        <span className="dshDesktopCostDot" aria-hidden="true">·</span>
        <span>{formatDuration(cost.wallMs ?? cost.llmMs)}</span>
      </summary>
      <div className="dshDesktopCostPanel">
        <table className="dshDesktopCostTable">
          <caption>
            {`Turn ${String(cost.turn)} · ${String(cost.generations.length)} generation${cost.generations.length === 1 ? '' : 's'}`}
            {cost.stepsOutsideWindow && ' · earlier steps are outside the loaded window'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Model</th>
              <th scope="col">TTFT</th>
              <th scope="col">Model time</th>
              <th scope="col">In</th>
              <th scope="col">Cached</th>
              <th scope="col">Out</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {cost.generations.map(line => (
              <tr key={line.step}>
                <th scope="row">{line.step}</th>
                <td>{line.model ?? '—'}</td>
                <td>{formatDuration(line.ttftMs)}</td>
                <td>{formatDuration(line.llmMs)}</td>
                <td>{(line.tokens?.inputTokens ?? 0).toLocaleString()}</td>
                <td>{(line.tokens?.cacheReadTokens ?? 0).toLocaleString()}</td>
                <td>{(line.tokens?.outputTokens ?? 0).toLocaleString()}</td>
                <td
                  className={line.cost.status === 'unpriced' || line.cost.status === 'untokenized' ? 'dshDesktopCostUnknown' : undefined}
                  title={line.cost.status === 'billed'
                    ? `OpenRouter billed value; list-rate estimate: ${formatCost(line.cost.estimate)}`
                    : line.cost.status === 'priced' || line.cost.status === 'free' ? undefined : line.cost.reason}
                >
                  {formatCost(line.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="dshDesktopCostTotals">
          <dt>Wall</dt><dd>{formatDuration(cost.wallMs)}</dd>
          <dt>Model</dt><dd>{formatDuration(cost.llmMs)}</dd>
          <dt>Tools and overhead</dt><dd>{formatDuration(cost.nonModelMs)}</dd>
          <dt>Tokens</dt>
          <dd>
            {`${cost.tokens.inputTokens.toLocaleString()} in · ${cost.tokens.cacheReadTokens.toLocaleString()} cached · ${cost.tokens.outputTokens.toLocaleString()} out`}
          </dd>
          <dt>Cost</dt>
          <dd>
            {costHeadline(cost)}
            {!cost.covered && cost.unpriced.length > 0 && (
              <span className="dshDesktopCostUnknown">
                {` — ${String(cost.unpriced.length)} of ${String(cost.generations.length)} unpriced: ${cost.unpriced[0]?.reason ?? ''}`}
              </span>
            )}
          </dd>
        </dl>
        <p className="dshDesktopCostProvenance">
          {costProvenance(cost, rates.fetchedAt, rates.modelCount, rates.error)}
        </p>
        <div className="dshDesktopCostReconcile">
          <button
            type="button"
            className="dshDesktopCostReconcileControl"
            disabled={billed?.status === 'loading' || billed?.status === 'complete'}
            onClick={() => { void billedCostSource.reconcile(sessionId, cost.turn) }}
          >
            {billed?.status === 'loading' ? 'Reconciling…' : 'Reconcile billed cost'}
          </button>
          <span className="dshDesktopCostReconcileStatus" aria-live="polite">
            {billingStatus(billed?.status, billed?.message)}
          </span>
        </div>
      </div>
    </details>
  )
}

function billingStatus(status: string | undefined, message: string | undefined): string {
  switch (status) {
    case 'complete': return 'All visible generations billed.'
    case 'partial': return 'Some generations are still estimated; retry later.'
    case 'unavailable': return 'Billing is not available yet; retry later.'
    case 'error': return message ?? 'Billed cost unavailable — retry reconciliation.'
    default: return ''
  }
}
