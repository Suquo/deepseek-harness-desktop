import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The cost surface mounts in BOTH shell modes, and stays purely additive in the
 * compatibility one.
 *
 * THE CONTRACT CHANGED. The first version of this file fenced the opposite rule
 * — the surface was advanced-only — because AGENTS.md then admitted no desktop
 * override into compatibility mode at all. The owner's 2026-08-20 ruling amended
 * that line; `src/client/cost-surface.ts` carries the reasoning, and AGENTS.md
 * carries the rule. What matters here is the consequence: the gate did not
 * disappear, it MOVED — from "which mode" to "what kind of change".
 *
 * These fences hold the new line in three parts:
 *
 *  1. MOUNTS IN BOTH MODES — installed from the mode-independent entry point,
 *     ahead of the one advanced-mode branch, so no mode test stands between
 *     `apply` and the install.
 *  2. ADDITIVE ONLY — a list-slot contribution that declares no slot, provides
 *     no service, writes nothing to upstream's DOM, and attaches only the one
 *     desktop-owned reconciliation handler whose stylesheet cannot select an upstream element.
 *  3. THE OLD GATE STILL HOLDS EVERYTHING ELSE — relaxing it for this one
 *     surface must not have let the window frame, the theme presenter, the
 *     layout service or the brand sheet through with it, and the boundary is
 *     snapshotted in both directions rather than only on the side it left.
 *
 * Runtime evidence remains the primary proof, and no fence here substitutes for
 * it: what was measured in a running compatibility launch — the badge inside
 * upstream's own turn-tail action row, the `dsh-plugin-desktop/cost-surface`
 * stylesheet served, and upstream's `ui-layout` root still composing — is
 * recorded in the pull request that lands this change. These fences keep those
 * properties from regressing between launches.
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
const COST_MODULES = ['billed-costs.ts', 'cost-surface.ts', 'TurnCostBadge.tsx', 'turn-cost.ts', 'cost-model.ts', 'cost-rates.ts']

const STYLES_OPENER = 'const COST_STYLES = `'

/** The sheet's final rule — read back so a truncated read cannot shrink the sample silently. */
const LAST_RULE = '.dshDesktopCostProvenance {'

/**
 * Declarations whose value is a colour, by exact property name.
 *
 * Exact rather than prefixed on purpose: `border-collapse` and `border-radius`
 * start with `border` and carry no colour, so a prefix match would demand a
 * token from a declaration that has no business holding one.
 */
const COLOUR_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'outline',
])

/**
 * The stylesheet text, read out of the module source.
 *
 * Comments are stripped first, which removes the escaped backticks inside the
 * sheet's own explanatory comment. The closing delimiter is then matched as a
 * backtick ALONE ON ITS LINE rather than as the next backtick anywhere, which is
 * the difference between a fence and a fence-shaped hazard: an escaped backtick
 * arriving inside real CSS one day — a `content:` string, say — would end a
 * first-backtick search early, and every fence below would then pass over a
 * surviving prefix while the truncated tail went unexamined. The last rule is
 * asserted present as the second half of that guarantee, so a truncation that
 * somehow got past the delimiter still reddens instead of shrinking the sample.
 * @returns the raw stylesheet body.
 */
function costStyleSheet(): string {
  const source = code(clientSource('cost-surface.ts'))
  const start = source.indexOf(STYLES_OPENER)
  expect(start).toBeGreaterThanOrEqual(0)
  const from = start + STYLES_OPENER.length
  const end = source.indexOf('\n`', from)
  expect(end).toBeGreaterThan(from)
  const sheet = source.slice(from, end)
  expect(sheet).toContain(LAST_RULE)
  return sheet
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

/**
 * Every colour-bearing declaration in a stylesheet, as property/value pairs.
 * @param sheet - stylesheet text.
 * @returns the colour declarations.
 */
function colourDeclarationsOf(sheet: string): { property: string; value: string }[] {
  return sheet.split('}').flatMap((block) => {
    const brace = block.indexOf('{')
    if (brace < 0) return []
    return block.slice(brace + 1).split(';').flatMap((declaration) => {
      const colon = declaration.indexOf(':')
      if (colon < 0) return []
      const property = declaration.slice(0, colon).trim()
      if (!COLOUR_PROPERTIES.has(property)) return []
      return [{ property, value: declaration.slice(colon + 1).trim() }]
    })
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
    expect(surface).toMatch(/ctx\.slots\.inject\(\s*'conversation\.chat\.assistant-actions',/)
    expect(surface).toMatch(/id: COST_BADGE_ENTRY_ID,\s*order: COST_BADGE_ORDER,/)
    // Scoped to the registration literal rather than swept over the file: an
    // unrelated `children:` elsewhere in the module is not this claim's subject,
    // and a fence that a stray prop could trip is a fence that gets edited away.
    const registration = /ctx\.slots\.register\(\{[\s\S]*?\}, TurnCostBadge\)/.exec(surface)?.[0]
    expect(registration).toBeDefined()
    expect(registration).not.toContain('children:')
    // The comparison that gives the assertion above its meaning: the owning
    // shape exists in this codebase, and it lives behind the mode gate.
    expect(code(clientSource('advanced-shell.ts'))).toMatch(/ctx\.slots\.register\(\{\s*name: 'root',\s*children: \{/)
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

  it('permits exactly the declared desktop billed-cost control handler', () => {
    // RM ruling #30: this exact desktop-owned control is the sole handler the
    // additive surface may carry. Anchor it to the rendered button declaration,
    // its class, and its whole-turn Host request. Any second handler — including
    // a render-side reconcile call moved elsewhere — fails the exhaustive sweep.
    const badge = code(clientSource('TurnCostBadge.tsx'))
    const controls = [...badge.matchAll(/<button[\s\S]*?<\/button>/g)].map(match => match[0])
    expect(controls).toHaveLength(1)
    expect(controls[0]).toContain('className="dshDesktopCostReconcileControl"')
    expect(controls[0]).toContain("onClick={() => { void billedCostSource.reconcile(sessionId, cost.turn) }}")
    const handlers = COST_MODULES.flatMap(name => (
      [...code(clientSource(name)).matchAll(/\s(on[A-Z]\w*)=/g)].map(match => ({ name, handler: match[1] }))
    ))
    expect(handlers).toEqual([{ name: 'TurnCostBadge.tsx', handler: 'onClick' }])
    expect(badge.match(/billedCostSource\.reconcile\(/g)).toHaveLength(1)
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
    //
    // Asserted per DECLARATION, not by banning hex literals. "No `#rgb`" was the
    // first shape of this fence and it was too weak to carry the sentence above
    // it: `red`, `rgb(...)` and `hsl(...)` all sail through a hex ban, and any of
    // them would be a colour that is right in one theme and wrong in the other.
    const sheet = costStyleSheet()
    const declarations = colourDeclarationsOf(sheet)
    expect(declarations.length).toBeGreaterThan(10)
    const untokened = declarations.filter(one => !one.value.includes('var(--dsw-alias-'))
    expect(untokened).toEqual([])
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
    // Measured in the running app in BOTH modes: `.dshDesktopCostUnknown` alone
    // (0,1,0) loses to `.dshDesktopCostTable tbody td:last-child` (0,2,2), so
    // unpriced cells rendered in the ordinary label colour and read as settled
    // values. Unchanged by the mode move: the same sheet carries it into both.
    //
    // Read from the PARSED SHEET, not the raw file. The raw file also contains
    // the comment that explains this rule, and that comment names both selectors
    // — so a fence read off the raw text would be satisfied by the prose after
    // the rule itself had been deleted, which is the exact failure `code()`
    // exists to prevent.
    const sheet = costStyleSheet()
    expect(selectorsOf(sheet)).toContain('.dshDesktopCostTable tbody td.dshDesktopCostUnknown')
    expect(selectorsOf(sheet)).not.toContain('.dshDesktopCostUnknown')
  })
})

describe('relaxing the gate for the cost surface did not open it', () => {
  // The runtime half of this claim — an exhaustive both-directions snapshot of
  // which effects each mode registers — is in `client-cost-surface-mode.spec.ts`,
  // which runs `apply` and therefore belongs to the client TypeScript project.
  // This file stays pure source analysis and imports no client module.

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
