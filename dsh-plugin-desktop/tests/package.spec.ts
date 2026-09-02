import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  APP_ICON_PATH,
  MARK_SOURCE_PATH,
  TRAY_BRAND_COLOR,
  TRAY_SOURCE_PATH,
  markColors,
  markElements,
  trayIconSvg,
} from '../scripts/brand-icon-sources.ts'
import { renderAppIcon } from '../scripts/generate-brand-icons.ts'

/**
 * Digest of the committed application icon.
 *
 * Produced by `node scripts/generate-brand-icons.ts` from `assets/parametria-logo-icon.svg`. It
 * replaced the vendored DeepSeek iOS icon (`315fbc6e…de80`) when the fork took its own mark.
 */
const APP_ICON_SHA256 = 'ab8aff25014e80dec1a0736b1b8e60972c22ab01d79f24b4084d0da16647cde8'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../', packageRoot)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  name?: unknown
  version?: unknown
  bin?: Record<string, unknown>
  exports?: Record<string, unknown>
  files?: unknown
  scripts?: Record<string, unknown>
  dsh?: { bundle?: { patch?: unknown }; client?: unknown }
  build?: {
    productName?: unknown
    appId?: unknown
    asarUnpack?: unknown
    afterPack?: unknown
    electronFuses?: unknown
    files?: unknown
    mac?: {
      hardenedRuntime?: unknown
      icon?: unknown
      mergeASARs?: unknown
      notarize?: unknown
      target?: unknown
      x64ArchFiles?: unknown
    }
    win?: { icon?: unknown; target?: unknown; artifactName?: unknown }
    nsis?: Record<string, unknown>
    portable?: Record<string, unknown>
    linux?: { icon?: unknown }
  }
  dependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}
const workspaceManifest = JSON.parse(readFileSync(new URL('package.json', workspaceRoot), 'utf8')) as {
  version?: unknown
  resolutions?: Record<string, unknown>
  scripts?: Record<string, unknown>
}
const ciWorkflow = readFileSync(new URL('.github/workflows/ci.yml', workspaceRoot), 'utf8')

/** One patch, or one entry inserted by a patch, as the include dialect parses it. */
interface PatchRow {
  id?: string
  insert?: PatchRow[]
  config?: Record<string, unknown>
}

/**
 * Find the `web-runtime` row in a parsed patch list, including inside insert groups.
 * @param patches - a patch list from `loadOverlayPatches`.
 * @returns the row, or undefined when the list carries none.
 */
function webRuntimeRow(patches: readonly unknown[]): PatchRow | undefined {
  for (const patch of patches as readonly PatchRow[]) {
    if (patch.id === 'web-runtime') return patch
    const nested = patch.insert === undefined ? undefined : webRuntimeRow(patch.insert)
    if (nested !== undefined) return nested
  }
  return undefined
}

describe('published package surface', () => {
  it('runs desktop and community market typechecks from the root command', () => {
    expect(workspaceManifest.scripts?.typecheck)
      .toBe('yarn workspace dsh-plugin-desktop typecheck && yarn workspace dsh-community-market typecheck')
  })

  it('runs desktop, community market, and preset tests from the root command', () => {
    expect(workspaceManifest.scripts?.test)
      .toBe('yarn workspace dsh-plugin-desktop test && yarn workspace dsh-community-market test && yarn workspace dsh-preset-parametria test')
  })

  it('registers both npm launcher names', () => {
    expect(manifest.name).toBe('dsh-plugin-desktop')
    expect(manifest.bin).toEqual({
      'dsh-plugin-desktop': 'lib/bin.js',
      'dsh-desktop': 'lib/bin.js',
    })
  })

  it('keeps the Parametria manifest exports and tsdown entries exhaustive in both directions', () => {
    // Standard 6, both directions (PR #66 R1): compare the sets discovered on
    // both surfaces, then snapshot the complete expected set. This catches an
    // entry added to either side, both sides, or with a mismatched source name.
    const expected = [
      'parametria-capture',
      'parametria-evidence',
      'parametria-read-image-fallback',
      'parametria-route-preflight',
    ]
    const manifestEntries = Object.keys(manifest.exports ?? {})
      .filter(subpath => subpath.startsWith('./parametria-'))
      .map(subpath => subpath.slice(2))
      .sort()
    const tsdown = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')
    const tsdownMatches = [...tsdown.matchAll(
      /^\s*'(?<entry>parametria-[^']+)': 'src\/(?<source>parametria-[^']+)\.ts',$/gmu,
    )]
    const tsdownEntries = tsdownMatches.map(({ groups }) => {
      expect(groups?.source).toBe(groups?.entry)
      return groups?.entry
    }).sort()

    expect(manifestEntries).toEqual(expected)
    expect(tsdownEntries).toEqual(expected)
    for (const subpath of expected) {
      expect(manifest.exports).toHaveProperty(`./${subpath}`)
    }
  })

  it('exposes the Host plugin and desktop-owned client face', () => {
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./windows-pwsh-sandbox', {
      types: './lib/types/windows-pwsh-sandbox.d.ts',
      default: './lib/windows-pwsh-sandbox.js',
    })
    expect(manifest.exports).toHaveProperty('./windows-agent-presets', {
      types: './lib/types/windows-agent-presets.d.ts',
      default: './lib/windows-agent-presets.js',
    })
    expect(manifest.exports).toHaveProperty('./terminal', {
      types: './lib/types/terminal.d.ts',
      default: './lib/terminal.js',
    })
    expect(manifest.exports).toHaveProperty('./pnpm', {
      types: './lib/types/pnpm.d.ts',
      default: './lib/pnpm.js',
    })
    expect(manifest.exports).toHaveProperty('./profile-service', {
      types: './lib/types/profile-service.d.ts',
      default: './lib/profile-service.js',
    })
    expect(manifest.exports).toHaveProperty('./profiles', {
      types: './lib/types/profiles.d.ts',
      default: './lib/profiles.js',
    })
    expect(manifest.exports).toHaveProperty('./diagnostics', {
      types: './lib/types/diagnostics.d.ts',
      default: './lib/diagnostics.js',
    })
    expect(manifest.exports).toHaveProperty('./updates', {
      types: './lib/types/updates.d.ts',
      default: './lib/updates.js',
    })
    expect(manifest.exports).toHaveProperty('./notifications', {
      types: './lib/types/notifications.d.ts',
      default: './lib/notifications.js',
    })
    expect(manifest.exports).toHaveProperty('./parametria-capture', {
      types: './lib/types/parametria-capture.d.ts',
      default: './lib/parametria-capture.js',
    })
    expect(manifest.exports).toHaveProperty('./parametria-evidence', {
      types: './lib/types/parametria-evidence.d.ts',
      default: './lib/parametria-evidence.js',
    })
    expect(manifest.exports).toHaveProperty('./parametria-route-preflight', {
      types: './lib/types/parametria-route-preflight.d.ts',
      default: './lib/parametria-route-preflight.js',
    })
    expect(manifest.exports).toHaveProperty('./parametria-read-image-fallback', {
      types: './lib/types/parametria-read-image-fallback.d.ts',
      default: './lib/parametria-read-image-fallback.js',
    })
    expect(manifest.exports).not.toHaveProperty('./windows-acl-runner')
    expect(manifest.exports).not.toHaveProperty('./desktop-cli')
    expect(manifest.exports).not.toHaveProperty('./desktop-runtime-environment')
    expect(manifest.exports).not.toHaveProperty('./desktop-terminal')
    expect(manifest.exports).not.toHaveProperty('./update-checker')
    expect(manifest.exports).not.toHaveProperty('./update-download')
    expect(manifest.exports).toHaveProperty('./package.json')
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.dsh?.client).toEqual({
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-theme',
      ],
    })
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-community-market')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/terminal')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/pnpm')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/profiles')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/diagnostics')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/notifications')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/updates')
  })

  it('restates every field the pinned web-runtime row sets, browser handoff off', () => {
    // An id-targeted patch REPLACES per top-level key (dsh-app-boot applyEntryPatches
    // assigns `target[key] = value`), so this row's `config` stands in for upstream's
    // whole object and every field it omits silently takes the web-app schema default.
    // rc.8 added `openBrowser` defaulting to true; the omission opened the operator's
    // browser on every desktop launch and every verify:profile run (#49).
    //
    // The key set therefore comes from the PINNED bundle's own row, not from a
    // literal here: at the next pin bump a field upstream adds fails this test until
    // the desktop row is re-derived against it, which is the direction that failed
    // silently at rc.8. The value assertion below then pins our intent for each one —
    // and note that `trustedHosts: []` is deliberate too: replacing upstream's
    // `!!js ctx.webStartup.trustedHosts` is what makes `--trusted-host`, like
    // `--no-open`, inert on a desktop-composed profile.
    const desktopRow = webRuntimeRow(loadOverlayPatches(
      'dsh-plugin-desktop',
      fileURLToPath(new URL('cordis.patch.yml', packageRoot)),
    ))
    const upstreamRow = webRuntimeRow(loadOverlayPatches(
      'dsh-plugin-desktop',
      createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'),
    ))
    expect(desktopRow).toBeDefined()
    expect(upstreamRow).toBeDefined()
    expect(Object.keys(desktopRow?.config ?? {}).sort())
      .toEqual(Object.keys(upstreamRow?.config ?? {}).sort())
    expect(desktopRow?.config).toEqual({
      openBrowser: false,
      printUrl: false,
      surfaceContext: true,
      trustedHosts: [],
    })
  })

  it('keeps unaudited marketplace packages out of the published runtime', () => {
    expect(manifest.dependencies).not.toHaveProperty('dshmarket')
    expect(manifest.optionalDependencies ?? {}).not.toHaveProperty('dshmarket')
  })

  it('patches app boot to accept an empty patch layer', () => {
    const patchPath = './patches/dsh-app-boot@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-app-boot@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-app-boot@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const marker = 'if (parsed === void 0 || parsed === null) return [];'
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedBoot = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
      packageRoot,
    ), 'utf8')
    expect(patch).toContain(marker)
    expect(installedBoot).toContain(marker)
  })

  it('patches read_image with the validated composition fallback seam', () => {
    const patchPath = './patches/dsh-tool-fs@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-tool-fs@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-tool-fs@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedToolFs = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js',
      packageRoot,
    ), 'utf8')
    expect(patch).toMatch(/^\+\t\tfallback = await ctx\.waterfall\("fs\/read-image-route", exec, \{$/mu)
    expect(patch).toMatch(/^\+\t\t\tactivateFallback\?\.\(\);$/mu)
    expect(installedToolFs).toMatch(/^\t\tfallback = await ctx\.waterfall\("fs\/read-image-route", exec, \{$/mu)
    expect(installedToolFs).toMatch(/^\t\t\tactivateFallback\?\.\(\);$/mu)
  })

  it('patches the browse panel with the Windows native-picker icon bridge', () => {
    const patchPath = './patches/dsh-client-ui-directory-picker-browse@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-directory-picker-browse@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-directory-picker-browse@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-directory-picker-browse/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      '__DSH_DESKTOP_PICK_DIRECTORY__',
      '__DSH_DESKTOP_VALIDATE_DIRECTORY__',
      'openDirectory(path)',
      'openDirectory(targetPath)',
      'IconFolderOpen16',
      'nativePickerButton',
      'browser.nativePicker',
      'border:1px solid var(--dsw-alias-border-l2)',
      'background:var(--dsw-alias-bg-layer-2)',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('marks the upstream Workspace browser as the desktop folder-drop target', () => {
    const patchPath = './patches/dsh-client-ui-workspace@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-workspace@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-workspace@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
      packageRoot,
    ), 'utf8')
    expect(patch).toContain('data-dsh-workspace-drop-target')
    expect(installedClient).toContain('data-dsh-workspace-drop-target')
  })

  it('builds public Host plugins and their private native bootstraps', () => {
    const config = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')

    expect(config).toContain("'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts'")
    expect(config).toContain("'windows-agent-presets': 'src/windows-agent-presets.ts'")
    expect(config).toContain("'windows-acl-runner': 'src/windows-acl-runner.ts'")
    expect(config).toContain("'desktop-cli': 'src/desktop-cli.ts'")
    expect(config).toContain("'desktop-runtime-environment': 'src/desktop-runtime-environment.ts'")
    expect(config).toContain("'desktop-terminal': 'src/desktop-terminal.ts'")
    expect(config).toContain("'profile-manager': 'src/profile-manager.ts'")
    expect(config).toContain("'profile-service': 'src/profile-service.ts'")
    expect(config).toContain("pnpm: 'src/pnpm.ts'")
    expect(config).toContain("profiles: 'src/profiles.ts'")
    expect(config).toContain("diagnostics: 'src/diagnostics.ts'")
    expect(config).toContain("notifications: 'src/notifications.ts'")
    expect(config).toContain("'diagnostic-export-worker': 'src/diagnostic-export-worker.ts'")
    expect(config).toContain("entry: { preload: 'src/preload.ts' }")
    expect(config).toContain("entryFileNames: 'preload.cjs'")
    expect(config).toContain("terminal: 'src/terminal.ts'")
    expect(config).toContain("'update-download': 'src/update-download.ts'")
    expect(config).toContain("updates: 'src/updates.ts'")
  })

  it('installs Host command PATHs after the launch snapshot and before profile boot', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const recover = main.indexOf('await resolveDesktopShellEnvironment')
    const applyRecovered = main.indexOf('Object.entries(shellEnvironmentResolution.updates)')
    const snapshot = main.indexOf('const environment = loadLayeredEnv')
    const install = main.indexOf('const pnpmRuntime = installDesktopPnpmRuntime')
    const prepare = main.indexOf('const prepared = prepareDesktopProfile')
    const installDsh = main.indexOf('const dshRuntime = process.platform === \'win32\'')
    const ownPnpm = main.indexOf('const releasePnpmRuntime = generation.own(')
    const ownDsh = main.indexOf('const releaseDshRuntime = generation.own(')
    const boot = main.indexOf('const ctx = await boot')

    expect(recover).toBeGreaterThanOrEqual(0)
    expect(applyRecovered).toBeGreaterThan(recover)
    expect(snapshot).toBeGreaterThan(applyRecovered)
    expect(install).toBeGreaterThan(snapshot)
    expect(ownPnpm).toBeGreaterThan(install)
    expect(prepare).toBeGreaterThan(install)
    expect(installDsh).toBeGreaterThan(prepare)
    expect(ownDsh).toBeGreaterThan(installDsh)
    expect(boot).toBeGreaterThan(prepare)
    expect(boot).toBeGreaterThan(installDsh)
    expect(main).toContain("'dsh-plugin-desktop: packaged pnpm runtime PATH'")
    expect(main).toContain("'dsh-plugin-desktop: packaged dsh runtime PATH'")
    expect(main).toContain("args: ['--host', '127.0.0.1', '--port', String(prepared.port)]")
    expect(main).not.toContain("'--port', '0'")
    expect(main).toContain("import { DesktopStartupGeneration } from './startup-generation.ts'")
    expect(main).toContain('async () => { await generation.release() }')
    expect(main).not.toContain('disposePnpmRuntime')
    expect(main).not.toContain('disposeDshRuntime')
  })

  it('wires local crash evidence before Electron becomes ready', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const startCrashReporter = main.indexOf('startDesktopCrashReporting(crashReporter')
    const beginRun = main.indexOf('beginDesktopRun(')
    const childLogging = main.indexOf('installDesktopChildProcessLogging(app')
    const exitCoordinator = main.indexOf('createDesktopExitCoordinator(')
    const ready = main.indexOf('await app.whenReady()')
    const markClean = main.indexOf('desktopRun?.markClean()')
    const nativeExit = main.indexOf('app.exit(code)')

    expect(startCrashReporter).toBeGreaterThanOrEqual(0)
    expect(beginRun).toBeGreaterThan(startCrashReporter)
    expect(childLogging).toBeGreaterThan(beginRun)
    expect(exitCoordinator).toBeGreaterThan(childLogging)
    expect(nativeExit).toBeGreaterThan(exitCoordinator)
    expect(markClean).toBeGreaterThan(nativeExit)
    expect(ready).toBeGreaterThan(markClean)
  })

  it('claims plugin install recovery before profile composition and gates health in Electron main', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const fixedStatePath = main.indexOf("desktopInstallRecoveryStatePath(app.getPath('userData'))")
    const beginProfile = main.indexOf('profileStartup = beginDesktopProfileStartup(')
    const stateCommit = main.indexOf('const stateCommit = new DesktopStartupStateCommit({')
    const claim = main.indexOf('const recoveryClaim = await installRecovery.claim()')
    const observeClaim = main.indexOf('stateCommit.observeInstallRecoveryClaim(recoveryClaim)')
    const prepare = main.indexOf('const prepared = prepareDesktopProfile(')
    const monitor = main.indexOf('const rendererBoot = runtime.beginRendererBootMonitoring({')
    const commitHealthy = main.indexOf('commitHealthy: async () => {', monitor)
    const awaitRenderer = main.indexOf('const [, rendererVerdict] = await Promise.all([')
    const mount = main.indexOf('runtime.mountScheduled(),', awaitRenderer)
    const commitStateHealthy = main.indexOf('await stateCommit.commitHealthy()', commitHealthy)

    expect(fixedStatePath).toBeGreaterThanOrEqual(0)
    expect(main).toContain("import { DesktopStartupStateCommit } from './startup-state-commit.ts'")
    expect(main).not.toContain("desktopInstallRecoveryStatePath(app.getPath('userData'), process.env)")
    expect(main).not.toContain('process.env[DESKTOP_INSTALL_RECOVERY_STATE_ENV]')
    expect(beginProfile).toBeGreaterThan(fixedStatePath)
    expect(stateCommit).toBeGreaterThan(beginProfile)
    expect(claim).toBeGreaterThan(stateCommit)
    expect(observeClaim).toBeGreaterThan(claim)
    expect(prepare).toBeGreaterThan(claim)
    expect(main).toContain('installRecoveryStatePath,\n      generationId,')
    expect(monitor).toBeGreaterThan(prepare)
    expect(commitHealthy).toBeGreaterThan(monitor)
    expect(commitStateHealthy).toBeGreaterThan(commitHealthy)
    expect(awaitRenderer).toBeGreaterThan(commitStateHealthy)
    expect(mount).toBeGreaterThan(awaitRenderer)
    expect(main).not.toContain('verifyingInstall')
    expect(main).not.toContain('verifiedInstallToClear')
    expect(main).not.toContain('await installRecovery.markHealthy(')
    expect(main).not.toContain('markDesktopProfileHealthy(')
  })

  it('wires lifecycle evidence through key startup stages and terminal outcomes', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const createRecorder = main.indexOf('const lifecycleRecorder = createDesktopLifecycleRecorder({')
    const startRun = main.indexOf('lifecycleRecorder.startStartup(startupStage)')
    const finishRenderer = main.indexOf('lifecycleRecorder.finishRendererBoot(')
    const rendererStage = main.indexOf("startupStage = 'renderer-startup'")
    const startRenderer = main.indexOf('lifecycleRecorder.startRendererBoot()')
    const awaitRenderer = main.indexOf('const [, rendererVerdict] = await Promise.all([')
    const healthStage = main.indexOf("startupStage = 'health-commit'")
    const completeStartup = main.indexOf('lifecycleRecorder.completeStartup(startupStage, rendererReport)')
    const catchFailure = main.indexOf('} catch (cause) {')
    const failPendingRenderer = main.indexOf('lifecycleRecorder.failRendererBootIfPending(')
    const catchFailStartup = main.indexOf('lifecycleRecorder.failStartup(', failPendingRenderer)

    expect(main).toContain("import { createDesktopLifecycleRecorder } from './lifecycle-events.ts'")
    expect(createRecorder).toBeGreaterThanOrEqual(0)
    expect(startRun).toBeGreaterThan(createRecorder)
    for (const stage of [
      'shell-environment',
      'runtime-bootstrap',
      'profile-selection',
      'install-recovery',
      'profile-composition',
      'host-boot',
      'renderer-startup',
      'health-commit',
    ]) {
      expect(main).toContain(`startupStage = '${stage}'`)
    }
    expect(main).toContain('lifecycleRecorder.transitionStartupStage(startupStage)')
    expect(finishRenderer).toBeGreaterThan(createRecorder)
    expect(startRenderer).toBeGreaterThan(rendererStage)
    expect(startRenderer).toBeLessThan(awaitRenderer)
    expect(healthStage).toBeGreaterThan(startRenderer)
    expect(healthStage).toBeLessThan(awaitRenderer)
    expect(completeStartup).toBeGreaterThan(awaitRenderer)
    expect(failPendingRenderer).toBeGreaterThan(catchFailure)
    expect(catchFailStartup).toBeGreaterThan(failPendingRenderer)
    expect(main).toContain('lifecycleRendererFailureReason(runtime.rendererBootFailureReason)')
    expect(main).toContain('lifecycleStartupFailureReason(cause, runtime)')
  })

  it('routes protected and ordinary startup failures through the native recovery window', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const windows = [...main.matchAll(/await openStartupRecoveryWindow\(/gu)]
      .map(match => match.index)
    const prompt = main.indexOf("if (recoveryClaim.action === 'prompt')")
    const prepare = main.indexOf('const prepared = prepareDesktopProfile(')
    const commitFailure = main.indexOf('await startupStateCommit.commitFailure({')

    expect(windows).toHaveLength(2)
    expect(windows[0]).toBeGreaterThan(prompt)
    expect(windows[0]).toBeLessThan(prepare)
    expect(commitFailure).toBeGreaterThan(prepare)
    expect(windows[1]).toBeGreaterThan(commitFailure)
    expect(main).not.toContain('await installRecovery.restore(')
    expect(main).not.toContain('await installRecovery.recordFailure(')
    expect(main).not.toContain('markDesktopProfileFailed(')
    expect(main).toContain('quiesceForRecovery: () => generation.quiesceForRecovery()')
    expect(main).toContain('failureCommit.reopenLastKnownGood !== undefined')
    expect(main).toContain('failureStage: startupStage')
    expect(main).toContain("startupStage = 'profile-composition'")
    expect(main).toContain("startupStage = 'host-boot'")
    expect(main).toContain("startupStage = 'renderer-startup'")
    expect(main).toContain("return report.status === 'failed'")
    expect(main).not.toContain("return report.status === 'failed' && verifyingInstall !== undefined")
    expect(main).toContain('void run().catch(async (cause: unknown) => { await handleFatalLauncherFailure(cause) })')
    expect(main).toContain('await installRecovery.markRollbackNotified(')
  })

  it('uses the upstream child-environment scrub around login-shell recovery', () => {
    const shellEnvironment = readFileSync(new URL('src/shell-environment.ts', packageRoot), 'utf8')

    expect(shellEnvironment).toContain('scrubbedParentEnv')
    expect(shellEnvironment).toContain('SENSITIVE_ENV_PATTERN')
    expect(shellEnvironment).toContain('DSH_ENV_PREFIX')
    expect(shellEnvironment).toContain('DESKTOP_SHELL_ENVIRONMENT_KEYS')
  })

  it('fixes the installed application identity', () => {
    expect(manifest.version).toBe(workspaceManifest.version)
    expect(manifest.build?.productName).toBe('DSH Desktop')
    expect(manifest.build?.appId).toBe('ai.deepseek.dsh.desktop')
    expect(manifest.build?.asarUnpack).toEqual([
      'package.json',
      'cordis.patch.yml',
      'build/**',
      'lib/**',
      'node_modules/**',
    ])
    expect(manifest.build?.electronFuses).toEqual({ runAsNode: true })
    expect(manifest.files).toEqual(expect.arrayContaining([
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'docs/**',
    ]))
    expect(manifest.build?.files).toEqual([
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'cordis.patch.yml',
      'lib/**',
      'package.json',
      '!node_modules/node-pty/build/**',
    ])
    expect(manifest.build?.mac?.icon).toBe('build/app-icon-mac.png')
    expect(manifest.build?.mac?.mergeASARs).toBe(false)
    expect(manifest.build?.win?.icon).toBe('build/app-icon.png')
    expect(manifest.build?.win?.target).toEqual([{
      target: 'nsis',
      arch: ['x64'],
    }])
    expect(manifest.build?.win?.artifactName).toBe('DSH-Desktop-${version}-${arch}-Portable.${ext}')
    expect(manifest.build?.nsis).toEqual({
      license: 'THIRD_PARTY_NOTICES.md',
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      differentialPackage: false,
      shortcutName: 'DSH Desktop',
      useZip: true,
      artifactName: 'DSH-Desktop-${version}-${arch}-Setup.${ext}',
    })
    expect(manifest.build?.linux?.icon).toBe('build/app-icon.png')
  })

  it('separates unsigned smoke packaging from the signed macOS release', () => {
    const packageDir = readFileSync(new URL('scripts/package-dir.mjs', packageRoot), 'utf8')

    expect(manifest.scripts?.build).toContain('node scripts/generate-mac-app-icon.mjs')
    expect(manifest.scripts?.['package:dir']).toBe('yarn run build && node scripts/package-dir.mjs')
    expect(packageDir).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")
    expect(manifest.scripts?.['dist:mac']).toBe('node scripts/release-mac.ts')
    expect(manifest.scripts?.['dist:mac-smoke']).toBe('node scripts/package-mac.ts')
    expect(manifest.scripts?.['dist:win']).toBe('node scripts/package-win.ts')
    expect(manifest.scripts?.['dist:win-portable']).toBe('node scripts/package-win-portable.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run build')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run typecheck')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/package-win.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/verify-win-portable.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-checker.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-download.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/windows-volume-diagnostics.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run verify:closure')
    expect(manifest.scripts?.['check:mac-package']).toBe('yarn run -T check')
    expect(manifest.scripts?.['verify:cli']).toBe('node scripts/verify-cli-runtime.mjs')
    expect(manifest.scripts?.check).toContain('yarn run verify:cli')
    expect(workspaceManifest.scripts?.['dist:mac'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:mac')
    expect(workspaceManifest.scripts?.['dist:mac-smoke'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:mac-smoke')
    expect(workspaceManifest.scripts?.['dist:win'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:win')
    expect(workspaceManifest.scripts?.['dist:win-portable'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:win-portable')
    expect(manifest.build?.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(manifest.build?.mac).toEqual(expect.objectContaining({
      hardenedRuntime: true,
      mergeASARs: false,
      notarize: true,
      target: ['dir'],
      x64ArchFiles: expect.stringContaining('node-pty/prebuilds/darwin-*'),
    }))
    expect(manifest.build?.files).toContain('!node_modules/node-pty/build/**')
    expect(manifest.devDependencies?.['@electron/asar']).toBe('3.4.1')
  })

  it('runs the full gate once before reusing native packaging outputs on Windows', () => {
    const windowsJob = ciWorkflow.slice(
      ciWorkflow.indexOf('  desktop-windows:'),
      ciWorkflow.indexOf('  desktop-macos:'),
    )
    const macosJob = ciWorkflow.slice(
      ciWorkflow.indexOf('  desktop-macos:'),
      ciWorkflow.indexOf('  upstream-command-windows:'),
    )

    expect(windowsJob).toContain('- run: yarn check')
    expect(windowsJob).toContain('run: yarn workspace dsh-plugin-desktop dist:win')
    expect(windowsJob).toContain('run: yarn workspace dsh-plugin-desktop dist:win-portable')
    expect(windowsJob).toContain('DSH_PACKAGE_CHECK_ALREADY_RAN: \'1\'')
    expect(macosJob).not.toContain('- run: yarn workspace dsh-community-market check')
    expect(macosJob).toContain('- run: yarn check')
    expect(macosJob).toContain('run: yarn workspace dsh-plugin-desktop dist:mac-smoke')
    expect(macosJob).toContain('DSH_PACKAGE_CHECK_ALREADY_RAN: \'1\'')
    expect(macosJob).not.toContain('- run: yarn dist:mac-smoke')
  })

  it('skips product packaging only for documentation-only changes', () => {
    const classifier = fileURLToPath(new URL('../../scripts/classify-ci-changes.mjs', import.meta.url))
    const classify = (paths: string[]): string => execFileSync(
      process.execPath,
      [classifier],
      { input: Buffer.from(`${paths.join('\0')}\0`), encoding: 'utf8' },
    ).trim()

    expect(classify([
      'docs/architecture.md',
      '.agents/notes/implemented/architecture/decision.md',
      '.agents/notes/implemented/architecture/decision.i18n.yaml',
      'dsh-community-market/docs/schema.json',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
    ])).toBe('false')
    expect(classify(['README.md', 'dsh-plugin-desktop/src/index.ts'])).toBe('true')
    expect(classify(['.github/workflows/ci.yml'])).toBe('true')
    expect(classify(['THIRD_PARTY_NOTICES.md'])).toBe('true')
    expect(classify([])).toBe('true')

    expect(ciWorkflow).toContain('product="$(git diff --name-only -z')
    expect(ciWorkflow).toContain("if: needs.changes.outputs.product == 'true'")
    expect(ciWorkflow).toContain('Documentation-only change; product build and tests are not required.')
  })

  it('keeps one fixed brand-colour tray source for generated native assets', () => {
    const source = readFileSync(new URL('build/tray-icon.svg', packageRoot), 'utf8')

    // One paint value, and only one, read by attribute rather than by scanning for `#` tokens —
    // `fill="white"`, `fill="rgb(…)"` and `style="fill:…"` are all colours a token scan cannot
    // see. The macOS template variants are produced by replacing that one value with black, so a
    // second one would leave a template image that is not a silhouette.
    expect([...markColors(source)]).toEqual([TRAY_BRAND_COLOR])
    expect(source).not.toMatch(/<style\b|style\s*=|prefers-color-scheme/iu)
    for (const filename of [
      'tray-iconTemplate.png',
      'tray-iconTemplate@2x.png',
      'tray-icon-blue.png',
      'tray-icon-blue@1.25x.png',
      'tray-icon-blue@1.5x.png',
      'tray-icon-blue@2x.png',
    ]) {
      expect(readFileSync(new URL(`build/${filename}`, packageRoot)).byteLength).toBeGreaterThan(0)
    }
  })

  it('leaves every generated tray bitmap a single-hue silhouette', async () => {
    // The outcome, not the generator's source text. Whatever the generator is written to do, a
    // template image that carries anything but black-plus-alpha is not a template image, and a
    // brand bitmap that carries a second hue has lost the property the whole tray derivation
    // exists to preserve. Anti-aliasing makes edge pixels partly transparent, never differently
    // hued, so the check is on hue at full opacity.
    const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(TRAY_BRAND_COLOR.slice(index, index + 2), 16))
    for (const [filename, expected] of [
      ['tray-iconTemplate.png', [0, 0, 0]],
      ['tray-iconTemplate@2x.png', [0, 0, 0]],
      ['tray-icon-blue.png', [r, g, b]],
      ['tray-icon-blue@1.25x.png', [r, g, b]],
      ['tray-icon-blue@1.5x.png', [r, g, b]],
      ['tray-icon-blue@2x.png', [r, g, b]],
    ] as [string, number[]][]) {
      const { data, info } = await sharp(readFileSync(new URL(`build/${filename}`, packageRoot)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const opaque: number[][] = []
      for (let offset = 0; offset < data.length; offset += info.channels) {
        if ((data[offset + 3] as number) === 255) {
          opaque.push([data[offset] as number, data[offset + 1] as number, data[offset + 2] as number])
        }
      }

      expect(opaque.length).toBeGreaterThan(0)
      for (const pixel of opaque) expect(pixel).toEqual(expected)
    }
  })

  it('derives the tray source from the vendored mark rather than hand-authoring it', () => {
    // `build/tray-icon.svg` is committed, so nothing at build time would notice it drifting from
    // the artwork the application paints. Re-deriving it here is the guard: edit either the mark or
    // the committed source alone and this fails.
    const mark = readFileSync(new URL('assets/parametria-logo-icon.svg', packageRoot), 'utf8')

    expect(readFileSync(new URL('build/tray-icon.svg', packageRoot), 'utf8')).toBe(trayIconSvg(mark))
    expect(TRAY_BRAND_COLOR).toBe('#1a8fc4')

    // The generator writes the two committed sources; these bind the paths it writes to the paths
    // every guard above reads, so a generator pointed at a different file cannot leave the guards
    // passing against artwork nothing ships.
    expect(MARK_SOURCE_PATH).toBe(fileURLToPath(new URL('assets/parametria-logo-icon.svg', packageRoot)))
    expect(TRAY_SOURCE_PATH).toBe(fileURLToPath(new URL('build/tray-icon.svg', packageRoot)))
    expect(APP_ICON_PATH).toBe(fileURLToPath(new URL('build/app-icon.png', packageRoot)))

    // The derivation refuses a source it cannot flatten, rather than emitting one and trusting the
    // build to notice. A named colour is the case a hex-token scan cannot see.
    expect(() => trayIconSvg(mark.replace('fill="#1a8fc4"', 'fill="white"'))).toThrow(/only #1a8fc4/u)

    // The derivation drops the mark's `#fff` construction hairlines and keeps every solid element,
    // which is what makes a single-colour silhouette possible at all.
    expect(mark).toMatch(/<line\b/u)
    expect(trayIconSvg(mark)).not.toMatch(/<line\b|#fff/u)
    expect(markElements(mark)).toHaveLength(26)
    expect(markElements(mark).filter(element => !element.startsWith('<line'))).toHaveLength(12)
  })

  it('carries the Parametria mark as the application icon, in the format the macOS derivation requires', async () => {
    const icon = readFileSync(new URL('build/app-icon.png', packageRoot))
    const digest = createHash('sha256').update(icon).digest('hex')
    const metadata = await sharp(icon).metadata()

    // The pin. This icon is a committed raster rather than a build product on purpose — a PNG
    // re-encoded per machine could carry no digest at all — so the digest is what says the bytes in
    // the tree are the reviewed ones. Regenerate with `node scripts/generate-brand-icons.ts` and
    // move this line deliberately.
    expect(digest).toBe(APP_ICON_SHA256)

    // The format is a contract, not a coincidence: `generate-mac-app-icon.mjs` refuses any source
    // that is not a 1024-pixel RGBA16 PNG with an ICC profile, and copies that profile onto its
    // own output.
    expect(metadata).toEqual(expect.objectContaining({
      format: 'png',
      width: 1024,
      height: 1024,
      space: 'rgb16',
      depth: 'ushort',
      bitsPerSample: 16,
      channels: 4,
      hasAlpha: true,
    }))
    expect(metadata.icc).toBeInstanceOf(Buffer)
  })

  it('keeps the committed application icon a render of the vendored mark', async () => {
    // A digest says the bytes did not change; it does not say what they depict. This re-renders the
    // mark and compares the two at low resolution, which is insensitive to the rasteriser's
    // anti-aliasing across platforms and decisive about the artwork being a different picture.
    const mark = readFileSync(new URL('assets/parametria-logo-icon.svg', packageRoot), 'utf8')
    const compare = async (image: Buffer): Promise<Buffer> => sharp(image)
      .resize(64, 64, { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer()

    const committed = await compare(readFileSync(new URL('build/app-icon.png', packageRoot)))
    const rendered = await compare(await renderAppIcon(mark))
    let total = 0
    for (const [index, value] of committed.entries()) {
      total += Math.abs(value - (rendered[index] as number))
    }

    expect(total / committed.length).toBeLessThan(8)
  })

  it('generates a centered macOS icon with a 100-pixel visual inset', async () => {
    const source = await sharp(readFileSync(new URL('build/app-icon.png', packageRoot))).metadata()
    const icon = sharp(readFileSync(new URL('build/app-icon-mac.png', packageRoot)))
    const metadata = await icon.metadata()
    const { info } = await icon
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
      .toBuffer({ resolveWithObject: true })

    expect(metadata).toEqual(expect.objectContaining({
      format: 'png',
      width: 1024,
      height: 1024,
      space: 'rgb16',
      depth: 'ushort',
      bitsPerSample: 16,
      channels: 4,
      hasAlpha: true,
    }))
    expect(metadata.icc).toEqual(source.icc)
    expect(info).toEqual(expect.objectContaining({
      width: 824,
      height: 824,
      trimOffsetLeft: -100,
      trimOffsetTop: -100,
    }))
  })

  it('keeps Electron out of production dependencies consumed by electron-builder', () => {
    expect(manifest.dependencies).not.toHaveProperty('electron')
    expect(manifest.peerDependencies?.electron).toBe('43.4.0')
    expect(manifest.devDependencies?.electron).toBe('43.4.0')
    expect(manifest.dependencies?.pnpm).toBe('11.17.0')
  })

  it('packages the native-compiled Koffi Windows runtime', () => {
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')

    expect(manifest.dependencies?.koffi).toBe('3.1.5')
    expect(workspaceManifest.resolutions).toMatchObject({
      'koffi@npm:^3.1.0': '3.1.5',
    })
    expect(lockfile).toContain('"koffi@npm:3.1.5":')
    expect(lockfile).toContain('@koromix/koffi-win32-x64@npm:3.1.5')
    expect(lockfile).not.toContain('"koffi@npm:3.1.4":')
    expect(lockfile).not.toContain('@koromix/koffi-win32-x64@npm:3.1.4')
  })

  it('resolves electron-builder through the pinned app-builder-lib keychain patch', () => {
    const patchResolution = 'patch:app-builder-lib@npm%3A26.15.7#./patches/app-builder-lib@26.15.7.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/app-builder-lib@26.15.7.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const electronBuilderManifest = workspaceRequire.resolve('electron-builder/package.json')
    const electronBuilderRequire = createRequire(electronBuilderManifest)
    const appBuilderManifest = electronBuilderRequire.resolve('app-builder-lib/package.json')
    const installedCodeSign = readFileSync(join(dirname(appBuilderManifest), 'out/codeSign/macCodeSign.js'), 'utf8')

    expect(workspaceManifest.resolutions).toMatchObject({
      'app-builder-lib@npm:26.15.7': patchResolution,
    })
    expect(manifest.devDependencies?.['electron-builder']).toBe('26.15.7')
    expect(lockfile).toContain('app-builder-lib@patch:app-builder-lib@npm%3A26.15.7#./patches/app-builder-lib@26.15.7.patch')
    expect(patch).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(patch).toContain('"-k", keychainPassword, keychainFile')
    expect(installedCodeSign).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(installedCodeSign).toContain('"-k", keychainPassword, keychainFile')
  })

  it('starts restricted Windows shells with a hidden console show state', () => {
    const patchResolution = 'patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.1-rc.2#./patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const sandboxManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json')
    const sandboxLocalManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-local/package.json')
    const sandboxLocalRequire = createRequire(sandboxLocalManifest)
    const sandboxLib = join(dirname(sandboxManifest), 'lib')
    const runtimeChunks = readdirSync(sandboxLib).filter(name => /^types-.*\.js$/u.test(name))

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.1-rc.2': patchResolution,
      '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.1-rc.2': patchResolution,
    })
    expect(sandboxLocalRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json'))
      .toBe(sandboxManifest)
    expect(lockfile).toContain('@deepseek-ai/dsh-sandbox-windows-acl@patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.1-rc.2#./patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch')
    expect(patch.match(/^\+\s*dwFlags: 257,\r?$/gmu)).toHaveLength(2)
    expect(patch.match(/^\+\s*wShowWindow: 0,\r?$/gmu)).toHaveLength(2)
    expect(runtimeChunks).toHaveLength(1)
    const installedRuntime = readFileSync(join(sandboxLib, runtimeChunks[0] as string), 'utf8')
    expect(installedRuntime.match(/dwFlags: 257,/gu)).toHaveLength(2)
    expect(installedRuntime.match(/wShowWindow: 0,/gu)).toHaveLength(2)
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 0, null')
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 4, null')
    expect(installedRuntime).not.toContain('134217728')
  })

  it('patches every copy of the subagent packages that surface a child failure', () => {
    const seamResolution = 'patch:@deepseek-ai/dsh-subagent@npm%3A0.1.1-rc.2#./patches/dsh-subagent@0.1.1-rc.2.patch'
    const driverResolution = 'patch:@deepseek-ai/dsh-subagent-in-process-driver@npm%3A0.1.1-rc.2#./patches/dsh-subagent-in-process-driver@0.1.1-rc.2.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const seamPatch = readFileSync(
      new URL('patches/dsh-subagent@0.1.1-rc.2.patch', workspaceRoot),
      'utf8',
    )
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const seamManifest = workspaceRequire.resolve('@deepseek-ai/dsh-subagent/package.json')
    const driverManifest = workspaceRequire.resolve('@deepseek-ai/dsh-subagent-in-process-driver/package.json')

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-subagent@npm:0.1.1-rc.2': seamResolution,
      '@deepseek-ai/dsh-subagent@npm:^0.1.1-rc.2': seamResolution,
      '@deepseek-ai/dsh-subagent-in-process-driver@npm:0.1.1-rc.2': driverResolution,
      '@deepseek-ai/dsh-subagent-in-process-driver@npm:^0.1.1-rc.2': driverResolution,
    })
    expect(lockfile).toContain(`@deepseek-ai/dsh-subagent@${seamResolution}`)
    expect(lockfile).toContain(`@deepseek-ai/dsh-subagent-in-process-driver@${driverResolution}`)

    // The caret resolution is the load-bearing half: other upstream packages
    // carry a real `^0.1.1-rc.2` edge on the seam, so dropping it installs an
    // UNPATCHED nested copy that ships while every behavioural test stays
    // green (those resolve from this workspace root).
    for (const consumer of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-host-apiproxy']) {
      const consumerRequire = createRequire(workspaceRequire.resolve(`${consumer}/package.json`))
      expect(consumerRequire.resolve('@deepseek-ai/dsh-subagent/package.json')).toBe(seamManifest)
    }
    for (const provider of [
      '@deepseek-ai/dsh-subagent-spawn-in-process',
      '@deepseek-ai/dsh-subagent-fork-in-process',
    ]) {
      const providerRequire = createRequire(workspaceRequire.resolve(`${provider}/package.json`))
      expect(providerRequire.resolve('@deepseek-ai/dsh-subagent-in-process-driver/package.json'))
        .toBe(driverManifest)
    }

    // Declaration-anchored: the producer function and the export the driver
    // imports, read from the INSTALLED tree rather than the patch text.
    const installedDriver = readFileSync(join(dirname(driverManifest), 'lib/index.js'), 'utf8')
    const installedSeam = readFileSync(join(dirname(seamManifest), 'lib/index.js'), 'utf8')
    expect(installedDriver).toContain('function childFailureDiagnostic(reason, sessionId) {')
    expect(installedSeam).toMatch(/^export \{[^}]*\blimitSubagentDiagnostic\b/mu)
    expect(seamPatch.match(/^@@ /gmu)).toHaveLength(14)
    expect(seamPatch).toMatch(/^\+function epochTerminal\(events, childId, includeFailureDiagnostic\) \{$/mu)
    expect(installedSeam).toMatch(/^function epochTerminal\(events, childId, includeFailureDiagnostic\) \{$/mu)
    expect(installedSeam).toMatch(/^\s*static Config = z\.object\(\{ continuableFailureDiagnostics: z\.boolean\(\)\.default\(false\) \}\)\.default\(\{\}\);$/mu)
  })
})
