/**
 * Fences the two `patches/` entries that end parent-side error laundering
 * (issue #40): a child that dies with a turn-level failure must hand the parent
 * the child's own `{code, message}` and the child session id, not a bare
 * "subagent run failed".
 *
 * The mis-route reproduced here is the observed incident: a validator subagent
 * pointed at a `parametria-vision` provider that has no registered adapter, so
 * the child's turn ends with `NO_ADAPTER`. Everything downstream of the child
 * boundary is the shipping code path — the real `SubagentRuntime`, the real
 * in-process spawn provider, the real `dsh-tool-subagent`.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  limitSubagentDiagnostic,
  settleRun,
  type SubagentResult,
} from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { describe, expect, it } from 'vitest'

/** The provider the validator preset was mis-routed to in the observed runs. */
const MISROUTED_PROVIDER = 'parametria-vision'
/** The seam's documented ceiling for `SubagentResult.diagnostic`. */
const MAX_DIAGNOSTIC_BYTES = 4096

/** Minimal adapter that streams one fixed assistant answer. */
class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly reply: string) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Adapter whose stream throws a plain (non-`LlmError`) failure. */
class ThrowingAdapter extends LlmAdapter {
  constructor(private readonly failure: string) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await Promise.resolve()
    throw new Error(this.failure)
  }
}

/** Mount the real host services a delegating parent needs. */
async function setup(): Promise<{ ctx: Context; parent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn)
  const parent = ctx.agentLoop.create(SessionId('parent-session'), {
    provider: 'desktop-parent',
    model: 'parent-model',
  })
  return { ctx, parent }
}

/** Start one child through the real seam, mis-routed unless overridden. */
function startChild(
  ctx: Context,
  parent: Agent,
  agentOptions: { provider: string; model: string } = {
    provider: MISROUTED_PROVIDER,
    model: 'vision-preview',
  },
) {
  return ctx.subagents.start('spawn', {
    label: 'validate the render',
    prompt: [{ type: 'text', text: 'compare the screenshot against the drawing' }],
    parent,
    signal: new AbortController().signal,
    agentOptions,
  })
}

/** Flatten a tool result's content blocks to their text. */
function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('subagent parent-side error surface', () => {
  it("hands the parent's tool result the child's error code, message, and session id", async () => {
    const { ctx, parent } = await setup()
    await ctx.plugin(ToolSubagent, {
      provider: 'spawn',
      agentOptions: { provider: MISROUTED_PROVIDER, model: 'vision-preview' },
    })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('call-mis-routed'),
      name: 'subagent',
      arguments: {
        description: 'validate the render',
        prompt: 'compare the screenshot against the drawing',
        run_in_background: false,
      },
      agent: parent,
    })

    expect(result.isError).toBe(true)
    const text = resultText(result)
    // The headline stays upstream's wording; the cause rides the seam's
    // diagnostic channel, which rc.8 already renders.
    expect(text).toContain('subagent run failed')
    expect(text).toContain('NO_ADAPTER')
    expect(text).toContain(`no adapter registered for provider "${MISROUTED_PROVIDER}"`)
    expect(text).toMatch(/\(child session [0-9a-f-]{36}\)/)
  })

  it('names the child session id that a harvest can actually open', async () => {
    const { ctx, parent } = await setup()
    const run = await startChild(ctx, parent)
    const result: SubagentResult = await run.result

    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toBe(
      `NO_ADAPTER — no adapter registered for provider "${MISROUTED_PROVIDER}" (child session ${run.id})`,
    )
    await run.dispose()
  })

  it('carries the same cause through the background settle path', async () => {
    const { ctx, parent } = await setup()
    const run = await startChild(ctx, parent)
    const childId = run.id
    const outcome = await settleRun(run)

    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toBe(
      `error; diagnostic: NO_ADAPTER — no adapter registered for provider "${MISROUTED_PROVIDER}" (child session ${childId})`,
    )
  })

  it('flattens a non-LlmError child failure to UNKNOWN rather than dropping it', async () => {
    const { ctx, parent } = await setup()
    ctx.llm.registerAdapter(['broken-vision'], new ThrowingAdapter('vision transport exploded'))
    const run = await startChild(ctx, parent, { provider: 'broken-vision', model: 'v1' })
    const result: SubagentResult = await run.result

    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('UNKNOWN')
    expect(result.diagnostic).toContain('vision transport exploded')
    expect(result.diagnostic).toContain(`(child session ${run.id})`)
    await run.dispose()
  })

  it('leaves a cleanly completed child without a diagnostic', async () => {
    const { ctx, parent } = await setup()
    ctx.llm.registerAdapter(['working-vision'], new ScriptedAdapter('the render matches'))
    const run = await startChild(ctx, parent, { provider: 'working-vision', model: 'v1' })
    const result: SubagentResult = await run.result

    expect(result.stopReason).toBe('completed')
    expect(result.diagnostic).toBeUndefined()
    await run.dispose()
  })

  it('exports the seam-owned diagnostic bound the in-process driver applies', () => {
    expect(limitSubagentDiagnostic('short detail')).toBe('short detail')
    const truncated = limitSubagentDiagnostic('x'.repeat(MAX_DIAGNOSTIC_BYTES * 2))
    expect(truncated.endsWith('[diagnostic truncated]')).toBe(true)
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
  })
})
