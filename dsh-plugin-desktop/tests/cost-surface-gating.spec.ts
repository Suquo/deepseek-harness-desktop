import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The cost surface mounts in BOTH shell modes, and stays purely additive in the
 * compatibility one.
 *
 * THE CONTRACT CHANGED, AND WHY. The first version of this file fenced the
 * opposite rule: the surface was advanced-only, because AGENTS.md then bound
 * compatibility mode to the upstream default client without overrides of any
 * kind. The owner ruled otherwise on 2026-08-20 (issues #26 and #5/#36) and
 * AGENTS.md was amended: compatibility mode may carry visual branding and
 * ADDITIVE desktop-owned UI that alters no upstream behaviour — injecting into a
 * documented slot is allowed there; replacing or altering upstream slots,
 * services or behaviour is not. The owner runs compatibility mode and saw no
 * cost surface at all, which is the whole reason the rule moved.
 *
 * So the gate did not disappear, it MOVED — from "which mode" to "what kind of
 * change". These fences hold the new line in three parts:
 *
 *  1. MOUNTS IN BOTH MODES — installed from the mode-independent entry point,
 *     ahead of the one advanced-mode branch, so no mode test stands between
 *     `apply` and the install.
 *  2. ADDITIVE ONLY — a list-slot contribution that declares no slot, provides
 *     no service, writes nothing to upstream's DOM, attaches no handler, and
 *     whose stylesheet cannot select an upstream element.
 *  3. THE OLD GATE STILL HOLDS EVERYTHING ELSE — relaxing it for this one
 *     surface must not have let the window frame, the theme presenter, the
 *     layout service or the brand sheet through with it.
 *
 * Runtime evidence is the primary proof and is recorded in the PR: launches in
 * BOTH modes, both themes, showing the badge in upstream's own turn-tail action
 * row and the `dsh-plugin-desktop/cost-surface` stylesheet served in each, with
 * the compatibility launch still running upstream's `ui-layout` root. These
 * fences keep that property from regressing between launches.
 */

const CLIENT_DIRECTORY = fileURLToPath(new URL('../src/client/', import.meta.url))

function clientSource(name: string): string {
  return readFileSync(join(CLIENT_DIRECTORY, name), 'utf8')
}

function hostSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')
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

/** The mode test that still guards desktop-composed presentation. */
const ADVANCED_BRANCH = "if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)"

/** The cost surface's own modules — the additive-only fences sweep all of them. */
const COST_MODULES = ['cost-surface.ts', 'TurnCostBadge.tsx', 'turn-cost.ts', 'cost-model.ts', 'cost-rates.ts']

const STYLES_OPENER = 'const COST_STYLES = `'

/**
 * The stylesheet text, read out of the module source.
 *
 * Comments are stripped first, which also removes the escaped backticks inside
 * the sheet's own explanatory comment — so the closing delimiter search cannot
 * stop early on one of those.
 * @returns the raw stylesheet body.
 */
function costStyleSheet(): string {
  const source = code(clientSource('cost-surface.ts'))
  const start = source.indexOf(STYLES_OPENER)
  expect(start).toBeGreaterThanOrEqual(0)
  const from = start + STYLES_OPENER.length
  const end = source.indexOf('`', from)
  expect(end).toBeGreaterThan(from)
  return source.slice(from, end)
}

/**
 * Every selector in a stylesheet, one per comma-separated compound.
 *
 * Deliberately naive about at-rules: a `@media`/`@supports` wrapper would parse
 * as a selector and fail the fence below rather than pass unexamined, because
 * wrapping these rules is exactly the kind of edit that deserves a fresh look at
 * where they land.
 * @param sheet - stylesheet text.
 * @returns the selector list.
 */
function selectorsOf(sheet: string): string[] {
  return sheet.split('}').flatMap((block) => {
    const brace = block.indexOf('{')
    if (brace < 0) return []
    return block.slice(0, brace).split(',').map(one => one.trim()).filter(one => one.length > 0)
  })
}

describe('the cost surface mounts in both shell modes', () => {
  it('is installed from the mode-independent entry point', () => {
    const entry = code(clientSource('index.ts'))
    // Declaration-anchored: the import specifier and the call, not a substring
    // that a comment mentioning the name would satisfy.
    expect(entry).toMatch(new RegExp(String.raw`import \{ ${INSTALL} \} from '\./cost-surface\.ts'`))
    expect(entry).toMatch(new RegExp(String.raw`\(\) => ${INSTALL}\(ctx\)`))
  })

  it('sits ahead of the only mode test in the entry point', () => {
    // `apply` runs in BOTH modes, so an install placed there reaches
    // compatibility mode only while no mode test precedes it. The entry point
    // carries exactly one such test — the advanced branch — and this asserts the
    // install lands before it. Re-nesting the install inside that branch, or
    // adding a second mode test above it, fails here.
    const entry = code(clientSource('index.ts'))
    expect(entry.match(/environment\.mode ===/g)).toHaveLength(1)
    expect(entry).toContain(ADVANCED_BRANCH)
    const install = entry.indexOf(`${INSTALL}(ctx)`)
    expect(install).toBeGreaterThanOrEqual(0)
    expect(install).toBeLessThan(entry.indexOf(ADVANCED_BRANCH))
  })

  it('is no longer reachable from the advanced shell', () => {
    // The surface moved out rather than being installed twice: two installs
    // would mean two `RateSource` reads and two stylesheets in advanced mode.
    const advanced = code(clientSource('advanced-shell.ts'))
    expect(advanced).not.toContain(INSTALL)
    expect(advanced).not.toContain('cost-surface')
  })

  it('is installed by exactly one caller across the whole client', () => {
    // Read the DIRECTORY, never a hand-kept list. The first version named seven
    // files while `src/client/` held twenty, so a caller added in any of the
    // other thirteen passed this fence in silence — the same class as PR #10's
    // single-workspace-list fix.
    const modules = clientModules()
    expect(modules.length).toBeGreaterThan(7)
    expect(modules).toContain('index.ts')
    const callers = modules.filter(name => new RegExp(String.raw`${INSTALL}\(ctx\)`).test(code(clientSource(name))))
    expect(callers).toEqual(['index.ts'])
  })
})

describe('the cost surface stays additive in compatibility mode', () => {
  it('contributes to an upstream list slot and declares none of its own', () => {
    // The difference between what compatibility mode admits and what it forbids
    // is this literal. `inject` + `register` with an entry `id` and an `order`
    // adds a row to a slot upstream declared; a registration carrying `children`
    // DECLARES a slot tree and owns it, which is what `advanced-shell.ts` does
    // for `root` and what must never appear here.
    const surface = code(clientSource('cost-surface.ts'))
    expect(surface).toContain("ctx.slots.inject(\n    'conversation.chat.assistant-actions',")
    expect(surface).toMatch(/id: COST_BADGE_ENTRY_ID,\n\s*order: COST_BADGE_ORDER,/)
    expect(surface).not.toContain('children:')
    // The comparison that gives the assertion above its meaning: the owning
    // shape exists in this codebase, and it lives behind the mode gate.
    expect(code(clientSource('advanced-shell.ts'))).toContain('children:')
  })

  it('provides no service and mutates no upstream DOM', () => {
    for (const name of COST_MODULES) {
      const source = code(clientSource(name))
      // Service provision and plugin registration are how a client plugin
      // changes what the rest of the app resolves — an alteration, not an
      // addition, and out of bounds in compatibility mode.
      expect(source, name).not.toMatch(/\bctx\.(provide|set|plugin|mixin)\(/)
      // The only DOM this surface owns is the elements it renders and the one
      // `<style>` it appends to the head. Reaching for `document.body`, the root
      // element, or a query into upstream's tree would be reaching into the
      // upstream default client.
      expect(source, name).not.toContain('document.body')
      expect(source, name).not.toContain('document.documentElement')
      expect(source, name).not.toMatch(/document\.(querySelector|getElement)/)
    }
    // Stated positively, so the sweep above cannot pass by the head write having
    // silently disappeared along with everything else.
    expect(code(clientSource('cost-surface.ts'))).toContain('document.head.appendChild(style)')
  })

  it('renders read-only: the badge attaches no event handler', () => {
    // A reporting surface reports. The disclosure toggle is `<details>`'s own
    // behaviour and needs no handler; anything that acted on the turn would be
    // altering the upstream client rather than adding to it.
    const badge = code(clientSource('TurnCostBadge.tsx'))
    expect(badge).not.toMatch(/\son[A-Z]\w*=/)
    expect(badge).not.toContain('dispatch')
  })

  it('has a stylesheet that cannot select an upstream element', () => {
    // THE COMPATIBILITY-PORTABILITY PROPERTY, and the reason this surface needs
    // no second sheet the way the brand does. `src/client/brand.ts` selects
    // upstream CSS-module classes scoped inside desktop wrappers, which do not
    // exist in the unwrapped compatibility document — hence the parallel sheet
    // in `src/shell-branding.ts`. Every selector here instead begins with a
    // class this surface renders itself, so one sheet is right in both modes.
    const sheet = costStyleSheet()
    const selectors = selectorsOf(sheet)
    expect(selectors.length).toBeGreaterThan(20)
    const foreign = selectors.filter(one => !one.startsWith('.dshDesktopCost'))
    expect(foreign).toEqual([])
  })

  it('takes both themes from upstream tokens rather than its own colours', () => {
    // What makes one sheet enough for two themes as well as two modes: every
    // colour resolves through `ui-theme`'s alias tokens, which are defined on
    // `body` in both modes. `brand.ts` by contrast hard-codes its two accents
    // and therefore needs a theme-keyed selector for each.
    const sheet = costStyleSheet()
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{3}/)
    expect(sheet.match(/var\(--dsw-alias-/g)?.length ?? 0).toBeGreaterThan(10)
  })

  it('keeps its stylesheet separate from the advanced-shell, brand and compat-brand sheets', () => {
    // Four desktop-owned sheets with four lifetimes. Folding this one into
    // `styles.ts` would tie a slot contribution's styles to the window frame's
    // — and would now be a mode bug too, because that sheet must stay out of
    // compatibility mode while this one must reach it. Nor is it duplicated into
    // the Host's compatibility index tap: one source paints these pixels.
    const surface = code(clientSource('cost-surface.ts'))
    expect(surface).toMatch(/style\.dataset\.pluginCss = 'dsh-plugin-desktop\/cost-surface'/)
    expect(code(clientSource('styles.ts'))).not.toContain('dshDesktopCost')
    expect(code(clientSource('brand.ts'))).not.toContain('dshDesktopCost')
    expect(code(hostSource('shell-branding.ts'))).not.toContain('dshDesktopCost')
  })

  it('marks an unpriced cell above the column rule that would otherwise win', () => {
    // Measured in the running app: `.dshDesktopCostUnknown` alone (0,1,0) loses
    // to `.dshDesktopCostTable tbody td:last-child` (0,2,2), so unpriced cells
    // rendered in the ordinary label colour and read as settled values. Unchanged
    // by the mode move: the same sheet now carries it into both shells.
    const surface = clientSource('cost-surface.ts')
    expect(surface).toContain('.dshDesktopCostTable tbody td.dshDesktopCostUnknown')
    expect(surface).not.toMatch(/^\.dshDesktopCostUnknown \{/m)
  })
})

describe('relaxing the gate for the cost surface did not open it', () => {
  it('keeps desktop-composed presentation behind the mode test', () => {
    // Standard 11: deleting a guard means auditing every path it defended. The
    // advanced-only gate defended five things, of which exactly one was ruled
    // additive. The other four REPLACE upstream presentation — the root slot
    // tree, the window-frame stylesheet (which carries the brand override), the
    // theme presenter's writes to `<body>`, and the layout service — and they
    // stay where they were.
    const entry = code(clientSource('index.ts'))
    for (const advancedOnly of [
      'installAdvancedStyles',
      'DesktopThemePresenter',
      'provideDesktopLayout',
      'AdvancedFrame',
      'dshDesktopMode',
    ]) {
      expect(entry, advancedOnly).not.toContain(advancedOnly)
    }
    const advanced = code(clientSource('advanced-shell.ts'))
    for (const advancedOnly of ['installAdvancedStyles', 'DesktopThemePresenter', 'provideDesktopLayout', 'AdvancedFrame']) {
      expect(advanced, advancedOnly).toContain(advancedOnly)
    }
    // And the shell still refuses to run in the wrong mode at all.
    expect(advanced).toContain("if (environment.mode !== 'advanced')")
  })
})
