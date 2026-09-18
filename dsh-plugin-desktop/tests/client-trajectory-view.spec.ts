import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import {
  TRAJECTORY_HOOK_PROP, TRAJECTORY_VIEW_TARGET, readTrajectoryHook, readTrajectoryNodes, selectCostNodes,
} from '../src/client/turn-cost.ts'

/**
 * The cost surface reads model attribution off the `trajectory` view target,
 * because the Chat Definition that fills the Chat target's `legacy.nodes` never populates
 * `provenance` on its assistant nodes. That is a fact about a PINNED upstream
 * package, restated in our source, and therefore a checkable claim (standard
 * 12) that a pin bump can invalidate — so these fences read the installed
 * package rather than trusting the comment.
 */

const require_ = createRequire(import.meta.url)
const trajectoryRoot = dirname(require_.resolve('@deepseek-ai/dsh-client-ui-trajectory/package.json'))
// The Chat Definition moved from the conversation package into the chat package at 0.1.5-rc.2.
const chatRoot = dirname(require_.resolve('@deepseek-ai/dsh-client-ui-chat/package.json'))

function read(root: string, relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

describe('the trajectory view target we depend on', () => {
  it('is still the declared name and still exposes eventNodes', () => {
    const contract = read(trajectoryRoot, 'lib/types/client/trajectory-contract.d.ts')
    expect(contract).toMatch(new RegExp(String.raw`interface ConversationViewSnapshotMap \{[\s\S]*?\b${TRAJECTORY_VIEW_TARGET}: TrajectorySnapshot;`))
    expect(contract).toMatch(/interface TrajectorySnapshot \{[\s\S]*?readonly eventNodes: readonly ConversationNode\[\];/)
  })

  it('still hands session-scoped slots the hook the surface reads it through', () => {
    // Targets assemble lazily since 0.1.5-rc.2, so the surface must subscribe
    // through this hook (which activates the target) rather than read the view
    // store. It reaches the badge through the same untyped edge as the snapshot,
    // so both halves of that edge are fenced here: the declared prop name and
    // the runtime provision of the `trajectory` hook it resolves from.
    const contract = read(trajectoryRoot, 'lib/types/client/trajectory-contract.d.ts')
    expect(contract).toMatch(new RegExp(String.raw`interface SessionStandardProps \{[\s\S]*?\b${TRAJECTORY_HOOK_PROP}: UseTrajectory;`))
    expect(`use${TRAJECTORY_VIEW_TARGET[0]?.toUpperCase() ?? ''}${TRAJECTORY_VIEW_TARGET.slice(1)}`).toBe(TRAJECTORY_HOOK_PROP)
    const bundle = read(trajectoryRoot, 'lib/client.js')
    expect(bundle).toMatch(new RegExp(String.raw`hooks: \["${TRAJECTORY_VIEW_TARGET}"\]`))
    expect(bundle).toMatch(new RegExp(String.raw`\.target\("${TRAJECTORY_VIEW_TARGET}"\)`))
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
    const bundle = read(chatRoot, 'lib/client.js')
    const finalNode = /kind: "assistant",\s*seq: event\.seq,[\s\S]{0,600}?\n\t*\};/.exec(bundle)?.[0] ?? ''
    expect(finalNode).toContain('usage: event.data.usage')
    expect(finalNode).not.toContain('provenance')
  })

  it('is deliberately NOT a declared dependency of this package', () => {
    // Declaring it was tried and reverted: `verify:runtime-closure` refused it,
    // because the package requires `react-dom` as a first-party peer and the
    // packaged runtime closure would have had to grow to carry it. Nothing here
    // imports the package — the view is read through an untyped edge at runtime
    // and its contract is read off disk by these fences — so the dependency
    // would buy a wider shipped closure for a types-only need. It resolves
    // transitively because the composed web-app bundle already carries it,
    // which is also why the view is present for the surface to read.
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-client-ui-trajectory']).toBeUndefined()
    expect(manifest.devDependencies?.['@deepseek-ai/dsh-client-ui-trajectory']).toBeUndefined()
    // The claim that keeps the above true: no source module imports it.
    const sources = ['turn-cost.ts', 'TurnCostBadge.tsx', 'cost-surface.ts', 'cost-model.ts', 'cost-rates.ts']
      .map(name => readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8'))
    expect(sources.some(source => source.includes('dsh-client-ui-trajectory'))).toBe(false)
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

describe('choosing the node source', () => {
  it('prefers the attributable trajectory nodes', () => {
    const trajectory = [assistant(1, { provider: 'openrouter', model: 'x/y' })]
    const chosen = selectCostNodes(readTrajectoryNodes({ eventNodes: trajectory }), [assistant(1)])
    expect(chosen).toBe(trajectory)
  })

  it('falls back to the chat nodes rather than showing nothing', () => {
    // Losing money is better than losing the timings too: a profile without the
    // trajectory view still gets exact tokens and durations, priced `unpriced`.
    const legacy = [assistant(1)]
    expect(selectCostNodes(readTrajectoryNodes(undefined), legacy)).toBe(legacy)
    expect(selectCostNodes(readTrajectoryNodes({ eventNodes: [] }), legacy)).toBe(legacy)
  })

  it('refuses a trajectory snapshot whose shape it does not recognise', () => {
    expect(readTrajectoryNodes(undefined)).toBeUndefined()
    expect(readTrajectoryNodes({})).toBeUndefined()
    expect(readTrajectoryNodes({ eventNodes: 'not an array' })).toBeUndefined()
  })
})

describe('finding the trajectory hook on the slot props', () => {
  it('reads the hook the trajectory view supplies', () => {
    const useTrajectory = <T,>(selector: (snapshot: unknown) => T): T => selector({ eventNodes: [] })
    expect(readTrajectoryHook({ [TRAJECTORY_HOOK_PROP]: useTrajectory })).toBe(useTrajectory)
  })

  it('reports no hook when no trajectory view is composed, so the surface falls back to the chat nodes', () => {
    expect(readTrajectoryHook({})).toBeUndefined()
    expect(readTrajectoryHook({ [TRAJECTORY_HOOK_PROP]: 'not a hook' })).toBeUndefined()
  })
})
