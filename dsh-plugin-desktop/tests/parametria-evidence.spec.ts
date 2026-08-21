/**
 * Fences for the Parametria run-evidence surface (issue #23).
 *
 * The claim under test is narrow and checkable: a Parametria run no longer has
 * to BUILD the path its artifacts go to, because the host resolves it, creates
 * it, publishes it to every shell call, and derives the capture tool's output
 * directory from the same two functions. Each of those is asserted here against
 * the REAL `ShellEnvRegistry` rather than a stub of it — the registry is where
 * the `DSH_` prefix rule, the unique-key rule, the mandatory description, and
 * the declared-key check live, so a stub would be a test of my own assumptions
 * about upstream instead of a test of upstream.
 *
 * What is NOT provable here, stated so nothing reads greener than it is: that a
 * running Parametria session actually receives the variable and writes there.
 * That is a live datum and it is named in the PR body.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import {
  EVIDENCE_DIR_ENV,
  EVIDENCE_IGNORE_MARKER,
  EVIDENCE_ROOT_SEGMENT,
  apply,
  evidenceDirFor,
  evidenceSiteProblem,
  prepareEvidenceDir,
} from '../src/parametria-evidence.ts'
import { EVIDENCE_ROOT_SEGMENT as CAPTURE_ROOT_SEGMENT, planCapture } from '../src/parametria-capture.ts'

const CWD = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo'
const SESSION = 'session-1a2b3c'
const signal = new AbortController().signal

/**
 * One shell-tool execution, shaped like upstream's own registry tests.
 * @param session - the calling session's id and cwd, or undefined for an agent-less call.
 * @returns the execution the registry resolves against.
 */
function execution(session?: { id: string; cwd?: string }): ToolExecution {
  return {
    signal,
    token: Symbol('evidence-test') as ToolExecution['token'],
    callId: CallId('evidence-call'),
    rootCallId: CallId('evidence-call'),
    name: 'pwsh',
    arguments: { command: 'true' },
    ...(session === undefined
      ? {}
      : {
          agent: {
            session: { header: { version: 0, id: session.id, cwd: session.cwd, createdAt: 0 } },
          } as Agent,
        }),
  }
}

/**
 * A registry with the contributor mounted, and a scratch workspace to anchor to.
 * @param createOnResolve - whether the contributor creates the directory.
 * @returns the live registry and the temporary workspace root.
 */
function mounted(createOnResolve = true): { registry: ShellEnvRegistry; cwd: string } {
  const ctx = new Context()
  const registry = new ShellEnvRegistry(ctx, { dshHome: join(tmpdir(), 'evidence-test-home') })
  apply(ctx, { createOnResolve })
  const cwd = mkdtempSync(join(tmpdir(), 'parametria-evidence-'))
  return { registry, cwd }
}

describe('one derivation, shared with the capture tool', () => {
  it('resolves <cwd>/<root>/<session id>', () => {
    expect(evidenceDirFor({ cwd: CWD, sessionId: SESSION }))
      .toBe(join(CWD, EVIDENCE_ROOT_SEGMENT, SESSION))
  })

  it('is the SAME declaration the capture tool writes under', () => {
    // Not `toBe('.parametria-evidence')`: the literal is the thing being
    // deduplicated, so asserting it twice would be the duplication this fence
    // exists to prevent. What matters is that the two modules answer with one
    // value, whatever that value is.
    expect(CAPTURE_ROOT_SEGMENT).toBe(EVIDENCE_ROOT_SEGMENT)
  })

  it('declares the root segment exactly once in the plugin source', () => {
    // The dedupe claim as a checkable claim (standard 12). A future edit that
    // pastes the literal back into another module fails here rather than
    // creating a second answer that drifts quietly.
    const sources = ['parametria-evidence', 'parametria-capture'].map(module => readFileSync(
      fileURLToPath(new URL(`../src/${module}.ts`, import.meta.url)), 'utf8',
    ))
    const declarations = sources.flatMap(source => [
      ...source.matchAll(/export const EVIDENCE_ROOT_SEGMENT = '/g),
    ])
    expect(declarations).toHaveLength(1)
  })

  it('gives the capture tool the very directory the shell variable names', () => {
    // The property that makes the surface one surface: a delegate reading the
    // variable and a delegate calling the tool land in the same place.
    const { registry, cwd } = mounted()
    try {
      const fromShell = registry.collect(execution({ id: SESSION, cwd }))[EVIDENCE_DIR_ENV]
      const script = fileURLToPath(new URL('../src/parametria-evidence.ts', import.meta.url))
      const { evidenceDir } = planCapture(
        { definitionId: 'abc123', outputName: 'shot.png' },
        { cwd, sessionId: SESSION },
        { captureScript: script, uv: 'uv' },
      )
      expect(fromShell).toBe(evidenceDir)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('the site rule, rendered two ways', () => {
  it('accepts a usable site', () => {
    expect(evidenceSiteProblem({ cwd: CWD, sessionId: SESSION })).toBeUndefined()
  })

  it('refuses a site whose id could redirect the run directory', () => {
    for (const sessionId of ['', '  ', '../other', 'a/b', 'a\\b', '..']) {
      expect(evidenceSiteProblem({ cwd: CWD, sessionId })).toBeTypeOf('string')
    }
  })

  it('refuses a site without an absolute workspace', () => {
    for (const cwd of ['', '   ', 'relative/dir']) {
      expect(evidenceSiteProblem({ cwd, sessionId: SESSION })).toBeTypeOf('string')
    }
  })

  it('withholds the variable rather than guessing, for every refused site', () => {
    const { registry } = mounted()
    expect(registry.collect(execution())).not.toHaveProperty(EVIDENCE_DIR_ENV)
    expect(registry.collect(execution({ id: SESSION }))).not.toHaveProperty(EVIDENCE_DIR_ENV)
    expect(registry.collect(execution({ id: '../escape', cwd: CWD })))
      .not.toHaveProperty(EVIDENCE_DIR_ENV)
    expect(registry.collect(execution({ id: SESSION, cwd: 'relative/dir' })))
      .not.toHaveProperty(EVIDENCE_DIR_ENV)
  })
})

describe('the contributor, against the real registry', () => {
  it('publishes the run directory for the CALLING session', () => {
    const { registry, cwd } = mounted()
    try {
      expect(registry.collect(execution({ id: SESSION, cwd }))[EVIDENCE_DIR_ENV])
        .toBe(join(cwd, EVIDENCE_ROOT_SEGMENT, SESSION))
      // A delegate is a different session at the same workspace, and its own
      // copy must name ITS directory — the persona's "pass absolute paths down"
      // instruction exists because of exactly this, so the divergence is
      // asserted rather than left as prose.
      expect(registry.collect(execution({ id: 'child-9f9', cwd }))[EVIDENCE_DIR_ENV])
        .toBe(join(cwd, EVIDENCE_ROOT_SEGMENT, 'child-9f9'))
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('declares the key with a description the registry accepts', () => {
    // The registry rejects an undescribed key, a non-`DSH_` key, a reserved
    // key, and a second owner — mounting against the real one is what proves
    // this contribution is legal rather than merely well-intentioned.
    const { registry } = mounted()
    const declared = registry.list().find(entry => entry.key === EVIDENCE_DIR_ENV)
    expect(declared?.contributor).toBe('parametria-evidence')
    expect(declared?.description.length).toBeGreaterThan(0)
  })

  it('creates the run directory and makes the ROOT self-ignoring', () => {
    const { registry, cwd } = mounted()
    try {
      const dir = registry.collect(execution({ id: SESSION, cwd }))[EVIDENCE_DIR_ENV] as string
      expect(statSync(dir).isDirectory()).toBe(true)
      const marker = join(cwd, EVIDENCE_ROOT_SEGMENT, '.gitignore')
      // `*` inside the directory is what makes the hygiene travel: PR #25's
      // entry in THIS repository's .gitignore only helps when the run's
      // workspace happens to be this repository, and the censused runs worked
      // in others.
      expect(readFileSync(marker, 'utf8')).toBe(EVIDENCE_IGNORE_MARKER)
      expect(readFileSync(marker, 'utf8').split('\n')).toContain('*')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('leaves an existing marker alone', () => {
    const { registry, cwd } = mounted()
    try {
      mkdirSync(join(cwd, EVIDENCE_ROOT_SEGMENT), { recursive: true })
      writeFileSync(join(cwd, EVIDENCE_ROOT_SEGMENT, '.gitignore'), '# operator edit\n*\n')
      registry.collect(execution({ id: SESSION, cwd }))
      expect(readFileSync(join(cwd, EVIDENCE_ROOT_SEGMENT, '.gitignore'), 'utf8'))
        .toBe('# operator edit\n*\n')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('publishes the path even when creation is off, and creates nothing', () => {
    const { registry, cwd } = mounted(false)
    try {
      expect(registry.collect(execution({ id: SESSION, cwd }))[EVIDENCE_DIR_ENV])
        .toBe(join(cwd, EVIDENCE_ROOT_SEGMENT, SESSION))
      expect(() => statSync(join(cwd, EVIDENCE_ROOT_SEGMENT))).toThrow()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('still publishes the path when preparation fails', () => {
    // Fail-open (standard 4): a workspace the host cannot write into must not
    // silently withdraw the variable, because the run's recovery from an absent
    // variable is a bare filename in the workspace root — the exact failure
    // this module removes. The failure surfaces on the run's own first write.
    const { registry, cwd } = mounted()
    try {
      // A FILE where the evidence root must be: mkdir then fails with ENOTDIR
      // (or EEXIST), which is the closest portable stand-in for an unwritable
      // workspace and needs no permission games.
      writeFileSync(join(cwd, EVIDENCE_ROOT_SEGMENT), 'not a directory')
      expect(registry.collect(execution({ id: SESSION, cwd }))[EVIDENCE_DIR_ENV])
        .toBe(join(cwd, EVIDENCE_ROOT_SEGMENT, SESSION))
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('never throws out of resolve, whatever the site', () => {
    // `collect()` is called inline by the shell tool; a throw here would take
    // the shell tool down with it, turning a filing convenience into an outage.
    const { registry, cwd } = mounted()
    try {
      for (const session of [undefined, { id: SESSION }, { id: '..', cwd }, { id: SESSION, cwd }]) {
        expect(() => registry.collect(execution(session))).not.toThrow()
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('prepareEvidenceDir', () => {
  it('is idempotent', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'parametria-evidence-'))
    try {
      const dir = join(cwd, EVIDENCE_ROOT_SEGMENT, SESSION)
      expect(prepareEvidenceDir(dir)).toBeUndefined()
      expect(prepareEvidenceDir(dir)).toBeUndefined()
      expect(statSync(dir).isDirectory()).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('returns the failure rather than throwing it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'parametria-evidence-'))
    try {
      writeFileSync(join(cwd, EVIDENCE_ROOT_SEGMENT), 'not a directory')
      expect(prepareEvidenceDir(join(cwd, EVIDENCE_ROOT_SEGMENT, SESSION))).toBeDefined()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
