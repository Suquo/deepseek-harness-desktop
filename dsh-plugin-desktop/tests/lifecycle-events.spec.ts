import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopLogger } from '../src/desktop-logger.ts'
import type { DesktopStartupFailureStage } from '../src/startup-recovery-window.ts'
import {
  createDesktopLifecycleRecorder,
  DESKTOP_LIFECYCLE_SCHEMA_VERSION,
  desktopLifecycleEvidencePath,
  MAX_DESKTOP_LIFECYCLE_EVENT_BYTES,
  MAX_DESKTOP_LIFECYCLE_EVIDENCE_BYTES,
  parseDesktopLifecycleEvent,
  summarizeDesktopLifecycleEvidence,
  type DesktopLifecycleEvent,
  type DesktopLifecycleSummary,
} from '../src/lifecycle-events.ts'

// Counts what the recorder reads, and can hide the file system's file id, so the
// append path's cost and its content fallback are both assertable rather than timed.
const fsProbe = vi.hoisted(() => ({
  counting: false,
  wholeFileReads: 0,
  bytesRead: 0,
  hideFileId: false,
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (fsProbe.counting) fsProbe.wholeFileReads += 1
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync,
    readSync: ((...args: Parameters<typeof actual.readSync>) => {
      const bytes = actual.readSync(...args)
      if (fsProbe.counting) fsProbe.bytesRead += bytes
      return bytes
    }) as typeof actual.readSync,
    fstatSync: ((...args: Parameters<typeof actual.fstatSync>) => {
      const stats = actual.fstatSync(...args) as object
      if (!fsProbe.hideFileId) return stats
      return new Proxy(stats, {
        get: (target, property, receiver) => property === 'ino'
          ? (typeof Reflect.get(target, property, receiver) === 'bigint' ? 0n : 0)
          : Reflect.get(target, property, receiver),
      })
    }) as typeof actual.fstatSync,
  }
})

interface CapturedLogger extends DesktopLogger {
  readonly error: ReturnType<typeof vi.fn<(message: string) => void>>
  readonly errorCause: ReturnType<typeof vi.fn<(cause: unknown) => void>>
}

const FIXED_NOW = new Date('2026-08-19T00:00:00.000Z')
const VALID_STAGE: DesktopStartupFailureStage = 'electron-ready'

function createLogger(): CapturedLogger {
  return {
    error: vi.fn<(message: string) => void>(),
    errorCause: vi.fn<(cause: unknown) => void>(),
  }
}

function tempUserData(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function readEvents(userDataDir: string): DesktopLifecycleEvent[] {
  const content = readFileSync(desktopLifecycleEvidencePath(userDataDir), 'utf8')
  return content
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => parseDesktopLifecycleEvent(JSON.parse(line) as unknown))
}

function baseEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: DESKTOP_LIFECYCLE_SCHEMA_VERSION,
    timestamp: FIXED_NOW.toISOString(),
    monotonicMs: 1,
    runId: 'run-1',
    operationId: 'op-1',
    eventName: 'startup.stage.started',
    stageId: VALID_STAGE,
    details: {},
    ...overrides,
  }
}

function eventLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(baseEvent(overrides))
}

describe('desktop lifecycle events', {
  // Windows budget sized from measurement. This file is not the junction-closure
  // class its siblings document — its cost is synchronous evidence-file I/O. One
  // test ('replaces stale run evidence and keeps current evidence within byte
  // caps') drives 900 transitionStartupStage calls, each of which rewrites the
  // byte-capped lifecycle JSONL under a fresh temp user-data dir; that single test
  // measures 359-472ms over twelve isolated runs (median 390) against a
  // second-worst of <=28ms, and 347-556ms over seven full-suite runs.
  //
  // It is in this PR because it demonstrably reds: a full-suite run at this branch
  // head killed it with `Test timed out in 5000ms`, which puts the stall it met at
  // >=12.8x its isolated median — the same class measured directly at 14.9x in
  // desktop-plugins.spec.ts. On the loaded worst, 556ms x 14.9 = 8.3s, so the 5s
  // default cannot cover the load this host produces.
  //
  // Sized to 15s rather than the 20s its siblings carry, because it is genuinely
  // cheaper and the number is derived, not copied: 15s clears the 8.3s compound
  // worst by 1.8x — the same clearance electron-runtime.spec.ts was ruled to — and
  // sits 27x above the 556ms loaded worst, keeping all four budgets inside one
  // tolerance band (1.4-1.8x over compound worst) instead of drifting apart.
  //
  // No ceiling constraint: this file declares no hooks, so its temp-dir work runs
  // inside this same budget. The POSIX arm keeps the 5s default — the load
  // characteristic sized here is NTFS/Defender and was not measured on a POSIX host.
  //
  // ---------------------------------------------------------------------------
  // The TEMPORARY 300_000 accommodation the a80c504f7f overlay merge carried here
  // is RETIRED: issue #41 removed the per-append whole-file read it was holding at
  // arm's length, and the budget is back to 15s. What that accommodation recorded
  // (merged tree: 4044-4610ms full-suite quiet, 6993-33729ms isolated, 19452ms in a
  // quiet gate, 183942ms in a loaded one) is history; it lives in PR #42 and #41.
  //
  // Re-measured at the fixed tree, same host, `replaces stale run evidence…`:
  //
  //   isolated, 3 runs:                   265 / 257 / 260 ms
  //   full-suite, quiet, 2 runs:          315 / 328 ms
  //   full-suite, 8-worker contention:    874 / 961 ms
  //   pre-merge parent ffce58c63b, same host, same day, isolated: 429 / 431 / 446 ms
  //
  // So the write path is cheaper than the pre-merge side this budget was derived
  // from, not merely restored: the append path no longer reads the file back at all.
  // Re-running the derivation on these numbers: the quiet full-suite worst of 328ms
  // against the 14.9x stall factor this file already cites gives a 4.9s compound
  // worst, which 15s clears by 3.1x, and the heaviest observed datum (961ms under
  // eight concurrent write/read workers) sits 15.6x below it.
  //
  // Disclosed rather than acted on: a band-faithful re-derivation (1.4-1.8x over the
  // 4.9s compound worst) would put this at 7-9s, tighter than the 15s restored here.
  // 15s is kept because it is the value this file's own retirement condition named,
  // and because the budget is no longer what detects a regression in this path —
  // 'appends startup transitions without reading the evidence file back' asserts the
  // mechanism directly (zero whole-file reads across 600 appends), which is what the
  // old comment's "at 15s a ~15x regression would still pass green" deferral wanted
  // and could not express in a timeout. Retighten on the RM's word, not silently.
  //
  // Also retired: tests/install-recovery.spec.ts kept vitest's 5s default through
  // all of this rather than take a budget for a cost that was not its own. Re-checked
  // at this head — 753 passed / 11 skipped with zero `Test timed out`, in a quiet
  // full gate AND in a full gate run under the eight-worker contention above.
  // ---------------------------------------------------------------------------
  timeout: process.platform === 'win32' ? 15_000 : 5_000,
}, () => {
  it.each([
    ['schema version', { schemaVersion: 2 }],
    ['event name', { eventName: 'startup.stage.skipped' }],
    ['stage id', { stageId: 'network-init' }],
    ['detail key', { details: { unexpected: 'value' } }],
    ['duration', { durationMs: -1 }],
    ['run id', { runId: '../run' }],
    ['operation id', { operationId: 'operation id' }],
  ])('rejects an invalid %s', (_label, overrides) => {
    expect(() => { parseDesktopLifecycleEvent(baseEvent(overrides)) }).toThrow()
  })

  it('uses injected clocks and ids for one correlated startup run', () => {
    const userDataDir = tempUserData('dsh-lifecycle-correlated-')
    const logger = createLogger()
    const ids = ['run-fixed', 'operation-fixed']
    const ticks = [100, 101, 110, 111, 120, 121, 130, 131, 200, 201, 250, 251, 300, 301, 400, 401]
    const recorder = createDesktopLifecycleRecorder({
      userDataDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger,
      now: () => FIXED_NOW,
      monotonicNow: () => ticks.shift() ?? 401,
      randomId: () => ids.shift() ?? 'unexpected-id',
    })

    recorder.startStartup('electron-ready')
    recorder.transitionStartupStage('shell-environment')
    recorder.startRendererBoot()
    recorder.finishRendererBoot({ status: 'healthy' })
    recorder.completeStartup('shell-environment', { status: 'healthy' })

    const events = readEvents(userDataDir)
    expect(events.map(event => event.runId)).toEqual(Array.from({ length: events.length }, () => 'run-fixed'))
    expect(events.map(event => event.operationId)).toEqual(Array.from({ length: events.length }, () => 'operation-fixed'))
    expect(events.map(event => event.eventName)).toEqual([
      'startup.run.started',
      'startup.stage.started',
      'startup.stage.completed',
      'startup.stage.started',
      'renderer.boot.started',
      'renderer.boot.completed',
      'startup.stage.completed',
      'startup.run.completed',
    ])
    expect(events[2]).toMatchObject({ stageId: 'electron-ready', durationMs: 10 })
    expect(events[5]).toMatchObject({
      eventName: 'renderer.boot.completed',
      durationMs: 50,
      details: { rendererStatus: 'healthy' },
    })
    expect(events[6]).toMatchObject({ stageId: 'shell-environment', durationMs: 170 })
    expect(events[7]).toMatchObject({
      eventName: 'startup.run.completed',
      durationMs: 300,
      details: { finalStage: 'shell-environment', rendererStatus: 'healthy' },
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('keeps a newer recorder generation isolated from a delayed older recorder', () => {
    const userDataDir = tempUserData('dsh-lifecycle-generation-')
    const olderLogger = createLogger()
    const olderIds = ['older-run', 'older-operation']
    const older = createDesktopLifecycleRecorder({
      userDataDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: olderLogger,
      now: () => FIXED_NOW,
      randomId: () => olderIds.shift() ?? 'older-extra',
    })
    older.startStartup('electron-ready')

    const newerLogger = createLogger()
    const newerIds = ['newer-run', 'newer-operation']
    const newer = createDesktopLifecycleRecorder({
      userDataDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: newerLogger,
      now: () => FIXED_NOW,
      randomId: () => newerIds.shift() ?? 'newer-extra',
    })
    newer.startStartup('runtime-bootstrap')

    older.failStartup('electron-ready', 'startup-failed')
    newer.completeStartup('runtime-bootstrap', { status: 'healthy' })

    const evidencePath = desktopLifecycleEvidencePath(userDataDir)
    const events = readEvents(userDataDir)
    expect(events.map(event => event.runId)).toEqual(Array.from({ length: events.length }, () => 'newer-run'))
    expect(events.map(event => event.operationId)).toEqual(Array.from({ length: events.length }, () => 'newer-operation'))
    expect(events.map(event => event.eventName)).toEqual([
      'startup.run.started',
      'startup.stage.started',
      'startup.stage.completed',
      'startup.run.completed',
    ])
    const summary = JSON.parse(summarizeDesktopLifecycleEvidence(readFileSync(evidencePath))?.toString('utf8') ?? '') as DesktopLifecycleSummary
    expect(summary).toMatchObject({
      eventCount: 4,
      parseErrorCount: 0,
      runId: 'newer-run',
      operationId: 'newer-operation',
      finalOutcome: 'completed',
    })
    expect(olderLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed to persist lifecycle evidence'))
    expect(newerLogger.error).not.toHaveBeenCalled()
  })

  it('records renderer start separately from terminal healthy, failed, and timeout outcomes', () => {
    const healthyDir = tempUserData('dsh-lifecycle-healthy-')
    const healthy = createDesktopLifecycleRecorder({
      userDataDir: healthyDir,
      appVersion: '2.0.1-test',
      platform: 'darwin',
      arch: 'arm64',
      logger: createLogger(),
      now: () => FIXED_NOW,
      monotonicNow: (() => {
        let tick = 0
        return () => {
          tick += 10
          return tick
        }
      })(),
      randomId: (() => {
        const ids = ['healthy-run', 'healthy-op']
        return () => ids.shift() ?? 'healthy-extra'
      })(),
    })
    healthy.startStartup('renderer-startup')
    healthy.startRendererBoot()
    expect(readEvents(healthyDir).map(event => event.eventName)).toContain('renderer.boot.started')
    expect(readEvents(healthyDir).map(event => event.eventName)).not.toContain('renderer.boot.completed')
    expect(readEvents(healthyDir).map(event => event.eventName)).not.toContain('startup.run.completed')
    healthy.finishRendererBoot({ status: 'healthy' })
    healthy.completeStartup('health-commit', { status: 'healthy' })
    expect(readEvents(healthyDir).find(event => event.eventName === 'renderer.boot.completed')).toMatchObject({
      eventName: 'renderer.boot.completed',
      details: { rendererStatus: 'healthy' },
    })
    expect(readEvents(healthyDir).at(-1)).toMatchObject({
      eventName: 'startup.run.completed',
      details: { finalStage: 'health-commit', rendererStatus: 'healthy' },
    })

    const failedDir = tempUserData('dsh-lifecycle-failed-')
    const failed = createDesktopLifecycleRecorder({
      userDataDir: failedDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: createLogger(),
      now: () => FIXED_NOW,
      randomId: (() => {
        const ids = ['failed-run', 'failed-op']
        return () => ids.shift() ?? 'failed-extra'
      })(),
    })
    failed.startStartup('renderer-startup')
    failed.startRendererBoot()
    failed.finishRendererBoot({
      status: 'failed',
      plugins: ['dsh-vision-router', '@scope/plugin-ok', '../escape', 'UpperBad', 'space bad'],
      error: 'ignored by lifecycle evidence',
    })
    failed.failStartup('renderer-startup', 'renderer-failed')
    expect(readEvents(failedDir).find(event => event.eventName === 'renderer.boot.failed')).toMatchObject({
      details: {
        rendererStatus: 'failed',
        failureReason: 'renderer-failed',
        pluginCount: 5,
        pluginIds: ['dsh-vision-router', '@scope/plugin-ok'],
      },
    })
    expect(readEvents(failedDir).at(-1)).toMatchObject({
      eventName: 'startup.run.failed',
      details: { finalStage: 'renderer-startup', failureReason: 'renderer-failed' },
    })

    const timeoutDir = tempUserData('dsh-lifecycle-timeout-')
    const timeout = createDesktopLifecycleRecorder({
      userDataDir: timeoutDir,
      appVersion: '2.0.1-test',
      platform: 'linux',
      arch: 'x64',
      logger: createLogger(),
      now: () => FIXED_NOW,
      randomId: (() => {
        const ids = ['timeout-run', 'timeout-op']
        return () => ids.shift() ?? 'timeout-extra'
      })(),
    })
    timeout.startStartup('renderer-startup')
    timeout.startRendererBoot()
    timeout.finishRendererBoot({ status: 'failed', plugins: [] }, 'renderer-timeout')
    timeout.failStartup('renderer-startup', 'renderer-timeout')
    expect(readEvents(timeoutDir).find(event => event.eventName === 'renderer.boot.timeout')).toMatchObject({
      details: { rendererStatus: 'timeout', failureReason: 'renderer-timeout', pluginCount: 0, pluginIds: [] },
    })
    expect(readEvents(timeoutDir).at(-1)).toMatchObject({
      eventName: 'startup.run.failed',
      details: { finalStage: 'renderer-startup', failureReason: 'renderer-timeout' },
    })
  })

  it('replaces stale run evidence and keeps current evidence within byte caps', () => {
    const userDataDir = tempUserData('dsh-lifecycle-cap-')
    const evidencePath = desktopLifecycleEvidencePath(userDataDir)
    mkdirSync(join(userDataDir, 'lifecycle-events'))
    writeFileSync(evidencePath, 'stale run evidence\n')
    const recorder = createDesktopLifecycleRecorder({
      userDataDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: createLogger(),
      now: () => FIXED_NOW,
      randomId: (() => {
        const ids = ['cap-run', 'cap-op']
        return () => ids.shift() ?? 'cap-extra'
      })(),
    })

    recorder.startStartup('electron-ready')
    expect(readFileSync(evidencePath, 'utf8')).not.toContain('stale run evidence')

    const stages: DesktopStartupFailureStage[] = [
      'shell-environment',
      'runtime-bootstrap',
      'profile-selection',
      'install-recovery',
      'profile-composition',
      'host-boot',
      'renderer-startup',
      'health-commit',
    ]
    for (let index = 0; index < 900; index += 1) {
      recorder.transitionStartupStage(stages[index % stages.length] as DesktopStartupFailureStage)
    }

    const evidence = readFileSync(evidencePath, 'utf8')
    expect(Buffer.byteLength(evidence)).toBeLessThanOrEqual(MAX_DESKTOP_LIFECYCLE_EVIDENCE_BYTES)
    const retainedEvents = evidence.split('\n').filter(item => item.length > 0)
    expect(JSON.parse(retainedEvents[0] ?? '{}')).toMatchObject({
      runId: 'cap-run',
      operationId: 'cap-op',
      eventName: 'startup.run.started',
    })
    for (const line of retainedEvents) {
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(MAX_DESKTOP_LIFECYCLE_EVENT_BYTES)
      expect(parseDesktopLifecycleEvent(JSON.parse(line) as unknown)).toMatchObject({
        runId: 'cap-run',
        operationId: 'cap-op',
      })
    }
  })

  it('appends startup transitions without reading the evidence file back', () => {
    const userDataDir = tempUserData('dsh-lifecycle-append-cost-')
    const logger = createLogger()
    const recorder = createDesktopLifecycleRecorder({
      userDataDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger,
      now: () => FIXED_NOW,
    })
    recorder.startStartup('electron-ready')
    const stages: DesktopStartupFailureStage[] = [
      'shell-environment',
      'runtime-bootstrap',
      'profile-selection',
      'install-recovery',
      'profile-composition',
      'host-boot',
      'renderer-startup',
      'health-commit',
    ]

    const transitions = 300
    fsProbe.wholeFileReads = 0
    fsProbe.bytesRead = 0
    fsProbe.counting = true
    try {
      for (let index = 0; index < transitions; index += 1) {
        recorder.transitionStartupStage(stages[index % stages.length] as DesktopStartupFailureStage)
      }
    } finally {
      fsProbe.counting = false
    }

    // Each transition closes one stage and opens the next: two appended events.
    const appendedEvents = transitions * 2
    const evidence = readFileSync(desktopLifecycleEvidencePath(userDataDir))
    const generationLineBytes = evidence.indexOf(0x0a) + 1
    expect(evidence.subarray(0, generationLineBytes).toString('utf8')).toContain('startup.run.started')
    // Every append landed, and none of them hit the trimming path, which is the only
    // path allowed to read the file: this is the plain append regime, end to end.
    expect(evidence.toString('utf8').split('\n').filter(line => line.length > 0)).toHaveLength(appendedEvents + 2)
    expect(evidence.byteLength).toBeLessThan(MAX_DESKTOP_LIFECYCLE_EVIDENCE_BYTES)

    // What #41 fixed: appending re-read the whole file every time, so the write path
    // cost grew with the evidence already written. Reading nothing back is the fix;
    // the fallback arm reads at most the generation line per append, never the file.
    expect(fsProbe.wholeFileReads).toBe(0)
    expect(fsProbe.bytesRead).toBeLessThanOrEqual(appendedEvents * generationLineBytes)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('isolates generations by content when the file system reports no file id', () => {
    const userDataDir = tempUserData('dsh-lifecycle-no-file-id-')
    const olderLogger = createLogger()
    const newerLogger = createLogger()
    fsProbe.hideFileId = true
    try {
      const olderIds = ['older-run', 'older-operation']
      const older = createDesktopLifecycleRecorder({
        userDataDir,
        appVersion: '2.0.1-test',
        platform: 'win32',
        arch: 'x64',
        logger: olderLogger,
        now: () => FIXED_NOW,
        randomId: () => olderIds.shift() ?? 'older-extra',
      })
      older.startStartup('electron-ready')

      const newerIds = ['newer-run', 'newer-operation']
      const newer = createDesktopLifecycleRecorder({
        userDataDir,
        appVersion: '2.0.1-test',
        platform: 'win32',
        arch: 'x64',
        logger: newerLogger,
        now: () => FIXED_NOW,
        randomId: () => newerIds.shift() ?? 'newer-extra',
      })
      newer.startStartup('runtime-bootstrap')
      older.failStartup('electron-ready', 'startup-failed')
      newer.completeStartup('runtime-bootstrap', { status: 'healthy' })
    } finally {
      fsProbe.hideFileId = false
    }

    // Same outcome as the file-id path above, reached by comparing the generation line.
    const events = readEvents(userDataDir)
    expect(events.map(event => event.runId)).toEqual(Array.from({ length: events.length }, () => 'newer-run'))
    expect(events.map(event => event.eventName)).toEqual([
      'startup.run.started',
      'startup.stage.started',
      'startup.stage.completed',
      'startup.run.completed',
    ])
    expect(olderLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed to persist lifecycle evidence'))
    expect(newerLogger.error).not.toHaveBeenCalled()
  })

  it('treats linked or unsafe evidence targets as best-effort logger-only failures', () => {
    const linkedParentDir = tempUserData('dsh-lifecycle-parent-link-')
    const linkedParentTarget = join(linkedParentDir, 'target')
    mkdirSync(linkedParentTarget)
    symlinkSync(linkedParentTarget, join(linkedParentDir, 'lifecycle-events'), process.platform === 'win32' ? 'junction' : 'dir')
    const linkedParentLogger = createLogger()
    const linkedParent = createDesktopLifecycleRecorder({
      userDataDir: linkedParentDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: linkedParentLogger,
      now: () => FIXED_NOW,
    })
    expect(() => { linkedParent.startStartup('electron-ready') }).not.toThrow()
    expect(linkedParentLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed to persist lifecycle evidence'))

    const linkedFileDir = tempUserData('dsh-lifecycle-file-link-')
    const linkedFileTarget = join(linkedFileDir, 'target.jsonl')
    mkdirSync(join(linkedFileDir, 'lifecycle-events'))
    writeFileSync(linkedFileTarget, '')
    symlinkSync(linkedFileTarget, desktopLifecycleEvidencePath(linkedFileDir), 'file')
    const linkedFileLogger = createLogger()
    const linkedFile = createDesktopLifecycleRecorder({
      userDataDir: linkedFileDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: linkedFileLogger,
      now: () => FIXED_NOW,
    })
    expect(() => { linkedFile.startStartup('electron-ready') }).not.toThrow()
    expect(linkedFileLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed to persist lifecycle evidence'))

    const hardlinkDir = tempUserData('dsh-lifecycle-hardlink-')
    const hardlinkTarget = join(hardlinkDir, 'target.jsonl')
    mkdirSync(join(hardlinkDir, 'lifecycle-events'))
    writeFileSync(hardlinkTarget, '')
    linkSync(hardlinkTarget, desktopLifecycleEvidencePath(hardlinkDir))
    const hardlinkLogger = createLogger()
    const hardlink = createDesktopLifecycleRecorder({
      userDataDir: hardlinkDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: hardlinkLogger,
      now: () => FIXED_NOW,
    })
    expect(() => { hardlink.startStartup('electron-ready') }).not.toThrow()
    expect(hardlinkLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed to persist lifecycle evidence'))

    const unsafeWriteDir = tempUserData('dsh-lifecycle-unsafe-write-')
    const unsafeWriteLogger = createLogger()
    const unsafeWrite = createDesktopLifecycleRecorder({
      userDataDir: unsafeWriteDir,
      appVersion: '2.0.1-test',
      platform: 'win32',
      arch: 'x64',
      logger: unsafeWriteLogger,
      now: () => FIXED_NOW,
    })
    const unsafeWritePath = desktopLifecycleEvidencePath(unsafeWriteDir)
    expect(existsSync(unsafeWritePath)).toBe(true)
    unlinkSync(unsafeWritePath)
    mkdirSync(unsafeWritePath)
    expect(() => { unsafeWrite.startStartup('electron-ready') }).not.toThrow()
    expect(unsafeWriteLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed to persist lifecycle evidence'))
    expect(unsafeWriteLogger.errorCause).not.toHaveBeenCalled()
  })

  it('summarizes only one correlated run while counting malformed and mismatched lines', () => {
    const summaryBuffer = summarizeDesktopLifecycleEvidence(Buffer.from([
      eventLine(),
      'not-json',
      eventLine({ operationId: 'other-op' }),
      eventLine({ eventName: 'startup.stage.completed', durationMs: 42 }),
      eventLine({
        eventName: 'renderer.boot.completed',
        stageId: undefined,
        details: { rendererStatus: 'healthy' },
      }),
      eventLine({
        eventName: 'startup.run.completed',
        stageId: undefined,
        durationMs: 100,
        details: { finalStage: 'health-commit', rendererStatus: 'healthy' },
      }),
      '',
    ].join('\n'), 'utf8'))

    expect(summaryBuffer).not.toBeUndefined()
    const summary = JSON.parse(summaryBuffer?.toString('utf8') ?? '') as DesktopLifecycleSummary
    expect(summary).toMatchObject({
      schemaVersion: DESKTOP_LIFECYCLE_SCHEMA_VERSION,
      eventCount: 4,
      parseErrorCount: 2,
      runId: 'run-1',
      operationId: 'op-1',
      finalOutcome: 'completed',
      finalStage: 'health-commit',
      rendererStatus: 'healthy',
      totalDurationMs: 100,
      stages: [{ stageId: 'electron-ready', status: 'completed', durationMs: 42 }],
    })
  })
})
