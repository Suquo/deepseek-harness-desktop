/**
 * Fences for `parametria_capture` (issue #24).
 *
 * The operator's ruling replaced this issue's original acceptance criterion
 * with four clauses, and this file is where three of them are enforced
 * mechanically (the fourth — that a top-level run stops asking for
 * `danger-full-access` — lives in the preset persona and is fenced in
 * `dsh-preset-parametria/tests/preset-drift.test.mjs`):
 *
 *   2. argv is pinned to the CONFIGURED script; the tool refuses any other
 *      invocation shape.
 *   3. output lands only under the session-cwd `.parametria-evidence/` root.
 *   1. a delegated child can call it — enforced here as "the tool needs no
 *      approval seam and no sandbox escalation", i.e. neither the model-facing
 *      description nor the produced command mentions either mechanism.
 *
 * The argv fences are DERIVED, not restated: they read the plan the policy
 * actually produces and assert properties of it (position of the script, the
 * closed flag alphabet, the absence of any caller-controlled element), so a
 * new option added without a rule fails here rather than widening the surface
 * silently.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  CAPTURE_DISPLAY_MODES,
  CAPTURE_SCRIPT_ENV,
  CAPTURE_THEMES,
  CAPTURE_TOOL_NAME,
  CAPTURE_VIEWS,
  CaptureRefusal,
  Config as ConfigSchema,
  EVIDENCE_ROOT_SEGMENT,
  FORWARDED_ENV_KEYS,
  UV_CACHE_SEGMENT,
  apply,
  captureEnvironment,
  planCapture,
  resolveCaptureScript,
  type CaptureRequest,
  type CaptureSite,
  type Config,
} from '../src/parametria-capture.ts'

const SOURCE_PATH = fileURLToPath(new URL('../src/parametria-capture.ts', import.meta.url))
const SCRIPT = resolve('/skills/suquo-systems-parametria/scripts/screenshot-definition.py')
const CWD = resolve('/work/repo')
const SESSION = 'session-abc123'
const SITE: CaptureSite = { cwd: CWD, sessionId: SESSION }
const DEFINITION = 'j57xk2m9q0abc'

/** Every configured value stated, so a schema default change cannot silently move a fence. */
const CONFIG: Config = ConfigSchema({ captureScript: SCRIPT, uv: 'uv' })

/** The configured script always exists for these fences; the missing-script case sets its own probe. */
const present = (): boolean => true

/** Plan one request against the standard site/config, with an EMPTY environment. */
function plan(request: CaptureRequest): ReturnType<typeof planCapture> {
  return planCapture(request, SITE, CONFIG, present, {})
}

/** The minimal valid request. */
function request(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return { definitionId: DEFINITION, outputName: 'capture.png', ...overrides }
}

/** The refusal code of a thrown {@link CaptureRefusal}, or the thrown value itself. */
function refusalCode(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error instanceof CaptureRefusal ? error.code : error
  }
  return 'DID NOT THROW'
}

describe('argv is pinned to the configured script (acceptance 2)', () => {
  it('always spawns uv run <configured script> and never anything else', () => {
    // Every option the surface offers, exercised together and one at a time.
    const requests: CaptureRequest[] = [
      request(),
      request({ wait: 1 }),
      request({ wait: 60, viewportOnly: true }),
      ...CAPTURE_VIEWS.map(view => request({ view })),
      ...CAPTURE_DISPLAY_MODES.map(display => request({ display })),
      ...CAPTURE_THEMES.map(theme => request({ theme })),
      request({ wait: 12, viewportOnly: true, view: 'front', display: 'shaded', theme: 'light' }),
    ]
    for (const candidate of requests) {
      const { argv } = plan(candidate)
      expect(argv[0]).toBe('uv')
      expect(argv[1]).toBe('run')
      expect(argv[2]).toBe(SCRIPT)
    }
  })

  it('admits no argv element outside the closed alphabet the policy owns', () => {
    // Derived: the tail after the two positional arguments must consist only of
    // flags this module builds. A future option appended without a rule here
    // fails, which is the point — an unrecognised element is an argv channel.
    const closedFlag = /^(--wait=(?:[1-9]|[1-5][0-9]|60)|--viewport-only|--view=[a-z]+|--display=[a-z]+|--theme=(?:light|dark))$/
    const { argv, outputPath } = plan(
      request({ wait: 12, viewportOnly: true, view: 'front', display: 'ghosted', theme: 'dark' }),
    )
    expect(argv[3]).toBe(DEFINITION)
    expect(argv[4]).toBe(outputPath)
    for (const element of argv.slice(5)) expect(element).toMatch(closedFlag)
  })

  it('refuses a definition id that could be read as a flag or split an argument', () => {
    for (const definitionId of [
      '--wait=1', '-x', 'a b', 'a;b', 'a/b', 'a\\b', 'a"b', '', '..',
      `${'a'.repeat(129)}`,
    ]) {
      expect(refusalCode(() => plan(request({ definitionId })))).toBe('CAPTURE_ID_REJECTED')
    }
  })

  it('refuses an unconfigured, relative, or absent capture script by distinct code', () => {
    expect(refusalCode(() => planCapture(request(), SITE, ConfigSchema({}), present, {})))
      .toBe('CAPTURE_SCRIPT_UNCONFIGURED')
    expect(refusalCode(() => planCapture(request(), SITE, ConfigSchema({ captureScript: '   ' }), present, {})))
      .toBe('CAPTURE_SCRIPT_UNCONFIGURED')
    expect(refusalCode(() => planCapture(request(), SITE, ConfigSchema({ captureScript: 'scripts/shot.py' }), present, {})))
      .toBe('CAPTURE_SCRIPT_UNCONFIGURED')
    expect(refusalCode(() => planCapture(request(), SITE, CONFIG, () => false, {})))
      .toBe('CAPTURE_SCRIPT_MISSING')
  })

  it('takes the script from the operator env when the row configures none, and never from a relative one', () => {
    // The preset row is version-controlled and installed machine-wide, so the
    // path cannot live in it; this is the operator's set-once surface, and #7
    // will change only what it defaults to.
    const fromEnv = planCapture(request(), SITE, ConfigSchema({}), present, { [CAPTURE_SCRIPT_ENV]: SCRIPT })
    expect(fromEnv.argv[2]).toBe(SCRIPT)
    expect(resolveCaptureScript(ConfigSchema({}), { [CAPTURE_SCRIPT_ENV]: SCRIPT })).toBe(SCRIPT)
    // Explicit configuration outranks the environment.
    const other = resolve('/other/shot.py')
    expect(resolveCaptureScript(ConfigSchema({ captureScript: other }), { [CAPTURE_SCRIPT_ENV]: SCRIPT })).toBe(other)
    // A relative environment value is refused rather than resolved against the
    // Host's process cwd, which is a directory nobody chose.
    expect(refusalCode(() => resolveCaptureScript(ConfigSchema({}), { [CAPTURE_SCRIPT_ENV]: 'shot.py' })))
      .toBe('CAPTURE_SCRIPT_UNCONFIGURED')
  })

  it('refuses an option outside its closed vocabulary', () => {
    expect(refusalCode(() => plan(request({ view: 'isometric' })))).toBe('CAPTURE_OPTION_REJECTED')
    expect(refusalCode(() => plan(request({ display: 'xray' })))).toBe('CAPTURE_OPTION_REJECTED')
    expect(refusalCode(() => plan(request({ theme: 'sepia' })))).toBe('CAPTURE_OPTION_REJECTED')
    expect(refusalCode(() => plan(request({ wait: 0 })))).toBe('CAPTURE_OPTION_REJECTED')
    expect(refusalCode(() => plan(request({ wait: 61 })))).toBe('CAPTURE_OPTION_REJECTED')
    expect(refusalCode(() => plan(request({ wait: 1.5 })))).toBe('CAPTURE_OPTION_REJECTED')
  })
})

describe('output lands only under the run evidence directory (acceptance 3)', () => {
  it('resolves exactly <cwd>/.parametria-evidence/<session id>/<name>', () => {
    const { outputPath, evidenceDir } = plan(request({ outputName: 'front.png' }))
    expect(evidenceDir).toBe(join(CWD, EVIDENCE_ROOT_SEGMENT, SESSION))
    expect(outputPath).toBe(join(CWD, EVIDENCE_ROOT_SEGMENT, SESSION, 'front.png'))
  })

  it('refuses every output name that is not a bare .png leaf', () => {
    for (const outputName of [
      'a/b.png', 'a\\b.png', '../escape.png', '..\\escape.png', '/etc/shot.png',
      'C:\\Windows\\shot.png', '.png', 'shot.txt', 'shot', 'shot.png.exe',
      '-shot.png', 'shot .png', '', '..png..', `${'a'.repeat(130)}.png`,
    ]) {
      expect(refusalCode(() => plan(request({ outputName })))).toBe('CAPTURE_NAME_REJECTED')
    }
  })

  it('refuses a session id that could redirect the run directory', () => {
    for (const sessionId of ['', '  ', '../other', 'a/b', 'a\\b', '..']) {
      expect(refusalCode(() => planCapture(request(), { cwd: CWD, sessionId }, CONFIG, present)))
        .toBe('CAPTURE_SITE_UNRESOLVED')
    }
  })

  it('refuses a site without an absolute workspace', () => {
    for (const cwd of ['', '   ', 'relative/dir']) {
      expect(refusalCode(() => planCapture(request(), { cwd, sessionId: SESSION }, CONFIG, present)))
        .toBe('CAPTURE_SITE_UNRESOLVED')
    }
  })

  it('keeps the resolved-path guard load-bearing beneath the name pattern', () => {
    // Defence in depth, asserted as a property rather than by reaching the
    // branch: whatever the name rule admits, the resolved path is a direct
    // child of the run directory. The mutation proof in the PR body loosens
    // OUTPUT_NAME_PATTERN and shows CAPTURE_PATH_ESCAPED catching what the
    // pattern then lets through.
    const { outputPath, evidenceDir } = plan(request({ outputName: 'a.b-c_1.png' }))
    expect(isAbsolute(outputPath)).toBe(true)
    expect(outputPath.startsWith(evidenceDir + sep)).toBe(true)
    expect(outputPath.slice(evidenceDir.length + 1)).not.toContain(sep)
  })
})

describe('the child environment is a closed list (no ambient passthrough)', () => {
  it('points uv at the workspace-local cache the persona teaches', () => {
    expect(plan(request()).env).toEqual({ UV_CACHE_DIR: join(CWD, UV_CACHE_SEGMENT) })
  })

  it('forwards exactly the three documented Host variables and nothing else', () => {
    const env = captureEnvironment(plan(request()), {
      CONVEX_URL: 'https://example.convex.cloud',
      PARAMETRIA_OWNER_ID: 'owner-1',
      PARAMETRIA_APP_URL: 'http://localhost:3000',
      OPENROUTER_API_KEY: 'sk-should-not-travel',
      PATH: '/usr/bin',
      UV_CACHE_DIR: 'C:\\somewhere\\else',
    })
    expect(Object.keys(env).sort()).toEqual([...FORWARDED_ENV_KEYS, 'UV_CACHE_DIR'].sort())
    // The plan's own entry wins: an ambient UV_CACHE_DIR cannot relocate the
    // cache back outside the workspace, which is the denial the assignment exists to prevent.
    expect(env.UV_CACHE_DIR).toBe(join(CWD, UV_CACHE_SEGMENT))
  })

  it('omits a documented variable the Host does not set rather than sending an empty one', () => {
    const env = captureEnvironment(plan(request()), { CONVEX_URL: '' })
    expect(Object.keys(env)).toEqual(['UV_CACHE_DIR'])
  })
})

describe('the capability never touches the escalation surface (acceptance 1 and the #21 precedent)', () => {
  it('registers exactly one tool, named parametria_capture', () => {
    const registered: { name: string; description: string }[] = []
    const ctx = { tools: { register: (tool: { name: string; description: string }) => registered.push(tool) } }
    apply(ctx as unknown as Context, CONFIG)
    expect(registered.map(tool => tool.name)).toEqual([CAPTURE_TOOL_NAME])
  })

  it('never names the escalation mechanism in anything the model reads or the OS runs', () => {
    const registered: { description: string }[] = []
    const ctx = { tools: { register: (tool: { description: string }) => registered.push(tool) } }
    apply(ctx as unknown as Context, CONFIG)
    const description = registered[0]?.description ?? ''
    const { argv, env } = plan(request({ wait: 8, view: 'front', theme: 'light' }))
    const surface = [description, ...argv, ...Object.entries(env).flat()].join('\n')
    // A capability that widened the sandbox by naming its key literal would be
    // the bypass the #21 ruling forbade; a capability that told the model to
    // escalate would reinstate the interrupt this issue removes.
    expect(surface).not.toContain('danger-full-access')
    expect(surface).not.toContain('sandbox_permissions')
  })

  it('states in its description that it replaces the shell path and needs no approval', () => {
    const registered: { description: string }[] = []
    const ctx = { tools: { register: (tool: { description: string }) => registered.push(tool) } }
    apply(ctx as unknown as Context, CONFIG)
    const description = registered[0]?.description ?? ''
    // The delegated case is the one that cannot be rescued at runtime
    // (`user-approval` decides `never` before any answerer, and the subagent
    // driver pins children to it), so the model has to learn it from here.
    expect(description).toMatch(/delegated session/)
    expect(description).toMatch(/no approval/)
  })
})

describe('the module declares the boundary it crosses', () => {
  it('records in source why the Host plane is the only place this can run', () => {
    // Standard 12: a comment claiming a mechanism is a checkable claim. The
    // whole justification for an unconfined spawn is one upstream sentence, so
    // the citation that carries it must survive refactors.
    const source = readFileSync(SOURCE_PATH, 'utf8')
    expect(source).toContain('sandbox-windows-acl/README.md:99')
    expect(source).toContain('packages/subagent/subagent/src/child-agent.ts:202')
    expect(source).toContain('packages/interaction/user-approval/src/index.ts:312')
  })
})
