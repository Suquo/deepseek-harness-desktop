import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AssistantMessageNode, ConversationNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { TRAJECTORY_VIEW_TARGET, readTrajectoryNodes, selectCostNodes } from '../src/client/turn-cost.ts'

/**
 * The cost surface reads model attribution off the `trajectory` view target,
 * because the Chat Definition that fills `chat.legacy.nodes` never populates
 * `provenance` on its assistant nodes. That is a fact about a PINNED upstream
 * package, restated in our source, and therefore a checkable claim (standard
 * 12) that a pin bump can invalidate — so these fences read the installed
 * package rather than trusting the comment.
 */

const require_ = createRequire(import.meta.url)
const trajectoryRoot = dirname(require_.resolve('@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const conversationRoot = dirname(require_.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json'))

function read(root: string, relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

describe('the trajectory view target we depend on', () => {
  it('is still the declared name and still exposes eventNodes', () => {
    const contract = read(trajectoryRoot, 'lib/types/client/trajectory-contract.d.ts')
    expect(contract).toMatch(new RegExp(String.raw`interface ConversationViewSnapshotMap \{[\s\S]*?\b${TRAJECTORY_VIEW_TARGET}: TrajectorySnapshot;`))
    expect(contract).toMatch(/interface TrajectorySnapshot \{[\s\S]*?readonly eventNodes: readonly ConversationNode\[\];/)
  })

  it('still fills provenance from the assistant message source', () => {
    // The load-bearing difference from the chat target. If a pin bump drops
    // this, every generation silently becomes `unpriced` — the fence turns that
    // into a build failure instead of a quiet regression in the UI.
    const bundle = read(trajectoryRoot, 'lib/client.js')
    expect(bundle).toMatch(/provenance: \{\s*provider: event\.data\.message\.source\.provider,\s*model: event\.data\.message\.source\.model\s*\}/)
  })

  it('records why the chat target cannot be used instead', () => {
    // The chat Definition builds the same node shape with usage and timing but
    // NO provenance. Measured in the running app before it was believed: every
    // model column read as unknown and all 50 generations priced as unpriced.
    const bundle = read(conversationRoot, 'lib/client.js')
    const finalNode = /kind: "assistant",\s*seq: event\.seq,[\s\S]{0,600}?\n\t*\};/.exec(bundle)?.[0] ?? ''
    expect(finalNode).toContain('usage: event.data.usage')
    expect(finalNode).not.toContain('provenance')
  })

  it('is a declared dependency, since we read its contract', () => {
    const manifest = JSON.parse(read(join(trajectoryRoot, '..', '..', '..'), 'package.json')) as { dependencies?: Record<string, string> }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-client-ui-trajectory']).toBeDefined()
  })
})

function assistant(step: number, provenance?: { provider: string; model: string }): AssistantMessageNode {
  return {
    kind: 'assistant', seq: step, time: step * 1000, turn: 1, step,
    messageId: `m-${String(step)}` as MessageId, blocks: [],
    usage: { inputTokens: 10, outputTokens: 1 },
    ...provenance === undefined ? {} : { provenance },
  }
}

function snapshot(trajectory: readonly ConversationNode[] | undefined, legacy: readonly ConversationNode[]): ConversationSnapshot {
  return {
    views: { get: (target: string) => target === 'trajectory' && trajectory !== undefined ? { eventNodes: trajectory } : undefined },
    chat: { legacy: { nodes: legacy } },
  } as unknown as ConversationSnapshot
}

describe('choosing the node source', () => {
  it('prefers the attributable trajectory nodes', () => {
    const trajectory = [assistant(1, { provider: 'openrouter', model: 'x/y' })]
    const chosen = selectCostNodes(snapshot(trajectory, [assistant(1)]))
    expect(chosen).toBe(trajectory)
  })

  it('falls back to the chat nodes rather than showing nothing', () => {
    // Losing money is better than losing the timings too: a profile without the
    // trajectory view still gets exact tokens and durations, priced `unpriced`.
    const legacy = [assistant(1)]
    expect(selectCostNodes(snapshot(undefined, legacy))).toBe(legacy)
    expect(selectCostNodes(snapshot([], legacy))).toBe(legacy)
  })

  it('refuses a view snapshot whose shape it does not recognise', () => {
    expect(readTrajectoryNodes(snapshot(undefined, []).views)).toBeUndefined()
    const wrong = { get: () => ({ eventNodes: 'not an array' }) } as unknown as ConversationSnapshot['views']
    expect(readTrajectoryNodes(wrong)).toBeUndefined()
  })
})
