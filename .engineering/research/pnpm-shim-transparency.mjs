#!/usr/bin/env node
/**
 * Issue #55 evidence harness — is the DSH runtime-commands pnpm shim `packageManager`-transparent?
 *
 * The issue and relief-plan Phase 4 assert that the shim (shipped pnpm 11.7.0 at the time of
 * measurement, 2026-08-21; bumped to 11.17.0 by the #55 fix) fails in a repo
 * pinning a newer pnpm, and that `clear-env.mjs` wipes `npm_config_*` and so kills the bypass.
 * This harness measures each claim against a synthetic fixture repo.
 *
 * NOT a gate step. It needs network on a cold run (pnpm self-management downloads the pinned
 * version) and it spawns Electron. It is headless-safe by construction: every Electron spawn
 * carries ELECTRON_RUN_AS_NODE=1, exactly as the generated shim does, so no window is created.
 * Run it explicitly:
 *
 *   node .engineering/research/pnpm-shim-transparency.mjs
 *
 * It writes only into an OS temp dir and an isolated PNPM_HOME. It never touches the operator's
 * pnpm home, DSH userData, or any real repository.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const PLUGIN = join(REPO, 'dsh-plugin-desktop')

/** The pin a target repo declares. suquo-systems-rust/package.json:5 uses this exact shape. */
const TARGET_PIN = '11.17.0'
const TARGET_PACKAGE_MANAGER =
  `pnpm@${TARGET_PIN}+sha512.cca3cea332ad254bb84145f966d19f4879615210346fc92c79a047f23a0d7b3` +
  'cca3c3792f0076ba1f1831d277efbcf0a9119b31a9a60eca7fb3d6231f331ef72'

const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

function shippedPnpmEntry() {
  const entry = join(PLUGIN, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  return existsSync(entry) ? entry : undefined
}

function shippedPnpmVersion() {
  const manifest = join(PLUGIN, 'node_modules', 'pnpm', 'package.json')
  if (!existsSync(manifest)) return undefined
  return JSON.parse(readTextSync(manifest)).version
}

function readTextSync(file) {
  return readFileSync(file, 'utf8')
}

function electronBinary() {
  // `electron`'s postinstall does not always extract dist/ in a fresh worktree; allow an override
  // so the Electron-as-Node rows can still be measured against an equivalent binary.
  const override = process.env.DSH_SHIM_ELECTRON
  if (override !== undefined && existsSync(override)) return override
  const local = join(PLUGIN, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (existsSync(local)) return local
  const posix = join(PLUGIN, 'node_modules', 'electron', 'dist', 'electron')
  return existsSync(posix) ? posix : undefined
}

function electronVersion() {
  const manifest = join(PLUGIN, 'node_modules', 'electron', 'package.json')
  if (!existsSync(manifest)) return '0.0.0'
  return JSON.parse(readTextSync(manifest)).version
}

/**
 * Reproduce the generated Windows shim byte-for-byte in shape.
 * Replica of the PRE-FIX windowsPnpmShim() shape from dsh-plugin-desktop/src/desktop-runtime-environment.ts
 * as measured on 2026-08-21 (no NODE= assignment, no stale-target guard — both were added by the fix).
 * It is the shape whose transparency the issue contested; it is not kept in sync with the generator.
 */
function writeWindowsShim(dir, { electron, pnpmEntry, nodeBinDir, clearEnvUrl, electronVer }) {
  const shim = join(dir, 'pnpm.cmd')
  writeFileSync(shim, [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "PATH=${nodeBinDir};%PATH%"`,
    `set "${RUN_AS_NODE}=1"`,
    'set "npm_config_runtime=electron"',
    `set "npm_config_target=${electronVer}"`,
    `set "npm_config_disturl=${ELECTRON_HEADERS_URL}"`,
    `"${electron}" --import "${clearEnvUrl}" "${pnpmEntry}" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n'))
  return shim
}

/** Mirrors clearEnvironmentModule() in dsh-plugin-desktop/src/desktop-runtime-environment.ts (deletes exactly ELECTRON_RUN_AS_NODE). */
function writeClearEnv(dir) {
  const file = join(dir, 'clear-env.mjs')
  writeFileSync(file, [
    'for (const name of Object.keys(process.env)) {',
    `  if (name.toUpperCase() === '${RUN_AS_NODE}') delete process.env[name]`,
    '}',
    '',
  ].join('\n'))
  return file
}

function makeFixture(root, { npmrc } = {}) {
  const dir = join(root, 'fixture-pin')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: 'fixture-pin',
    private: true,
    packageManager: TARGET_PACKAGE_MANAGER,
    scripts: { 'dev:web': 'node -e "console.log(\'FIXTURE dev:web ran\')"' },
  }, undefined, 2)}\n`)
  if (npmrc !== undefined) writeFileSync(join(dir, '.npmrc'), `${npmrc}\n`)
  return dir
}

function run(label, command, args, { cwd, env, shell = false }) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell,
    windowsHide: true,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { label, status: result.status, ms: Date.now() - started, output }
}

/** Pull the effective pnpm version out of `pnpm --version` output. */
function parseVersion(output) {
  const match = /^\s*(\d+\.\d+\.\d+[^\s]*)\s*$/mu.exec(output)
  return match?.[1] ?? '(unparsed)'
}

function main() {
  const pnpmEntry = shippedPnpmEntry()
  const electron = electronBinary()
  const shipped = shippedPnpmVersion()

  if (pnpmEntry === undefined) {
    console.error('SKIP: dsh-plugin-desktop/node_modules/pnpm is not installed — run `corepack yarn install`.')
    process.exit(2)
  }

  const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-shim-'))
  const rows = []
  try {
    const privateDir = join(root, 'private')
    const nodeBinDir = join(privateDir, 'node-bin')
    mkdirSync(nodeBinDir, { recursive: true })
    const binDir = join(root, 'bin')
    mkdirSync(binDir, { recursive: true })
    const clearEnv = writeClearEnv(privateDir)
    const clearEnvUrl = pathToFileURL(clearEnv).href

    console.log(`shipped pnpm       : ${shipped}`)
    console.log(`target repo pin    : ${TARGET_PIN}`)
    console.log(`electron binary    : ${electron ?? '(absent — Electron rows will be skipped)'}`)
    console.log(`scratch root       : ${root}\n`)

    const fixture = makeFixture(root)

    // A — shipped pnpm under plain Node, inside a repo pinning newer.
    rows.push({
      ...run('A  plain Node, pinned repo', process.execPath, [pnpmEntry, '--version'], { cwd: fixture }),
      expect: TARGET_PIN,
    })

    // B — shipped pnpm under plain Node, OUTSIDE any pinned repo (control).
    rows.push({
      ...run('B  plain Node, unpinned cwd', process.execPath, [pnpmEntry, '--version'], { cwd: root }),
      expect: shipped,
    })

    if (electron !== undefined) {
      const shim = writeWindowsShim(binDir, {
        electron, pnpmEntry, nodeBinDir, clearEnvUrl, electronVer: electronVersion(),
      })
      const viaShim = process.platform === 'win32'
        ? { command: shim, args: ['--version'], shell: true }
        : undefined

      if (viaShim !== undefined) {
        // C — through the real generated shim (Electron-as-Node + clear-env + npm_config_*).
        rows.push({
          ...run('C  REAL shim, pinned repo', viaShim.command, viaShim.args, { cwd: fixture, shell: true }),
          expect: TARGET_PIN,
        })

        // D — same, but COLD: an isolated PNPM_HOME so self-management must download.
        const coldHome = join(root, 'pnpm-home-cold')
        mkdirSync(coldHome, { recursive: true })
        rows.push({
          ...run('D  REAL shim, COLD home', viaShim.command, viaShim.args, {
            cwd: fixture,
            shell: true,
            env: { PNPM_HOME: coldHome, XDG_DATA_HOME: coldHome },
          }),
          expect: TARGET_PIN,
        })

        // E — the script path the acceptance names, through the shim.
        const script = run('E  REAL shim, run dev:web', viaShim.command, ['run', 'dev:web'], {
          cwd: fixture, shell: true,
        })
        rows.push({ ...script, expect: 'FIXTURE dev:web ran', literal: true })
      }
    }

    console.log('| measurement | exit | effective pnpm / output | expected | verdict |')
    console.log('|---|---|---|---|---|')
    let failures = 0
    for (const row of rows) {
      const observed = row.literal ? (row.output.includes(row.expect) ? row.expect : row.output.split('\n').pop()) : parseVersion(row.output)
      const ok = row.literal ? row.output.includes(row.expect) : observed === row.expect
      if (!ok) failures += 1
      console.log(`| ${row.label} | ${row.status} | ${observed} | ${row.expect} | ${ok ? 'PASS' : 'FAIL'} |`)
    }
    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} — shim is ${failures === 0 ? '' : 'NOT '}packageManager-transparent.`)
    process.exit(failures === 0 ? 0 : 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

main()
