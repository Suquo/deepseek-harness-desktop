/** Fences for Parametria's text-session `read_image` fallback (issue #54). */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import {
  CallId,
  createUserMessage,
  LlmAdapter,
  LlmRuntime,
  type GenerateOptions,
  type LlmCallConfig,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as ReadImageFallback from '../src/parametria-read-image-fallback.ts'
import {
  apply,
  installReadImageFallback,
} from '../src/parametria-read-image-fallback.ts'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)
const signal = new AbortController().signal

class ModalityAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: model === 'vision-model' ? ['text', 'image'] : ['text'],
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    await Promise.resolve()
  }
}

let workdir: string
let attachmentHome: string
let nextCall = 0

beforeEach(async () => {
  const root = join(process.cwd(), '.read-image-fallback-test-')
  await mkdir(root, { recursive: true })
  workdir = await mkdtemp(join(root, 'work-'))
  attachmentHome = await mkdtemp(join(root, 'home-'))
})

afterEach(async () => {
  await rm(join(process.cwd(), '.read-image-fallback-test-'), { recursive: true, force: true })
})

function fakeAgent(config: LlmCallConfig): Agent {
  return {
    options: {},
    session: {
      header: { cwd: workdir },
      requestHeader: () => ({ config }),
    },
  } as unknown as Agent
}

async function setup(config = {
  provider: 'parametria-vision',
  model: 'vision-model',
}, install = true) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: workdir })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(LocalAttachmentStore, { dshHome: attachmentHome })
  await ctx.plugin(LlmRuntime)
  const adapter = new ModalityAdapter()
  ctx.llm.registerAdapter(['session-text', 'parametria-vision'], adapter)
  if (install) installReadImageFallback(ctx, config)
  await ctx.plugin(ToolFs)
  return { ctx, adapter }
}

async function readImage(ctx: Context, agent: Agent, executionSignal = signal) {
  return ctx.tools.execute({
    signal: executionSignal,
    callId: CallId(`fallback-image-${++nextCall}`),
    name: 'read_image',
    arguments: { file_path: 'red.png' },
    agent,
  })
}

function resolveRequestRoute(
  ctx: Context,
  agent: Agent,
  config: LlmCallConfig,
  turn = 1,
  step = 2,
  requestSignal = signal,
) {
  return ctx.waterfall('agent/request', {
    agent,
    turn,
    step,
    signal: requestSignal,
  }, () => Promise.resolve(config))
}

describe('patched read_image modality gate', () => {
  it('commits the image for a text session and routes the rest of that turn through vision', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const original = {
      provider: 'session-text',
      model: 'text-model',
      reasoningEffort: 'high',
      temperature: 0.2,
    } as LlmCallConfig
    const agent = fakeAgent(original)
    expect(await resolveRequestRoute(ctx, agent, original, 1, 1)).toEqual(original)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(false)
    expect(result.content.map(block => block.type)).toEqual(['text', 'image'])
    expect(await resolveRequestRoute(ctx, agent, original, 1, 2)).toEqual({
      provider: 'parametria-vision',
      model: 'vision-model',
      temperature: 0.2,
    })
  })

  it('restores the complete prior config after the fallback turn', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const original = {
      provider: 'session-text',
      model: 'text-model',
      reasoningEffort: 'high',
      temperature: 0.2,
      maxTokens: 1234,
      stop: ['DONE'],
    } as LlmCallConfig
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)
    await readImage(ctx, agent)
    await resolveRequestRoute(ctx, agent, original, 1, 2)
    await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal })

    const restored = await resolveRequestRoute(ctx, agent, {
      provider: 'parametria-vision',
      model: 'vision-model',
      maxTokens: 65_536,
    }, 2, 1)

    expect(restored).toEqual(original)
    expect(await resolveRequestRoute(ctx, agent, restored, 2, 2)).toEqual(restored)
  })

  it('projects the historical tool-result image to stable text on the restored text route', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx, adapter } = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)
    const result = await readImage(ctx, agent)
    expect(result.isError).toBe(false)
    await resolveRequestRoute(ctx, agent, original, 1, 2)
    const restored = await resolveRequestRoute(ctx, agent, {
      provider: 'parametria-vision',
      model: 'vision-model',
    }, 2, 1)

    const history = createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId('historical-read-image'),
        content: result.content,
      }],
      source: { kind: 'plugin', plugin: 'parametria-read-image-fallback-test' },
    })
    for await (const _chunk of ctx.llm.stream({ ...restored, messages: [history], signal })) {
      // The adapter intentionally yields no response; only its request boundary matters.
    }

    const dispatched = adapter.requests.at(-1)
    expect(dispatched).toMatchObject(original)
    const projected = dispatched?.messages[0]?.content[0]
    expect(projected?.type).toBe('tool-result')
    if (projected?.type !== 'tool-result') throw new Error('missing projected tool result')
    expect(projected.content).toEqual([
      result.content[0],
      {
        type: 'text',
        text: expect.stringMatching(
          /^\[image omitted because this model accepts text only; attachment sha256:[0-9a-f]{8}\]$/u,
        ),
      },
    ])
    expect(result.content[1]?.type).toBe('image')
  })

  it('keeps the fallback active when turn-stopping steering continues the same turn', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)
    await readImage(ctx, agent)
    await resolveRequestRoute(ctx, agent, original, 1, 2)

    await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal })

    expect(await resolveRequestRoute(ctx, agent, original, 1, 3)).toEqual({
      provider: 'parametria-vision',
      model: 'vision-model',
    })
  })

  it('clears an active fallback when the agent is disposed mid-turn', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)
    await readImage(ctx, agent)

    ctx.emit('agent/disposed', { agent })

    expect(await resolveRequestRoute(ctx, agent, original, 1, 2)).toEqual(original)
  })

  it('restores on the next turn after cancellation without a turn-stopping event', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const fallback = { provider: 'parametria-vision', model: 'vision-model' }
    const agent = fakeAgent(original)
    const activeTurn = new AbortController()
    await resolveRequestRoute(ctx, agent, original, 1, 1, activeTurn.signal)
    await readImage(ctx, agent, activeTurn.signal)
    expect(await resolveRequestRoute(ctx, agent, original, 1, 2, activeTurn.signal)).toEqual(fallback)

    activeTurn.abort(new Error('turn cancelled'))

    expect(await resolveRequestRoute(ctx, agent, fallback, 2, 1)).toEqual(original)
  })

  it('preserves a model selection changed before restoration', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)
    await readImage(ctx, agent)
    const changed = { provider: 'another-route', model: 'another-model' }

    expect(await resolveRequestRoute(ctx, agent, changed, 2, 1)).toEqual(changed)
  })

  it('does not activate an image-ineligible fallback', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup({ provider: 'session-text', model: 'text-model' })
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('does not declare image input'),
      }),
    ])
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(
      'route "session-text/text-model" does not declare image input',
    ))
    expect(await resolveRequestRoute(ctx, agent, original, 1, 2)).toEqual(original)
  })

  it('preserves the upstream refusal when the configured fallback route is unavailable', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup({ provider: 'missing-route', model: 'missing-model' })
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('model "text-model" does not declare image input'),
      }),
    ])
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(
      'route "missing-route/missing-model" is unreachable',
    ))
    expect(await resolveRequestRoute(ctx, agent, original, 1, 2)).toEqual(original)
  })

  it('does not activate the route when image admission fails after modality validation', async () => {
    const { ctx } = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)
    await resolveRequestRoute(ctx, agent, original, 1, 1)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('not found'),
      }),
    ])
    expect(await resolveRequestRoute(ctx, agent, original, 1, 2)).toEqual(original)
  })

  it('leaves an already image-capable session on its own route', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const ownRoute = { provider: 'parametria-vision', model: 'vision-model' }
    const agent = fakeAgent(ownRoute)
    await resolveRequestRoute(ctx, agent, ownRoute, 1, 1)

    expect((await readImage(ctx, agent)).isError).toBe(false)
    expect(await resolveRequestRoute(ctx, agent, ownRoute, 1, 2)).toEqual(ownRoute)
  })

  it('keeps the original refusal when the Parametria plugin is not composed', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const { ctx } = await setup(undefined, false)
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('model "text-model" does not declare image input'),
      }),
    ])
    expect(warning).not.toHaveBeenCalled()
  })
})

describe('fail-open composition behavior', () => {
  it('declines the fallback when reading agent route state fails', async () => {
    const ctx = new Context()
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    installReadImageFallback(ctx, { provider: 'parametria-vision', model: 'vision-model' })
    const agent = {
      options: {},
      session: {
        requestHeader: () => {
          throw new Error('session header unavailable')
        },
      },
    } as unknown as Agent
    await resolveRequestRoute(ctx, agent, { provider: 'session-text', model: 'text-model' }, 1, 1)
    const fallback = await ctx.waterfall('fs/read-image-route', {
      agent,
    } as never, { provider: 'session-text', model: 'text-model' }, () => Promise.resolve(undefined))

    expect(fallback).toBeUndefined()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('session header unavailable'))
  })
})

describe('Cordis namespace module shape', () => {
  it('exports name, inject, and apply as siblings with no default export', () => {
    expect(ReadImageFallback.name).toBe('parametria-read-image-fallback')
    expect(ReadImageFallback.inject).toEqual(['llm'])
    expect(ReadImageFallback.apply).toBe(apply)
    expect(ReadImageFallback).not.toHaveProperty('default')
  })
})
