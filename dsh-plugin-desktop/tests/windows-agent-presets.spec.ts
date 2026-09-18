import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WindowsAgentPresets,
  WINDOWS_SAFE_PRESET,
  WINDOWS_UNSUPPORTED_PRESET,
} from '../src/windows-agent-presets.ts'

const roots: string[] = []
const contexts: Context[] = []

function writePreset(root: string, id: string): void {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), [
    '- id: fixture',
    "  name: 'fixture-plugin'",
    '',
  ].join('\n'))
}

async function createRoster(defaultId: string): Promise<WindowsAgentPresets> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-windows-presets-'))
  roots.push(root)
  writePreset(root, WINDOWS_SAFE_PRESET)
  writePreset(root, WINDOWS_UNSUPPORTED_PRESET)
  writePreset(root, 'code')
  const ctx = new Context()
  // A Loader sets this in production; the roster refuses to construct without a
  // base to resolve composition plugins against (upstream's own tests do the same).
  ctx.baseUrl = pathToFileURL(root).href + '/'
  contexts.push(ctx)
  // The roster registers its session projection at construction (upstream mounts
  // the same registry first in its own roster tests).
  await ctx.plugin(SessionProjectionRegistry)
  return new WindowsAgentPresets(ctx, {
    default: defaultId,
    roots: [{ path: root, trust: 'system' }],
    // Bare roster over the fixture root only: the shipped set would add
    // upstream's own minimal/standard and mask what this guard hides.
    includeShippedRoot: false,
    includeUserRoot: false,
  })
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Windows agent preset guard', () => {
  it('hides the unsupported minimal preset from discovery', async () => {
    const presets = await createRoster(WINDOWS_SAFE_PRESET)

    expect((await presets.list()).map(preset => preset.id)).toEqual([
      'code',
      WINDOWS_SAFE_PRESET,
    ])
  })

  it('falls back to standard when minimal was saved as the default', async () => {
    const presets = await createRoster(WINDOWS_UNSUPPORTED_PRESET)

    expect(presets.defaultId).toBe(WINDOWS_SAFE_PRESET)
    await expect(presets.resolve()).resolves.toMatchObject({ id: WINDOWS_SAFE_PRESET })
  })

  it('preserves exact resolution for legacy sessions that recorded minimal', async () => {
    const presets = await createRoster(WINDOWS_SAFE_PRESET)

    await expect(presets.resolve(WINDOWS_UNSUPPORTED_PRESET))
      .resolves.toMatchObject({ id: WINDOWS_UNSUPPORTED_PRESET })
  })

  it('rejects switching a blank session to the hidden minimal preset', async () => {
    const presets = await createRoster(WINDOWS_SAFE_PRESET)
    const agentCtx = new Context()
    contexts.push(agentCtx)

    const refusal = presets.recompose(agentCtx, WINDOWS_UNSUPPORTED_PRESET)
    await expect(refusal).rejects.toBeInstanceOf(RemoteError)
    await expect(refusal).rejects.toMatchObject({
      code: 'agent-preset/not-found',
      details: { agentPreset: WINDOWS_UNSUPPORTED_PRESET, available: ['code', WINDOWS_SAFE_PRESET] },
    })
  })

  it('reserves the hidden minimal id from user-authored copies', async () => {
    const presets = await createRoster(WINDOWS_SAFE_PRESET)

    const refusal = presets.copy('code', WINDOWS_UNSUPPORTED_PRESET)
    await expect(refusal).rejects.toBeInstanceOf(RemoteError)
    await expect(refusal).rejects.toMatchObject({
      code: 'agent-preset/invalid',
      details: { agentPreset: WINDOWS_UNSUPPORTED_PRESET },
    })
  })
})
