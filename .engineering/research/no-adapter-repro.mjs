/**
 * Issue #1 evidence harness: does a booted profile register `parametria-vision`?
 *
 * Boots one profile through the PRODUCTION path — `prepareDesktopProfile` then
 * `boot()`, the pair `dsh-plugin-desktop/src/main.ts` uses — against a
 * throwaway Harness home, and asks the live `llm` registry which routes exist.
 * No GUI: the desktop runtime is stubbed exactly as `verify-profile-boot.mjs`
 * stubs it, so this stays headless-safe (AGENTS.md).
 *
 * It is research, not a gate: it joins no `check` chain, writes nothing outside
 * its temp home, and never reads the operator's `$DSH_HOME` or `userData`.
 *
 *   yarn build                                                    # lib/ first
 *   node .engineering/research/no-adapter-repro.mjs --profile parametria --user-section
 *   node .engineering/research/no-adapter-repro.mjs --profile desktop    --user-section
 *
 * Recorded results (2026-08-20, rc.7 pin, every run with `--user-section` — the
 * operator's own `llm-pi-ai: providers: openrouter:` section present):
 *
 *   BEFORE — route declared in `profiles/parametria/cordis.patch.yml`
 *     --profile parametria  ->  parametria-vision registered? true
 *     --profile desktop     ->  parametria-vision registered? false
 *
 *   AFTER — route declared in the machine-wide `$DSH_HOME/cordis.patch.yml`
 *     --profile parametria  ->  parametria-vision registered? true
 *     --profile desktop     ->  parametria-vision registered? true
 *
 * The full route line both AFTER runs print is the artifact behind the claim
 * that the adapter merges the composition base with the user's settings section
 * per provider — the operator's own route is still there, beside ours:
 *
 *     live llm routes: deepseek-official, parametria-vision, openrouter
 *
 * The first pair is run 4's `NO_ADAPTER`, reproduced: the differentiator was the
 * ACTIVE PROFILE, not the settings merge, the patch order, or a missing pnpm
 * step. The second is the fix — the route reaches the profile the operator
 * actually boots. Running this file today reproduces the AFTER pair; for
 * BEFORE, delete the managed block from the temp home's `cordis.patch.yml`
 * between the install and the boot.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DESKTOP_ROOT = join(REPO_ROOT, 'dsh-plugin-desktop')
// Every dependency resolves through the desktop plugin's own graph: this file
// sits outside any workspace package, so bare specifiers here would not resolve.
const desktopRequire = createRequire(pathToFileURL(join(DESKTOP_ROOT, 'package.json')))
const load = async (specifier) => import(pathToFileURL(desktopRequire.resolve(specifier)).href)
const loadLib = async (file) => import(pathToFileURL(join(DESKTOP_ROOT, 'lib', file)).href)

const argumentValue = (flag) => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}
const profileName = argumentValue('--profile') ?? 'parametria'
const withUserSection = process.argv.includes('--user-section')

const { boot } = await load('@deepseek-ai/dsh-app-boot')
const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline')
const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment')
const { installDesktopPnpmRuntime } = await loadLib('desktop-runtime-environment.js')
const { installProfilePackageResolver } = await loadLib('module-resolution.js')
const { prepareDesktopProfile } = await loadLib('profile.js')
const { DesktopProfileService } = await loadLib('profile-service.js')

const home = mkdtempSync(join(tmpdir(), 'dsh-no-adapter-repro-'))
let ctx
let releasePackageResolver
let pnpmRuntime
let mountedSpec
try {
  execFileSync(process.execPath, [
    join(REPO_ROOT, 'dsh-preset-parametria', 'scripts', 'install-profile.mjs'),
    '--home',
    home,
  ], { stdio: 'inherit' })
  // The operator-shaped settings document: the preset is the roster default and
  // the user's own pi-ai route is present, which is the merge this reproduces.
  writeFileSync(join(home, 'settings.yaml'), [
    'dsh-desktop:',
    '  mode: advanced',
    'agent-default-model:',
    '  provider: openrouter',
    '  model: anthropic/claude-opus-5',
    ...withUserSection
      ? ['llm-pi-ai:', '  providers:', '    openrouter:', '      apiKeyEnv: OPENROUTER_API_KEY']
      : [],
    'agent-presets:',
    '  default: parametria',
    '',
  ].join('\n'))
  const prepared = prepareDesktopProfile('1', home, 'win32', profileName)
  const pnpmBinPath = join(DESKTOP_ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  const electronVersion = JSON.parse(
    readFileSync(join(DESKTOP_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'),
  ).version
  pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
  const runtime = {
    platform: 'win32',
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: false,
      currentVersion: '2.0.0',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('the repro must not perform update requests') },
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule(spec) { mountedSpec = spec; return async () => {} },
    async mountScheduled() {
      if (mountedSpec === undefined) throw new Error('desktop shell was not registered')
      runtime.setLocalePreference(mountedSpec.readLocalePreference())
      mountedSpec.readThemeSource()
    },
    show() {},
    registerTrayItem() { return { refresh() {}, dispose() {} } },
    openTerminal() {},
    setLocalePreference(preference) { runtime.locale = preference ?? 'en' },
    setThemeSource() {},
    async requestRestart() {},
    prepareToQuit() {},
  }
  ctx = await boot(
    'dsh-no-adapter-repro',
    prepared.rootConfig,
    prepared.patches,
    async (host) => {
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: profileName,
        activeProfileDir: prepared.profile.dir,
        homeDir: prepared.homeDir,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: join(DESKTOP_ROOT, 'lib', 'desktop-cli.js'),
        installRecoveryStatePath: join(home, 'plugin-install-recovery', 'state.json'),
        generationId: 'no-adapter-repro-generation',
      })
      await host.plugin(DesktopProfileService, {
        current: { name: profileName, dir: prepared.profile.dir },
        list: () => [{
          name: profileName,
          dir: prepared.profile.dir,
          exists: true,
          bundles: prepared.profile.layers.map(layer => layer.packageName),
          webCapable: true,
        }],
        persistSelection: () => {},
        requestRestart: () => {},
      })
      provideCmdline(host, { args: ['--host', '127.0.0.1', '--port', '0'], exit: () => {} })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()
  // `LlmProviderInfo.id` is the route key `GenerateOptions.provider` names —
  // the very string the failing children carried.
  const routes = ctx.llm.listProviders().map(entry => entry.id)
  process.stdout.write(
    `profile: ${profileName}   user llm-pi-ai section: ${withUserSection ? 'present' : 'absent'}\n`
    + `live llm routes: ${routes.join(', ')}\n`
    + `parametria-vision registered? ${routes.includes('parametria-vision')}\n`,
  )
} finally {
  await ctx?.fiber.dispose()
  releasePackageResolver?.()
  pnpmRuntime?.dispose()
  rmSync(home, { recursive: true, force: true })
}
