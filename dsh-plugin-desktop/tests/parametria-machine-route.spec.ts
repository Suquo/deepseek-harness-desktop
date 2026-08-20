/**
 * The fence issue #1 was missing: does a profile this launcher composes
 * actually declare the route the Parametria preset pins its validator to?
 *
 * The preset installs its agent preset into `$DSH_HOME/.agent-presets/`, which
 * every profile scans, and pins `subagent_validator` to provider
 * `parametria-vision`. Nothing in either half references the other, so a route
 * that is missing from the composed profile produces no composition error at
 * all — the validator spawns, delegates, and dies at its first request with
 * `no adapter registered for provider "parametria-vision"`. Two live runs were
 * lost that way while every static fence in `dsh-preset-parametria` stayed
 * green, because each one reads a source file and none of them composes a
 * profile.
 *
 * This asserts the property those could not: the route survives THIS package's
 * composition pipeline — `prepareDesktopProfile` + `composeEntries`, the pair
 * `src/main.ts` boots from — and reaches EVERY profile, not just `parametria`.
 * The `desktop` half is the load-bearing one: it is the profile the operator
 * actually boots, and the one that was blind.
 *
 * Composition rather than a full `boot()` on purpose — it is deterministic,
 * needs no Host, and fails for the same reason a boot would. The boot-level
 * evidence lives in `.engineering/research/no-adapter-repro.mjs`, which drives
 * the real `boot()` and reads the live `llm` registry.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { composeEntries, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { prepareDesktopProfile } from '../src/profile.ts'

const PRESET_ROOT = fileURLToPath(new URL('../../dsh-preset-parametria/', import.meta.url))
const INSTALLER = join(PRESET_ROOT, 'scripts', 'install-profile.mjs')
const MACHINE_PATCH = 'cordis.patch.yml'
const ROUTE = 'parametria-vision'

const homes: string[] = []

afterAll(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** A Harness home with the Parametria preset installed by its own installer. */
function installedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-parametria-route-'))
  homes.push(home)
  // The real installer, not a fixture: what it writes IS the claim under test,
  // so a change to where it puts the route has to reach this fence.
  execFileSync(process.execPath, [INSTALLER, '--home', home], { stdio: 'pipe' })
  return home
}

/** Every composed row of one profile, flattened through group rows. */
function composedRows(home: string, profileName: string): Map<string, EntryOptions> {
  const prepared = prepareDesktopProfile('1', home, 'win32', profileName)
  const rows = new Map<string, EntryOptions>()
  const walk = (entries: readonly EntryOptions[]): void => {
    for (const row of entries) {
      if (typeof row.id === 'string') rows.set(row.id, row)
      if (row.group === true && Array.isArray(row.config)) walk(row.config as EntryOptions[])
    }
  }
  walk(composeEntries([prepared.patches]))
  return rows
}

/** The provider routes the composed `llm-pi-ai` row declares. */
function declaredRoutes(home: string, profileName: string): string[] {
  const row = composedRows(home, profileName).get('llm-pi-ai')
  const config = row?.config as { providers?: Record<string, unknown> } | undefined
  return Object.keys(config?.providers ?? {})
}

describe('the parametria-vision route through the desktop composition pipeline', {
  // MEASURED on win32, not inherited: four installs and four
  // prepareDesktopProfile calls, 428-482ms per test, 2.0s for the file. These
  // temp homes do NOT pay profile.spec.ts's ~527-package junction relink — its
  // 45s budget would be ~90x here, which hides a real stall rather than
  // tolerating load. 10s is ~20x the slowest test, matching the ratio PR #44
  // settled on when it derived a budget from a tree that actually trims.
  timeout: process.platform === 'win32' ? 10_000 : 5_000,
}, () => {
  it('reaches the `desktop` profile — the one the operator actually boots', () => {
    // The whole point of the machine-wide plane. Before it, this list was
    // empty here and the validator died at its first request.
    expect(declaredRoutes(installedHome(), 'desktop')).toContain(ROUTE)
  })

  it('reaches the `parametria` profile too, from the same single declaration', () => {
    const home = installedHome()
    expect(declaredRoutes(home, 'parametria')).toContain(ROUTE)
    // ... and is declared once, not twice: the machine layer is applied after
    // the profile's and replaces the row's whole config, so a re-added profile
    // copy would be silently outranked rather than merged. Anchored to the
    // DECLARATION — the installed patch's own `llm-pi-ai` entry — because the
    // file's prose names the route while explaining its absence, and a
    // substring probe would read that sentence as the thing it forbids.
    const profileEntries = loadOptionalPatches(
      'parametria-machine-route.spec',
      join(home, 'profiles', 'parametria', MACHINE_PATCH),
    ) ?? []
    expect(profileEntries.map(entry => (entry as { id?: string }).id)).not.toContain('llm-pi-ai')
  })

  it('goes missing exactly when the machine-wide layer does', () => {
    // The red half, stated as a property rather than trusted: this is the
    // pre-fix world (route present in the package, absent from the machine
    // patch), and it must fail to declare the route under the profile the
    // operator boots. Without this, a future edit could drop the machine layer
    // and the two assertions above would keep passing on a stale home.
    const home = installedHome()
    rmSync(join(home, MACHINE_PATCH))
    expect(declaredRoutes(home, 'desktop')).not.toContain(ROUTE)
  })

  it('keeps the operator\'s own machine-patch entries beside it', () => {
    // The installer is a guest in `$DSH_HOME/cordis.patch.yml`. A merge that
    // dropped an operator row would be a silent loss of their configuration,
    // so the composition is checked, not just the file text.
    const home = mkdtempSync(join(tmpdir(), 'dsh-parametria-route-'))
    homes.push(home)
    writeFileSync(join(home, MACHINE_PATCH), '- id: session-title-llm\n  disabled: true\n')
    execFileSync(process.execPath, [INSTALLER, '--home', home], { stdio: 'pipe' })
    const rows = composedRows(home, 'desktop')
    expect(Object.keys((rows.get('llm-pi-ai')?.config as { providers?: object })?.providers ?? {})).toContain(ROUTE)
    expect(rows.get('session-title-llm')?.disabled).toBe(true)
  })
})
