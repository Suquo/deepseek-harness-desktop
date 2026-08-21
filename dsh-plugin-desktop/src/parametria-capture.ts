/**
 * `parametria_capture` — the Host-plane screenshot capability for the
 * Parametria harness (issue #24, operator ruling of 2026-08-21).
 *
 * ## Why this tool exists rather than a sandbox grant
 *
 * The Suquo Systems Parametria skill captures a definition by running its
 * `screenshot-definition.py` under `uv run`. Playwright's sync driver spawn
 * uses PIPED stdio, and a confined process on Windows cannot open that pipe:
 * libuv's pipe stdio uses NAMED pipes, and `CreateNamedPipeW` without security
 * attributes installs the Win32 user-mode default SD template (Everyone
 * read-only) rather than the restricted token's default DACL, so the
 * client-end open asks for write access no restricting SID holds. Upstream
 * documents the boundary verbatim at
 * `deepseek-harness/packages/sandbox/sandbox-windows-acl/README.md:99` —
 * *"tools that must capture output cannot run confined"*. The failing
 * `CreateNamedPipeW` is called by Python's asyncio INSIDE the confined child,
 * so no yarn patch to any DSH package can reach it, and no relocation of the
 * output, the uv cache, or the temp directory changes it.
 *
 * The mechanism this issue was originally specced against cannot help either.
 * `PreToolDecision` is `allow | deny | ask` and nothing else
 * (`deepseek-harness/packages/core/tools/src/index.ts:588`, with input rewrite
 * explicitly excluded at `:585`), so a `tools/pre-execute` grant cannot widen a
 * call; and the escalation ask is raised inside the bash tool BODY, after that
 * waterfall has already settled
 * (`packages/shell/tool-bash/src/index.ts:330`-`:335`). Auto-answering the ask
 * instead is structurally unavailable to the case that needs it most: a
 * delegated child is pinned to `approvalPolicy: 'never'`
 * (`packages/subagent/subagent/src/child-agent.ts:202`) and that policy is
 * decided BEFORE the `approval/request` waterfall dispatches
 * (`packages/interaction/user-approval/src/index.ts:312`), so a validator child
 * that needs a capture cannot obtain one at any price.
 *
 * ## What this tool is, and how narrow it is
 *
 * A tool body runs in the Host process, which is not confined — that is the
 * whole point, and it is DECLARED here rather than smuggled. What keeps it
 * narrow is that the model has no argv channel at all:
 *
 * - the program is always the configured `uv`, and the script is always the
 *   configured {@link Config.captureScript}. Nothing a caller sends can name a
 *   different program, script, or flag;
 * - the definition id and every option are validated against closed patterns
 *   and enums, so no argument can be read as a flag or split into two;
 * - the output is a bare FILE NAME, and the tool — not the caller — resolves
 *   it under `<session cwd>/.parametria-evidence/<session id>/`, then verifies
 *   containment after resolution.
 *
 * That is strictly narrower than the status quo it replaces. Today's answer is
 * `bash` escalated to `danger-full-access`, which can run anything, anywhere;
 * this can run one script into one directory. The `danger-full-access`
 * acknowledgement surface is untouched, and this tool never names, requests, or
 * imitates that mode.
 *
 * ## Shape
 *
 * {@link planCapture} is the whole policy: a total, synchronous function from
 * (request, site, config) to the exact argv, cwd, and environment to spawn, or
 * a {@link CaptureRefusal} carrying a distinct code. The plugin body below is a
 * thin spawn around it, so every refusal is testable without a browser, a
 * network, or a Python.
 *
 * @module dsh-plugin-desktop/parametria-capture
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import { PARAMETRIA_PRODUCT_NAME } from './client/brand.ts'

/** Stable Cordis plugin name. */
export const name = 'parametria-capture'

/** The subprocess seam is the composed spawn path; the tool registry is where the capability lands. */
export const inject = ['tools', 'subprocess']

/** The model-facing tool name. One name, so a persona and a fence can both pin it. */
export const CAPTURE_TOOL_NAME = 'parametria_capture'

/**
 * The run-artifact root, relative to the session workspace. Owned by the
 * evidence convention this tool WRITES UNDER — governance of that root is
 * issue #23's slice and deliberately not absorbed here.
 */
export const EVIDENCE_ROOT_SEGMENT = '.parametria-evidence'

/**
 * The workspace-local uv cache directory. `workspace-write` grants the session
 * workspace and nothing else useful, so uv's default cache under
 * `%LOCALAPPDATA%` is denied; the same assignment the persona teaches for hand
 * -typed `uv run` calls is applied here so the two paths cannot diverge.
 */
export const UV_CACHE_SEGMENT = '.uv-cache'

/** Camera views the capture script accepts (`screenshot-definition.py`, `VALID_VIEWS`). */
export const CAPTURE_VIEWS: readonly string[] = [
  'perspective', 'orthographic', 'front', 'back', 'left', 'right', 'top', 'bottom',
]

/** Display modes the capture script accepts (`screenshot-definition.py`, `VALID_DISPLAY_MODES`). */
export const CAPTURE_DISPLAY_MODES: readonly string[] = ['shaded', 'wireframe', 'ghosted', 'rendered']

/** Colour themes the capture script accepts. */
export const CAPTURE_THEMES: readonly string[] = ['light', 'dark']

/**
 * Environment entries this tool states EXPLICITLY for the capture child: the
 * three the script documents reading (`screenshot-definition.py` reads
 * `CONVEX_URL`, `PARAMETRIA_OWNER_ID`, and `PARAMETRIA_APP_URL`).
 *
 * NOT a whitelist of the child's environment, and this module does not claim to
 * be one. `SubprocessSpawnSpec.env` is documented as entries "merged onto the
 * implementation's scrubbed parent base"
 * (`packages/subprocess/subprocess/src/types.ts:96-103`), and
 * `subprocess-local` builds that base with `scrubbedParentEnv()` — the whole
 * ambient environment minus credential-shaped names and `DSH_*`. The child
 * therefore inherits what every other subprocess in this deployment inherits;
 * naming these three buys determinism (they are stated rather than assumed to
 * survive the scrub), not confinement. Closing the environment properly would
 * mean tombstoning every ambient name, which this seam supports but which is a
 * deployment-wide policy rather than one tool's business.
 */
export const FORWARDED_ENV_KEYS: readonly string[] = ['CONVEX_URL', 'PARAMETRIA_OWNER_ID', 'PARAMETRIA_APP_URL']

/** Inclusive bounds for the script's `--wait` seconds. */
const WAIT_MIN = 1
const WAIT_MAX = 60

/**
 * Convex definition ids as an argv-safe closed shape: alphanumerics with
 * interior `_`/`-`, never leading `-` (which argparse would read as a flag).
 */
const DEFINITION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * Output FILE NAMES, not paths: no separators, no drive letter, no leading
 * dash, no `..`, and a `.png` extension. The tool owns the directory; the
 * caller owns only the leaf.
 */
const OUTPUT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.png$/

/**
 * The operator's set-once surface for the capture script, read when the plugin
 * row carries no explicit `captureScript`.
 *
 * The row itself cannot carry the value: the preset that mounts it is
 * version-controlled in this repository and installed machine-wide, so a
 * literal there would be one machine's path shipped to every machine. The
 * skill's canonical location is still owner-gated (#7); when that ruling lands
 * it changes what this resolves to by DEFAULT, not how it is spelled.
 */
export const CAPTURE_SCRIPT_ENV = 'DSH_PARAMETRIA_CAPTURE_SCRIPT'

/** Plugin config. */
export interface Config {
  /**
   * Absolute path to the skill's `screenshot-definition.py`. Explicit
   * configuration wins; otherwise {@link CAPTURE_SCRIPT_ENV} supplies it.
   * Neither present means the tool refuses every call BY NAME rather than
   * silently registering a capability it cannot perform.
   */
  captureScript?: string
  /** The `uv` program. A bare name resolves on the Host PATH. */
  uv?: string
  /** Wall-clock budget for one capture, in milliseconds. */
  timeoutMs?: number
  /** In-memory cap per collected output stream, in bytes. */
  maxOutputBytes?: number
}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({
  captureScript: z.string(),
  uv: z.string().default('uv'),
  timeoutMs: z.number().step(1).min(1_000).max(600_000).default(180_000),
  maxOutputBytes: z.number().step(1).min(1_024).max(4_194_304).default(65_536),
})

/** One capture request, after the registry has checked the declared schema. */
export interface CaptureRequest {
  /** Convex definition id to open. */
  definitionId: string
  /** Bare `.png` file name for the capture. */
  outputName: string
  /** Seconds to wait for OCCT plus rendering. */
  wait?: number
  /** Camera view. */
  view?: string
  /** Display mode. */
  display?: string
  /** Colour theme. */
  theme?: string
  /** Capture only the 3D viewport rather than the whole page. */
  viewportOnly?: boolean
}

/** Where a capture is anchored: the calling session's workspace and identity. */
export interface CaptureSite {
  /** The session's immutable working directory — the evidence root's parent. */
  cwd: string
  /** The session id — the run-scoping segment under the evidence root. */
  sessionId: string
}

/** A fully-resolved capture, ready to spawn. */
export interface CapturePlan {
  /** Program and arguments; `argv[0]` is the program. Never shell-interpreted. */
  argv: readonly string[]
  /** Working directory for the child. */
  cwd: string
  /** Explicit environment entries for the child. */
  env: Readonly<Record<string, string>>
  /** Absolute path the capture is written to. */
  outputPath: string
  /** Absolute run-scoped evidence directory the tool creates before spawning. */
  evidenceDir: string
}

/** The closed refusal vocabulary. Each code names one reason and only that reason. */
export type CaptureRefusalCode =
  | 'CAPTURE_SCRIPT_UNCONFIGURED'
  | 'CAPTURE_SCRIPT_MISSING'
  | 'CAPTURE_SITE_UNRESOLVED'
  | 'CAPTURE_ID_REJECTED'
  | 'CAPTURE_NAME_REJECTED'
  | 'CAPTURE_OPTION_REJECTED'
  | 'CAPTURE_PATH_ESCAPED'

/** A refusal to plan a capture, carrying the code a fence can assert on. */
export class CaptureRefusal extends Error {
  /** The closed reason code. */
  readonly code: CaptureRefusalCode
  constructor(code: CaptureRefusalCode, message: string) {
    super(`${CAPTURE_TOOL_NAME}: ${message}`)
    this.name = 'CaptureRefusal'
    this.code = code
  }
}

/** Probe used to check the configured script exists; injectable so the policy stays testable. */
export type PathProbe = (path: string) => boolean

/**
 * Resolve the one script this tool is ever allowed to run: the explicit
 * `captureScript` config, else {@link CAPTURE_SCRIPT_ENV}. Absolute-only —
 * a relative spelling would resolve against whatever the Host's process cwd
 * happens to be, which is not a location anybody chose.
 * @param config - the resolved plugin config.
 * @param env - the Host environment to read the fallback from (default: `process.env`).
 * @returns the absolute script path.
 * @throws CaptureRefusal `CAPTURE_SCRIPT_UNCONFIGURED` when neither source supplies an absolute path.
 */
export function resolveCaptureScript(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  const configured = config.captureScript
  const fallback = env[CAPTURE_SCRIPT_ENV]
  const script = (configured !== undefined && configured.trim().length > 0)
    ? configured.trim()
    : (fallback ?? '').trim()
  if (script.length === 0) {
    throw new CaptureRefusal(
      'CAPTURE_SCRIPT_UNCONFIGURED',
      'no capture script is configured. Set the `captureScript` config key of the '
      + `\`${name}\` row, or the ${CAPTURE_SCRIPT_ENV} environment variable, to the absolute path `
      + 'of the skill\'s screenshot-definition.py.',
    )
  }
  if (!isAbsolute(script)) {
    throw new CaptureRefusal(
      'CAPTURE_SCRIPT_UNCONFIGURED',
      `the capture script must be an absolute path, got ${JSON.stringify(script)}.`,
    )
  }
  return script
}

/**
 * Resolve one capture request into the exact command to run, or refuse.
 *
 * Total and synchronous: it reads no file except through `probe`, and it is the
 * single home of every rule that keeps the capability narrow. A caller that
 * receives a {@link CapturePlan} may spawn it verbatim; a caller that receives
 * a throw has a {@link CaptureRefusal} with a distinct code.
 *
 * @param request - the caller's request, already schema-checked by the registry.
 * @param site - the calling session's workspace and identity.
 * @param config - the resolved plugin config.
 * @param probe - existence check for the configured script (default: `existsSync`).
 * @returns the argv, cwd, environment, and resolved output path.
 * @throws CaptureRefusal for every rejected input, configuration, or containment failure.
 */
export function planCapture(
  request: CaptureRequest,
  site: CaptureSite,
  config: Config,
  probe: PathProbe = existsSync,
  env: NodeJS.ProcessEnv = process.env,
): CapturePlan {
  const script = resolveCaptureScript(config, env)
  if (!probe(script)) {
    throw new CaptureRefusal(
      'CAPTURE_SCRIPT_MISSING',
      `the configured capture script does not exist: ${script}`,
    )
  }
  if (site.cwd.trim().length === 0 || !isAbsolute(site.cwd)) {
    throw new CaptureRefusal(
      'CAPTURE_SITE_UNRESOLVED',
      'the calling session has no absolute working directory, so the run evidence directory '
      + 'cannot be resolved. This tool requires an agent session.',
    )
  }
  if (site.sessionId.trim().length === 0 || /[\\/]/.test(site.sessionId) || site.sessionId.includes('..')) {
    throw new CaptureRefusal(
      'CAPTURE_SITE_UNRESOLVED',
      'the calling session has no usable id for the run-scoped evidence directory.',
    )
  }
  if (!DEFINITION_ID_PATTERN.test(request.definitionId)) {
    throw new CaptureRefusal(
      'CAPTURE_ID_REJECTED',
      `definitionId must match ${String(DEFINITION_ID_PATTERN)}, got ${JSON.stringify(request.definitionId)}.`,
    )
  }
  if (!OUTPUT_NAME_PATTERN.test(request.outputName) || request.outputName.includes('..')) {
    throw new CaptureRefusal(
      'CAPTURE_NAME_REJECTED',
      `outputName must be a bare .png file name matching ${String(OUTPUT_NAME_PATTERN)} — `
      + 'no directories, no drive letters, no ".." — got '
      + `${JSON.stringify(request.outputName)}. The run directory is chosen by this tool.`,
    )
  }
  const wait = request.wait
  if (wait !== undefined && (!Number.isInteger(wait) || wait < WAIT_MIN || wait > WAIT_MAX)) {
    throw new CaptureRefusal(
      'CAPTURE_OPTION_REJECTED',
      `wait must be an integer from ${WAIT_MIN} through ${WAIT_MAX}, got ${JSON.stringify(wait)}.`,
    )
  }
  assertChoice('view', request.view, CAPTURE_VIEWS)
  assertChoice('display', request.display, CAPTURE_DISPLAY_MODES)
  assertChoice('theme', request.theme, CAPTURE_THEMES)

  const cwd = resolve(site.cwd)
  const evidenceDir = join(cwd, EVIDENCE_ROOT_SEGMENT, site.sessionId)
  const outputPath = resolve(evidenceDir, request.outputName)
  // Belt and braces over the name pattern: containment is asserted on the
  // RESOLVED path, so a future loosening of the pattern cannot silently move
  // the write. `relative` is empty for an identical path and starts with `..`
  // for anything outside.
  const inside = relative(evidenceDir, outputPath)
  if (inside.length === 0 || inside.startsWith('..') || inside.includes(sep) || isAbsolute(inside)) {
    throw new CaptureRefusal(
      'CAPTURE_PATH_ESCAPED',
      `the resolved output path escapes the run evidence directory: ${outputPath} is not directly inside ${evidenceDir}.`,
    )
  }

  // `--no-project` is load-bearing, not tidiness. `uv run` performs PROJECT
  // DISCOVERY from its working directory, and this one is the user's own
  // repository: a `pyproject.toml` sitting there would make uv resolve and sync
  // THAT project's environment, unconfined, before the script ran. Pinning the
  // argv is worth nothing if the effective behaviour still depends on what the
  // cwd happens to contain. The script's PEP 723 header supplies its own
  // dependencies, so it needs no project at all.
  const argv: string[] = [config.uv ?? 'uv', 'run', '--no-project', script, request.definitionId, outputPath]
  if (wait !== undefined) argv.push(`--wait=${String(wait)}`)
  if (request.viewportOnly === true) argv.push('--viewport-only')
  if (request.view !== undefined) argv.push(`--view=${request.view}`)
  if (request.display !== undefined) argv.push(`--display=${request.display}`)
  if (request.theme !== undefined) argv.push(`--theme=${request.theme}`)

  return {
    argv,
    cwd,
    env: { UV_CACHE_DIR: join(cwd, UV_CACHE_SEGMENT) },
    outputPath,
    evidenceDir,
  }
}

/**
 * Reject an option value outside its closed vocabulary.
 * @param field - the request field name, for the message.
 * @param value - the supplied value, or undefined when omitted.
 * @param allowed - the closed vocabulary.
 * @throws CaptureRefusal when the value is present and unlisted.
 */
function assertChoice(field: string, value: string | undefined, allowed: readonly string[]): void {
  if (value === undefined) return
  if (!allowed.includes(value)) {
    throw new CaptureRefusal(
      'CAPTURE_OPTION_REJECTED',
      `${field} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}.`,
    )
  }
}

/**
 * Forward the closed environment allow-list from a Host environment.
 * @param plan - the planned capture whose own entries take precedence.
 * @param source - the Host environment to read from (default: `process.env`).
 * @returns the child environment: the forwarded entries plus the plan's own.
 */
export function captureEnvironment(
  plan: CapturePlan,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of FORWARDED_ENV_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) env[key] = value
  }
  return { ...env, ...plan.env }
}

// The product name is READ from its one declaration rather than restated. A
// tool description is a user-visible surface — the model quotes it back — and
// `tests/shell-branding.spec.ts` is the fence that keeps every such surface on
// the constant; it caught this literal on its first gate run.
const DESCRIPTION =
  `Capture a screenshot of a Suquo Systems ${PARAMETRIA_PRODUCT_NAME} definition and write it into this run's `
  + 'evidence directory. Use this INSTEAD of running the skill\'s screenshot script through a shell: '
  + 'the shell path needs a sandbox escalation for every capture and cannot work at all in a delegated '
  + 'session, while this tool runs the same script from the Host and needs no approval. '
  + 'You choose the definition and a file NAME; the run directory is chosen for you, and the absolute '
  + 'path of the finished capture is returned for you (or a delegate) to read as an image.'

/**
 * Describe why a capture ended, distinguishing the three causes the caller
 * cannot tell apart from an exit code. A caller-initiated abort reported as
 * "exited with signal SIGTERM" tells the model the script crashed when in fact
 * the user cancelled.
 * @param outcome - the process exit facts.
 * @param cause - which of the two signals fired, and the deadline in force.
 * @returns the clause naming the cause.
 */
function describeExit(
  outcome: { exitCode: number | null; signal: NodeJS.Signals | null },
  cause: { aborted: boolean; timedOut: boolean; timeoutMs: number },
): string {
  // Caller cancellation is checked FIRST: both signals feed one composite, so
  // a timeout that fires while an abort is already pending would otherwise
  // rename the user's cancellation.
  if (cause.aborted) return 'was cancelled'
  if (cause.timedOut) return `timed out after ${String(cause.timeoutMs)}ms`
  return outcome.exitCode === null
    ? `exited on signal ${String(outcome.signal)}`
    : `exited with code ${String(outcome.exitCode)}`
}

/**
 * The most useful captured output for a failure message: stderr when it has
 * anything, else stdout. Truncation is DISCLOSED rather than hidden — a
 * head-lost tail presented as a whole traceback is how a diagnosis goes wrong.
 * @param handle - the settled subprocess handle.
 * @returns the detail block, with a truncation notice when the tail slid.
 */
function collectedDetail(handle: {
  collected: { stdout?: { readFrom: (from: number) => { text: string; lossy: boolean } }
    stderr?: { readFrom: (from: number) => { text: string; lossy: boolean } } }
}): string {
  const err = handle.collected.stderr?.readFrom(0)
  const out = handle.collected.stdout?.readFrom(0)
  const chosen = (err !== undefined && err.text.trim().length > 0) ? err : out
  if (chosen === undefined) return ''
  return chosen.lossy ? `[output truncated; showing the tail]\n${chosen.text.trim()}` : chosen.text.trim()
}

/**
 * Register the capture tool.
 * @param ctx - the mounting context.
 * @param config - the resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  /**
   * Captures in flight, owned by THIS generation.
   *
   * `ctx.tools.register` self-scopes, so disposing this plugin withdraws the
   * tool — but it cannot abort an `execute` already running (the registry says
   * so itself: it "does not abandon this promise, but it cannot hard-kill
   * same-process code"). Without the effect below, a generation disposed
   * mid-capture would leave `uv run` and a headless browser running unowned
   * for up to `timeoutMs`, still writing PNGs into the user's repository.
   * `terminate()` is documented idempotent and tree-scoped, which is what
   * makes this a release rather than a best-effort kill.
   */
  const live = new Set<{ terminate: () => void; waitForExit: () => Promise<boolean> }>()
  ctx.effect(() => async () => {
    const draining = [...live]
    live.clear()
    for (const handle of draining) handle.terminate()
    await Promise.all(draining.map(handle => handle.waitForExit()))
  }, `${name}: in-flight capture teardown`)

  ctx.tools.register(defineTool({
    name: CAPTURE_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      definitionId: {
        type: 'string',
        required: true,
        description: 'Convex definition id to open (as returned by the build step).',
      },
      outputName: {
        type: 'string',
        required: true,
        description: 'Bare file name for the capture, ending in .png. No directories and no "..": '
          + 'the run-scoped evidence directory is chosen by this tool.',
      },
      wait: {
        type: 'integer',
        description: `Seconds to wait for geometry and rendering (${WAIT_MIN}-${WAIT_MAX}). Omit for the script default.`,
      },
      viewportOnly: {
        type: 'boolean',
        description: 'Capture only the 3D viewport rather than the whole page.',
      },
      view: {
        type: 'string',
        enum: [...CAPTURE_VIEWS],
        description: 'Camera view. Omit to keep the current one.',
      },
      display: {
        type: 'string',
        enum: [...CAPTURE_DISPLAY_MODES],
        description: 'Display mode. Omit to keep the current one.',
      },
      theme: {
        type: 'string',
        enum: [...CAPTURE_THEMES],
        description: 'Colour theme. "light" reads best for visual validation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outputPath: { type: 'string', required: true },
          exitCode: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Captured to ${value.outputPath}`,
      }],
    },
    async execute(args: CaptureRequest, exec) {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new CaptureRefusal(
          'CAPTURE_SITE_UNRESOLVED',
          'this tool requires an agent session: the run evidence directory is derived from the '
          + 'session workspace and id.',
        )
      }
      const plan = planCapture(args, { cwd: session.header.cwd ?? '', sessionId: String(session.id) }, config)
      await mkdir(plan.evidenceDir, { recursive: true })
      const timeoutMs = config.timeoutMs ?? 180_000
      const maxBytes = config.maxOutputBytes ?? 65_536
      const deadline = AbortSignal.timeout(timeoutMs)
      const handle = ctx.subprocess.spawn({
        argv: plan.argv,
        cwd: plan.cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
        graceMs: 5_000,
        signal: AbortSignal.any([exec.signal, deadline]),
        env: captureEnvironment(plan),
      })
      live.add(handle)
      try {
        const outcome = await handle.done
        if (outcome.exitCode !== 0) {
          throw new Error(`${CAPTURE_TOOL_NAME}: the capture script ${describeExit(outcome, {
            aborted: exec.signal.aborted, timedOut: deadline.aborted, timeoutMs,
          })}.\n${collectedDetail(handle)}`)
        }
        if (!existsSync(plan.outputPath)) {
          throw new Error(
            `${CAPTURE_TOOL_NAME}: the capture script succeeded but wrote no file at ${plan.outputPath}.`,
          )
        }
        return { outputPath: plan.outputPath, exitCode: outcome.exitCode }
      } finally {
        // `done` settles when the DIRECT child closes; this capture's child is
        // `uv run`, whose grandchildren are the Playwright driver and a
        // browser. Upstream draws the distinction deliberately —
        // `waitForExit` observes "the tree, not just the direct child"
        // (`packages/subprocess/subprocess/src/types.ts:187-193`) — so
        // returning on `done` alone would report a finished capture while the
        // browser tree was still alive in the user's workspace.
        await handle.waitForExit()
        live.delete(handle)
      }
    },
  }))
}

export default apply
