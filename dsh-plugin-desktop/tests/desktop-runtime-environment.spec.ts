import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter as pathDelimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installDesktopDshRuntime,
  installDesktopPnpmRuntime,
  type DesktopPnpmRuntimeOptions,
} from '../src/desktop-runtime-environment.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-pnpm-runtime-'))
  temporaryDirectories.push(directory)
  return directory
}

function options(
  stateDir: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): DesktopPnpmRuntimeOptions {
  return {
    platform,
    appExecutable: platform === 'win32'
      ? 'C:\\Program Files\\DSH 100% Desktop\\DSH Desktop.exe'
      : "/Applications/DSH O'Brien.app/Contents/MacOS/DSH Desktop",
    pnpmBinPath: platform === 'win32'
      ? 'C:\\Program Files\\DSH Desktop\\resources\\app.asar.unpacked\\node_modules\\pnpm\\bin\\pnpm.mjs'
      : "/Applications/DSH O'Brien.app/Contents/Resources/app.asar.unpacked/node_modules/pnpm/bin/pnpm.mjs",
    electronVersion: '43.4.0',
    stateDir,
    environment,
  }
}

/** The single line of a generated command that execs the Electron entry, excluding its preflight. */
function execLine(shim: string): string {
  const line = shim.split(/\r?\n/u).find(candidate => candidate.includes('--import'))
  if (line === undefined) throw new Error(`generated command has no exec line:\n${shim}`)
  return line
}

/**
 * Every environment assignment a generated command makes, in file order.
 * Exhaustive by construction so that a new assignment must be declared here to pass.
 */
function shimAssignments(shim: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [...shim.matchAll(/^set "([^=]+)=/gmu)].map(match => match[1] ?? '')
  }
  return [...execLine(shim).matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/gu)].map(match => match[1] ?? '')
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('desktop Host pnpm runtime', () => {
  it.each(['darwin', 'linux'] as const)('creates a pnpm-only public PATH on %s', (platform) => {
    const stateDir = join(temporaryDirectory(), 'runtime state')
    const environment: NodeJS.ProcessEnv = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      KEEP: 'value',
      ELECTRON_RUN_AS_NODE: 'inherited-value',
      npm_config_runtime: 'inherited-runtime',
    }
    const original = { ...environment }

    const installation = installDesktopPnpmRuntime(options(stateDir, platform, environment))

    expect(readdirSync(installation.pathDir)).toEqual(['pnpm'])
    expect(readdirSync(installation.nodeBinDir)).toEqual(['node'])
    if (process.platform !== 'win32') {
      expect(lstatSync(stateDir).mode & 0o777).toBe(0o700)
      expect(lstatSync(installation.pathDir).mode & 0o777).toBe(0o700)
      expect(lstatSync(installation.nodeBinDir).mode & 0o777).toBe(0o700)
      expect(lstatSync(installation.pnpmShimPath).mode & 0o777).toBe(0o700)
      expect(lstatSync(installation.nodeShimPath).mode & 0o777).toBe(0o700)
      expect(lstatSync(installation.clearEnvironmentPath).mode & 0o777).toBe(0o600)
    }

    const clearEnvironmentUrl = pathToFileURL(installation.clearEnvironmentPath).href
    const pnpm = readFileSync(installation.pnpmShimPath, 'utf8')
    expect(pnpm).toContain(`PATH='${installation.nodeBinDir}':"\${PATH:-}"`)
    expect(pnpm).toContain(`NODE='${installation.nodeShimPath}'`)
    expect(pnpm).toContain('ELECTRON_RUN_AS_NODE=1 npm_config_runtime=electron')
    expect(pnpm).toContain("npm_config_target='43.4.0'")
    expect(pnpm).toContain("npm_config_disturl='https://electronjs.org/headers'")
    expect(pnpm).toContain(`--import '${clearEnvironmentUrl}'`)
    // Scoped to the exec line: the stale-target preflight also names the pnpm entry, earlier in
    // the file, so a whole-file indexOf would compare against the guard instead of the exec.
    const posixExec = execLine(pnpm)
    expect(posixExec.indexOf(`--import '${clearEnvironmentUrl}'`))
      .toBeLessThan(posixExec.indexOf('pnpm/bin/pnpm.mjs'))
    const node = readFileSync(installation.nodeShimPath, 'utf8')
    expect(node).toContain(`ELECTRON_RUN_AS_NODE=1 exec`)
    expect(node).toContain(`--import '${clearEnvironmentUrl}' "$@"`)
    expect(node).not.toContain('npm_config_')
    expect(readFileSync(installation.clearEnvironmentPath, 'utf8')).toContain(
      "name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'",
    )

    expect(environment).toEqual({
      ...original,
      PATH: `${installation.pathDir}:/usr/local/bin:/usr/bin:/bin`,
    })
    if (process.platform !== 'win32') {
      expect(spawnSync('/bin/sh', ['-n', installation.pnpmShimPath]).status).toBe(0)
      expect(spawnSync('/bin/sh', ['-n', installation.nodeShimPath]).status).toBe(0)
    }

    installation.dispose()
    installation.dispose()
    expect(environment).toEqual(original)
  })

  it('keeps recovered login-shell PATH beneath the Desktop runtime PATH', () => {
    const stateDir = join(temporaryDirectory(), 'runtime')
    const recoveredPath = '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin'
    const environment: NodeJS.ProcessEnv = {
      PATH: recoveredPath,
      KEEP: 'value',
    }
    const original = { ...environment }

    const installation = installDesktopPnpmRuntime(options(stateDir, 'linux', environment))

    expect(environment.PATH).toBe(`${installation.pathDir}:${recoveredPath}`)
    installation.dispose()
    installation.dispose()
    expect(environment).toEqual(original)
  })

  it('clears every RunAsNode casing before the requested Node entry executes', () => {
    const stateDir = join(temporaryDirectory(), 'runtime')
    const installation = installDesktopPnpmRuntime(options(stateDir, 'linux', { PATH: '/usr/bin' }))
    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(installation.clearEnvironmentPath).href,
      '-e',
      'process.stdout.write(JSON.stringify(Object.keys(process.env).filter(name => name.toUpperCase() === "ELECTRON_RUN_AS_NODE")))',
    ], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        ELECTRON_RUN_AS_NODE: '1',
        electron_run_as_node: 'legacy',
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('[]')
    installation.dispose()
  })

  it('scopes Electron ABI settings to the pnpm process tree', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const captureEntry = join(root, 'capture.mjs')
    const captureOutput = join(root, 'capture.json')
    writeFileSync(captureEntry, [
      "import { writeFileSync } from 'node:fs'",
      'writeFileSync(process.argv[2], JSON.stringify({',
      "  runAsNode: Object.keys(process.env).filter(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),",
      '  runtime: process.env.npm_config_runtime,',
      '  target: process.env.npm_config_target,',
      '  disturl: process.env.npm_config_disturl,',
      '  node: process.env.NODE,',
      '  path: process.env.PATH,',
      '}))',
      '',
    ].join('\n'))
    const platform = process.platform === 'win32' ? 'win32' : 'linux'
    const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH }
    const installation = installDesktopPnpmRuntime({
      ...options(stateDir, platform, environment),
      appExecutable: process.execPath,
      pnpmBinPath: captureEntry,
    })

    const command = process.platform === 'win32'
      ? process.env.ComSpec ?? 'cmd.exe'
      : installation.pnpmShimPath
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', `""${installation.pnpmShimPath}" "${captureOutput}""`]
      : [captureOutput]
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: environment,
      shell: false,
      windowsVerbatimArguments: process.platform === 'win32',
    })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(readFileSync(captureOutput, 'utf8'))).toEqual({
      runAsNode: [],
      runtime: 'electron',
      target: '43.4.0',
      disturl: 'https://electronjs.org/headers',
      node: installation.nodeShimPath,
      path: `${installation.nodeBinDir}${pathDelimiter}${environment.PATH ?? ''}`,
    })
    expect(environment).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(environment).not.toHaveProperty('npm_config_runtime')
    installation.dispose()
  })

  it('creates Windows batch shims without publishing the private Node directory', () => {
    const stateDir = join(temporaryDirectory(), 'runtime-state')
    const environment: NodeJS.ProcessEnv = {
      Path: 'C:\\Windows\\System32;C:\\Windows',
      KEEP: 'value',
    }
    const original = { ...environment }

    const installation = installDesktopPnpmRuntime(options(stateDir, 'win32', environment))

    expect(readdirSync(installation.pathDir)).toEqual(['pnpm.cmd'])
    expect(readdirSync(installation.nodeBinDir)).toEqual(['node.cmd'])
    const clearEnvironmentUrl = pathToFileURL(installation.clearEnvironmentPath).href
    const escapedClearEnvironmentUrl = clearEnvironmentUrl.replaceAll('%', '%%')
    const pnpm = readFileSync(installation.pnpmShimPath, 'utf8')
    expect(pnpm).toContain(`set "PATH=${installation.nodeBinDir};%PATH%"`)
    expect(pnpm).toContain(`set "NODE=${installation.nodeShimPath}"`)
    expect(pnpm).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(pnpm).toContain('set "npm_config_runtime=electron"')
    expect(pnpm).toContain('set "npm_config_target=43.4.0"')
    expect(pnpm).toContain(`--import "${escapedClearEnvironmentUrl}"`)
    // Scoped to the exec line for the same reason as the POSIX case above.
    const windowsExec = execLine(pnpm)
    expect(windowsExec.indexOf(`--import "${escapedClearEnvironmentUrl}"`))
      .toBeLessThan(windowsExec.indexOf('pnpm\\bin\\pnpm.mjs'))
    const node = readFileSync(installation.nodeShimPath, 'utf8')
    expect(node).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(node).toContain(`--import "${escapedClearEnvironmentUrl}" %*`)
    expect(node).not.toContain('npm_config_')

    expect(environment).toEqual({
      Path: `${installation.pathDir};C:\\Windows\\System32;C:\\Windows`,
      KEEP: 'value',
    })
    expect(environment).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(environment).not.toHaveProperty('npm_config_runtime')

    installation.dispose()
    installation.dispose()
    expect(environment).toEqual(original)
  })

  it('removes only its own PATH component when another owner changes PATH later', () => {
    const stateDir = join(temporaryDirectory(), 'runtime')
    const platform = process.platform === 'win32' ? 'win32' : 'linux'
    const originalPath = process.platform === 'win32' ? 'C:\\Windows' : '/usr/bin'
    const laterPath = process.platform === 'win32' ? 'C:\\later' : '/later/bin'
    const environment: NodeJS.ProcessEnv = { PATH: originalPath }
    const installation = installDesktopPnpmRuntime(options(stateDir, platform, environment))
    environment.PATH = `${laterPath}${pathDelimiter}${environment.PATH ?? ''}`

    installation.dispose()
    installation.dispose()

    expect(environment).toEqual({ PATH: `${laterPath}${pathDelimiter}${originalPath}` })
  })

  it('does not duplicate or later remove a PATH component another owner supplied', () => {
    const stateDir = join(temporaryDirectory(), 'runtime')
    const pathDir = join(stateDir, 'bin')
    const platform = process.platform === 'win32' ? 'win32' : 'linux'
    const originalPath = process.platform === 'win32' ? 'C:\\Windows' : '/usr/bin'
    const environment: NodeJS.ProcessEnv = { PATH: `${pathDir}${pathDelimiter}${originalPath}` }
    const installation = installDesktopPnpmRuntime(options(stateDir, platform, environment))

    expect(environment.PATH).toBe(`${pathDir}${pathDelimiter}${originalPath}`)
    installation.dispose()
    expect(environment.PATH).toBe(`${pathDir}${pathDelimiter}${originalPath}`)
  })

  it('rejects symlinked state directories before changing PATH', () => {
    const root = temporaryDirectory()
    const target = join(root, 'target')
    const stateDir = join(root, 'runtime')
    mkdirSync(target)
    symlinkSync(target, stateDir)
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

    expect(() => installDesktopPnpmRuntime(options(stateDir, 'linux', environment)))
      .toThrow('not a private directory')
    expect(environment).toEqual({ PATH: '/usr/bin' })
  })

  it('rejects a symlinked generated file before changing PATH', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const pathDir = join(stateDir, 'bin')
    const privateDir = join(stateDir, 'private')
    const nodeBinDir = join(privateDir, 'node-bin')
    mkdirSync(pathDir, { recursive: true })
    mkdirSync(nodeBinDir, { recursive: true })
    const target = join(root, 'outside')
    writeFileSync(target, 'outside')
    symlinkSync(target, join(pathDir, 'pnpm'))
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

    expect(() => installDesktopPnpmRuntime(options(stateDir, 'linux', environment)))
      .toThrow('not a regular file')
    expect(readFileSync(target, 'utf8')).toBe('outside')
    expect(environment).toEqual({ PATH: '/usr/bin' })
  })

  it('recovers from stray command files instead of failing startup', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const pathDir = join(stateDir, 'bin')
    const nodeBinDir = join(stateDir, 'private', 'node-bin')
    mkdirSync(pathDir, { recursive: true })
    mkdirSync(nodeBinDir, { recursive: true })
    writeFileSync(join(pathDir, 'dsh'), 'stray')
    writeFileSync(join(nodeBinDir, 'dsh'), 'stray')
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const installation = installDesktopPnpmRuntime(options(stateDir, 'linux', environment))

    expect(readdirSync(pathDir)).toEqual(['pnpm'])
    expect(readdirSync(nodeBinDir)).toEqual(['node'])
    expect(environment.PATH).toBe(`${pathDir}:/usr/bin`)
    expect(stderr).toHaveBeenCalledTimes(2)
    installation.dispose()
  })

  it('removes stray symlinks without touching their targets', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const pathDir = join(stateDir, 'bin')
    mkdirSync(pathDir, { recursive: true })
    const target = join(root, 'outside')
    writeFileSync(target, 'outside')
    symlinkSync(target, join(pathDir, 'dsh'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const installation = installDesktopPnpmRuntime(options(stateDir, 'linux', { PATH: '/usr/bin' }))

    expect(readdirSync(pathDir)).toEqual(['pnpm'])
    expect(readFileSync(target, 'utf8')).toBe('outside')
    expect(stderr).toHaveBeenCalledOnce()
    installation.dispose()
  })

  it('refuses an unexpected directory in the public command directory', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const pathDir = join(stateDir, 'bin')
    mkdirSync(join(pathDir, 'dsh'), { recursive: true })
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

    expect(() => installDesktopPnpmRuntime(options(stateDir, 'linux', environment)))
      .toThrow('contains an unexpected directory: dsh')
    expect(environment).toEqual({ PATH: '/usr/bin' })
  })

  it('removes only strictly named stale atomic files before validating commands', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const pathDir = join(stateDir, 'bin')
    mkdirSync(pathDir, { recursive: true })
    const stale = join(pathDir, '.pnpm.123.123e4567-e89b-12d3-a456-426614174000.tmp')
    writeFileSync(stale, 'partial')
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

    const installation = installDesktopPnpmRuntime(options(stateDir, 'linux', environment))

    expect(readdirSync(pathDir)).toEqual(['pnpm'])
    installation.dispose()
  })

  // --- issue #55: packageManager transparency -------------------------------------------------
  //
  // Measured at the current pin (.engineering/research/pnpm-shim-transparency.mjs): a shipped pnpm
  // resolves the TARGET repository's `packageManager` pin by its own self-management, straight
  // through this shim, cold and warm. That transparency is what lets an agent run `pnpm` inside a
  // repo pinning a different pnpm with no PATH surgery — and nothing fenced it. These tests make
  // it a defended invariant: the shim must not change the working directory pnpm resolves from,
  // must forward argv verbatim, and must not assign anything that could steer that resolution.

  it.each(['win32', 'linux'] as const)(
    'assigns only Electron ABI settings on %s, never anything that steers pnpm',
    (platform) => {
      const stateDir = join(temporaryDirectory(), 'runtime')
      const installation = installDesktopPnpmRuntime(
        options(stateDir, platform, { PATH: platform === 'win32' ? 'C:\\Windows' : '/usr/bin' }),
      )
      const shim = readFileSync(installation.pnpmShimPath, 'utf8')

      // Exhaustive and order-sensitive: a new assignment fails here until it is declared, which is
      // what stops a future `npm_config_manage_package_manager_versions=false` from landing quietly.
      expect(shimAssignments(shim, platform)).toEqual([
        'PATH',
        'NODE',
        'ELECTRON_RUN_AS_NODE',
        'npm_config_runtime',
        'npm_config_target',
        'npm_config_disturl',
      ])
      installation.dispose()
    },
  )

  it('runs pnpm in the target repository with its packageManager inputs untouched', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const targetRepo = join(root, 'target repo')
    const captureEntry = join(root, 'capture.mjs')
    const captureOutput = join(root, 'capture.json')
    mkdirSync(targetRepo)
    writeFileSync(join(targetRepo, 'package.json'), JSON.stringify({
      name: 'target-repo',
      packageManager: 'pnpm@11.17.0',
    }))
    writeFileSync(captureEntry, [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      'writeFileSync(process.argv[2], JSON.stringify({',
      '  cwd: process.cwd(),',
      '  args: process.argv.slice(3),',
      "  resolvedPin: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).packageManager,",
      '  corepackStrict: process.env.COREPACK_ENABLE_STRICT,',
      '  corepackHome: process.env.COREPACK_HOME,',
      '  pnpmHome: process.env.PNPM_HOME,',
      '  manageVersions: process.env.npm_config_manage_package_manager_versions,',
      '  registry: process.env.npm_config_registry,',
      '}))',
      '',
    ].join('\n'))

    const platform = process.platform === 'win32' ? 'win32' : 'linux'
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      COREPACK_ENABLE_STRICT: '0',
      COREPACK_HOME: join(root, 'corepack home'),
      PNPM_HOME: join(root, 'pnpm home'),
      npm_config_manage_package_manager_versions: 'true',
      npm_config_registry: 'https://registry.example.invalid/',
    }
    const installation = installDesktopPnpmRuntime({
      ...options(stateDir, platform, environment),
      appExecutable: process.execPath,
      pnpmBinPath: captureEntry,
    })

    const result = spawnSync(
      process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : installation.pnpmShimPath,
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `""${installation.pnpmShimPath}" "${captureOutput}" run dev:web"`]
        : [captureOutput, 'run', 'dev:web'],
      {
        cwd: targetRepo,
        encoding: 'utf8',
        env: environment,
        shell: false,
        windowsVerbatimArguments: process.platform === 'win32',
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(readFileSync(captureOutput, 'utf8'))).toEqual({
      // pnpm resolves `packageManager` from the working directory: the shim must not relocate it.
      cwd: targetRepo,
      resolvedPin: 'pnpm@11.17.0',
      // Arguments reach pnpm verbatim, so `pnpm run dev:web` stays `pnpm run dev:web`.
      args: ['run', 'dev:web'],
      // Every self-management input survives the shim untouched.
      corepackStrict: '0',
      corepackHome: join(root, 'corepack home'),
      pnpmHome: join(root, 'pnpm home'),
      manageVersions: 'true',
      registry: 'https://registry.example.invalid/',
    })
    installation.dispose()
  })

  it('clears the RunAsNode marker and nothing else', () => {
    const stateDir = join(temporaryDirectory(), 'runtime')
    const installation = installDesktopPnpmRuntime(options(stateDir, 'linux', { PATH: '/usr/bin' }))
    const supplied: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      ELECTRON_RUN_AS_NODE: '1',
      electron_run_as_node: 'legacy',
      COREPACK_ENABLE_STRICT: '0',
      COREPACK_HOME: '/corepack',
      PNPM_HOME: '/pnpm',
      npm_config_manage_package_manager_versions: 'true',
      npm_config_registry: 'https://registry.example.invalid/',
      npm_config_runtime: 'electron',
    }
    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(installation.clearEnvironmentPath).href,
      '-e',
      'process.stdout.write(JSON.stringify(process.env))',
    ], { encoding: 'utf8', env: supplied })

    expect(result.status, result.stderr).toBe(0)
    const observed = JSON.parse(result.stdout) as NodeJS.ProcessEnv
    // Two-direction: exactly the RunAsNode casings are gone, and every other entry is byte-identical.
    const removed = Object.keys(supplied).filter(name => !(name in observed))
    expect(removed.sort()).toEqual(['ELECTRON_RUN_AS_NODE', 'electron_run_as_node'])
    for (const [name, value] of Object.entries(supplied)) {
      if (removed.includes(name)) continue
      expect(observed[name], `${name} must survive the preload`).toBe(value)
    }
    installation.dispose()
  })

  it('pins the shipped pnpm to an exact version', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const pinned = manifest.dependencies?.pnpm

    // The generated command records an absolute path into machine-global user data, so the shipped
    // pnpm must not drift under a range: a bump is a reviewed act, not an install-time accident.
    expect(pinned).toBeDefined()
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/u)
  })

  // --- issue #55: stale recorded targets ------------------------------------------------------

  it.each(['win32', 'linux'] as const)(
    'guards both recorded targets before executing on %s',
    (platform) => {
      const stateDir = join(temporaryDirectory(), 'runtime')
      const selected = options(stateDir, platform, {
        PATH: platform === 'win32' ? 'C:\\Windows' : '/usr/bin',
      })
      const installation = installDesktopPnpmRuntime(selected)
      const shim = readFileSync(installation.pnpmShimPath, 'utf8')

      for (const target of [selected.appExecutable, selected.pnpmBinPath]) {
        const guard = platform === 'win32'
          ? `if not exist "${target.replaceAll('%', '%%')}" goto :dsh_stale_target_`
          : `if [ ! -e '${target.replaceAll("'", `'"'"'`)}' ]; then`
        expect(shim, `${platform} shim must preflight ${target}`).toContain(guard)
        expect(shim.indexOf(guard)).toBeLessThan(shim.indexOf(execLine(shim)))
      }
      expect(shim).toContain('this generated command is stale and was not run.')
      expect(shim).toContain('Restart DSH Desktop to regenerate it.')
      installation.dispose()
    },
  )

  it('names the missing target instead of failing with a bare interpreter error', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const vanished = join(root, 'deleted worktree', 'electron')
    const platform = process.platform === 'win32' ? 'win32' : 'linux'
    const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH }
    const installation = installDesktopPnpmRuntime({
      ...options(stateDir, platform, environment),
      appExecutable: vanished,
      pnpmBinPath: join(root, 'entry.mjs'),
    })

    const result = spawnSync(
      process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : installation.pnpmShimPath,
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `""${installation.pnpmShimPath}" --version"`]
        : ['--version'],
      {
        encoding: 'utf8',
        env: environment,
        shell: false,
        windowsVerbatimArguments: process.platform === 'win32',
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(9009)
    const diagnostic = `${result.stdout}${result.stderr}`
    expect(diagnostic).toContain('this generated command is stale and was not run.')
    expect(diagnostic).toContain(`missing application executable: ${vanished}`)
    expect(diagnostic).toContain('Restart DSH Desktop to regenerate it.')
    installation.dispose()
  })

  it('fails loud for unsupported platforms and unsafe generated values', () => {
    const root = temporaryDirectory()
    expect(() => installDesktopPnpmRuntime(options(join(root, 'runtime'), 'aix', { PATH: '/usr/bin' })))
      .toThrow('unsupported on aix')
    expect(() => installDesktopPnpmRuntime({
      ...options(join(root, 'newline-runtime'), 'linux', { PATH: '/usr/bin' }),
      electronVersion: '43.4.0\nmalicious',
    })).toThrow('must not contain NUL or newlines')
  })
})

describe('desktop Host dsh runtime', () => {
  it.runIf(process.platform === 'win32')('makes the active profile available to Host plugin child processes', () => {
    const root = temporaryDirectory()
    const stateDir = join(root, 'runtime')
    const captureEntry = join(root, 'capture.mjs')
    const captureOutput = join(root, 'capture.json')
    const homeDir = join(root, 'Harness home')
    writeFileSync(captureEntry, [
      "import { writeFileSync } from 'node:fs'",
      'writeFileSync(process.argv[2], JSON.stringify({',
      '  args: process.argv.slice(3),',
      '  defaultProfile: process.env.DSH_DESKTOP_DEFAULT_PROFILE,',
      '  home: process.env.DSH_HOME,',
      '  installRecoveryStatePath: process.env.DSH_DESKTOP_INSTALL_RECOVERY_STATE_PATH,',
      '}))',
      '',
    ].join('\n'))
    const environment: NodeJS.ProcessEnv = { Path: process.env.PATH }
    const original = { ...environment }

    const installation = installDesktopDshRuntime({
      platform: 'win32',
      appExecutable: process.execPath,
      dshBootstrapPath: captureEntry,
      profileName: 'web',
      homeDir,
      installRecoveryStatePath: join(root, 'plugin-install-recovery', 'state.json'),
      stateDir,
      environment,
    })
    const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      `dsh "${captureOutput}" --probe`,
    ], {
      encoding: 'utf8',
      env: environment,
      shell: false,
      windowsVerbatimArguments: true,
    })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(readdirSync(installation.pathDir)).toEqual(['dsh.cmd'])
    expect(JSON.parse(readFileSync(captureOutput, 'utf8'))).toEqual({
      args: ['--probe'],
      defaultProfile: 'web',
      home: homeDir,
      installRecoveryStatePath: join(root, 'plugin-install-recovery', 'state.json'),
    })
    expect(environment.Path).toBe(`${installation.pathDir};${original.Path ?? ''}`)

    installation.dispose()
    installation.dispose()
    expect(environment).toEqual(original)
  })
})
