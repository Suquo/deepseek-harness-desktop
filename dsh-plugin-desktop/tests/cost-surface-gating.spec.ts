import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The cost surface must mount ONLY in the desktop-composed (advanced) shell.
 *
 * AGENTS.md binds compatibility mode to running the upstream default client
 * without overrides, and the cost badge is a desktop-owned surface. The
 * enforcement is structural rather than conditional: `installCostSurface` is
 * reachable only from `applyAdvancedShell`, which `apply` calls only after it
 * has established `environment.mode === 'advanced'`. A future edit that installs
 * it from `apply` — where the directory-picker bridge and the folder drop live,
 * both of which DO run in both modes — would silently put desktop UI into
 * compatibility mode, and that is what these fences catch.
 *
 * Runtime evidence is the primary proof and is recorded in the PR: a
 * compatibility-mode launch served no `dsh-plugin-desktop/cost-surface`
 * stylesheet and no badge, with upstream's `ui-layout` still composed. These
 * fences keep that property from regressing between launches.
 */

const CLIENT_DIRECTORY = fileURLToPath(new URL('../src/client/', import.meta.url))

function clientSource(name: string): string {
  return readFileSync(join(CLIENT_DIRECTORY, name), 'utf8')
}

/** Every client module, read off disk — never a hand-kept list (see the caller sweep). */
function clientModules(): string[] {
  return readdirSync(CLIENT_DIRECTORY).filter(name => name.endsWith('.ts') || name.endsWith('.tsx'))
}

/** Strip block and line comments so a fence matches code, never prose about code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const INSTALL = 'installCostSurface'

describe('the cost surface is gated to the desktop-composed shell', () => {
  it('is imported and installed by the advanced shell', () => {
    const advanced = code(clientSource('advanced-shell.ts'))
    // Declaration-anchored: the import specifier and the call, not a substring
    // that a comment mentioning the name would satisfy.
    expect(advanced).toMatch(new RegExp(String.raw`import \{ ${INSTALL} \} from '\./cost-surface\.ts'`))
    expect(advanced).toMatch(new RegExp(String.raw`ctx\.effect\(\(\) => ${INSTALL}\(ctx\)`))
  })

  it('is unreachable from the mode-independent entry point', () => {
    const entry = code(clientSource('index.ts'))
    // `apply` runs in BOTH modes. Anything it installs reaches compatibility
    // mode, which is exactly what this surface must not do.
    expect(entry).not.toContain(INSTALL)
    expect(entry).not.toContain('cost-surface')
    // The guard this depends on: `apply` reaches the advanced shell only behind
    // an explicit mode test.
    expect(entry).toMatch(/if \(environment\.mode === 'advanced'\) applyAdvancedShell\(ctx, environment\)/)
  })

  it('is installed by exactly one caller across the whole client', () => {
    // Read the DIRECTORY, never a hand-kept list. The first version named seven
    // files while `src/client/` held twenty, so a caller added in any of the
    // other thirteen passed this fence in silence — the same class as PR #10's
    // single-workspace-list fix.
    const modules = clientModules()
    expect(modules.length).toBeGreaterThan(7)
    expect(modules).toContain('advanced-shell.ts')
    const callers = modules.filter(name => new RegExp(String.raw`${INSTALL}\(ctx\)`).test(code(clientSource(name))))
    expect(callers).toEqual(['advanced-shell.ts'])
  })

  it('keeps its stylesheet separate from the advanced-shell and brand sheets', () => {
    // Three desktop-owned sheets with three lifetimes; folding this one into
    // `styles.ts` would tie a slot contribution's styles to the window frame's,
    // and would put this lane's edits in the file the brand work owns.
    const surface = code(clientSource('cost-surface.ts'))
    expect(surface).toMatch(/style\.dataset\.pluginCss = 'dsh-plugin-desktop\/cost-surface'/)
    expect(code(clientSource('styles.ts'))).not.toContain('dshDesktopCost')
  })

  it('marks an unpriced cell above the column rule that would otherwise win', () => {
    // Measured in the running app: `.dshDesktopCostUnknown` alone (0,1,0) loses
    // to `.dshDesktopCostTable tbody td:last-child` (0,2,2), so unpriced cells
    // rendered in the ordinary label colour and read as settled values.
    const surface = clientSource('cost-surface.ts')
    expect(surface).toContain('.dshDesktopCostTable tbody td.dshDesktopCostUnknown')
    expect(surface).not.toMatch(/^\.dshDesktopCostUnknown \{/m)
  })
})
