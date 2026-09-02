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

class ModalAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: model === 'vision-model' ? ['text', 'image'] : ['text'],
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
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
}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: workdir })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(LocalAttachmentStore, { dshHome: attachmentHome })
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['session-text', 'parametria-vision'], new ModalAdapter())
  installReadImageFallback(ctx, config)
  await ctx.plugin(ToolFs)
  return ctx
}

async function readImage(ctx: Context, agent: Agent) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`fallback-image-${++nextCall}`),
    name: 'read_image',
    arguments: { file_path: 'red.png' },
    agent,
  })
}

function proposed(ctx: Context, agent: Agent, config: LlmCallConfig) {
  return ctx.waterfall('agent/request', {
    agent,
    turn: 1,
    step: 2,
    signal,
  }, () => Promise.resolve(config))
}

describe('patched read_image modality gate', () => {
  it('commits the image for a text session and routes the rest of that turn through vision', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const original = {
      provider: 'session-text',
      model: 'text-model',
      reasoningEffort: 'high',
      temperature: 0.2,
    } as LlmCallConfig
    const agent = fakeAgent(original)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(false)
    expect(result.content.map(block => block.type)).toEqual(['text', 'image'])
    expect(await proposed(ctx, agent, original)).toEqual({
      provider: 'parametria-vision',
      model: 'vision-model',
      temperature: 0.2,
    })
  })

  it('restores the complete prior config after the fallback turn', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const original = {
      provider: 'session-text',
      model: 'text-model',
      reasoningEffort: 'high',
      temperature: 0.2,
      maxTokens: 1234,
      stop: ['DONE'],
    } as LlmCallConfig
    const agent = fakeAgent(original)
    await readImage(ctx, agent)
    await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal })

    const restored = await proposed(ctx, agent, {
      provider: 'parametria-vision',
      model: 'vision-model',
      maxTokens: 65_536,
    })

    expect(restored).toEqual(original)
    expect(await proposed(ctx, agent, restored)).toEqual(restored)
  })

  it('preserves a model selection changed before restoration', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const agent = fakeAgent({ provider: 'session-text', model: 'text-model' })
    await readImage(ctx, agent)
    await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal })
    const changed = { provider: 'another-route', model: 'another-model' }

    expect(await proposed(ctx, agent, changed)).toEqual(changed)
  })

  it('does not activate an image-ineligible fallback', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const ctx = await setup({ provider: 'session-text', model: 'text-model' })
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('does not declare image input'),
      }),
    ])
    expect(await proposed(ctx, agent, original)).toEqual(original)
  })

  it('does not activate the route when image admission fails after modality validation', async () => {
    const ctx = await setup()
    const original = { provider: 'session-text', model: 'text-model' }
    const agent = fakeAgent(original)

    const result = await readImage(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('not found'),
      }),
    ])
    expect(await proposed(ctx, agent, original)).toEqual(original)
  })

  it('leaves an already image-capable session on its own route', async () => {
    await writeFile(join(workdir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const ownRoute = { provider: 'parametria-vision', model: 'vision-model' }
    const agent = fakeAgent(ownRoute)

    expect((await readImage(ctx, agent)).isError).toBe(false)
    expect(await proposed(ctx, agent, ownRoute)).toEqual(ownRoute)
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
