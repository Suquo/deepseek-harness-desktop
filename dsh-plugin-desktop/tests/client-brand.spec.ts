import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  HERO_HEADLINE_TEXT,
  PARAMETRIA_WORDMARK,
  UPSTREAM_BRAND_CLASSES,
  parametriaBrandStyles,
} from '../src/client/brand.ts'
import {
  PARAMETRIA_MARK_ELEMENTS,
  PARAMETRIA_MARK_VIEW_BOX,
  parametriaMarkDataUri,
} from '../src/client/parametria-mark.ts'
import { apply } from '../src/client/index.ts'
import { advancedStyleSheet } from '../src/client/styles.ts'
import { MARK_SOURCE_PATH, markElements } from '../scripts/brand-icon-sources.ts'

const require = createRequire(import.meta.url)
const ASSET_PATH = fileURLToPath(new URL('../assets/parametria-logo-icon.svg', import.meta.url))
const CONVERSATION = '@deepseek-ai/dsh-client-ui-conversation'

/** Selector classes owned by the desktop overlay itself rather than by a pinned upstream package. */
const OVERLAY_CLASS_PREFIX = 'dshDesktop'

/**
 * Pinned upstream facts a brand override's REASONING rests on, beyond the classes it selects.
 *
 * Both of today's entries are sidebar-lockup facts, and both are load-bearing in the same way a
 * class name is: the override still applies if they change, it just stops being correct.
 *
 * 1. The wordmark rides that button's `::after`, and both brand sheets justify leaving it unlabelled
 *    by upstream's own `aria-label`: the accessible name computation reaches `aria-label` (step 2C)
 *    before name-from-content (step 2F), so the generated wordmark text is never gathered and the
 *    button keeps announcing its "New session" action. Were that label dropped upstream, the
 *    `::after` would silently start naming the button.
 * 2. The wordmark pins no colour and inherits instead, which is only NEUTRAL INK because upstream
 *    declares `color: inherit` on `.brand` and lets the sidebar's themed label ink flow through.
 *    Were upstream to pin a colour there, the wordmark would silently take it in both themes.
 */
const UPSTREAM_BRAND_ANCHORS: Record<string, readonly RegExp[]> = {
  '@deepseek-ai/dsh-client-ui-sidebar': [
    /\.brand, \w+\.wide\),\s*"aria-label": t\("session\.new\.label"\)/,
    /\.hHd-Xa_brand\{[^}]*color:inherit/,
  ],
}

/**
 * Read one pinned upstream client bundle.
 * @param packageName - upstream package shipping a `./client` entry.
 * @returns the bundle text.
 */
function upstreamBundle(packageName: string): string {
  return readFileSync(require.resolve(`${packageName}/client`), 'utf8')
}

/**
 * Read every class token a stylesheet selects on.
 *
 * Only selector text is scanned: declaration bodies carry the mark's `data:` URI, whose host name
 * would otherwise read as class tokens.
 *
 * Tokenizing on bare braces is not string-aware, so a `content` value containing `{` or `}` would
 * silently split a rule in the wrong place and hand the drift guard a bogus selector set. The
 * interpolated-string fence below rejects braces for exactly that reason; it must stay in step with
 * this split.
 * @param css - stylesheet text.
 * @returns the class names appearing in selector position.
 */
function selectedClasses(css: string): Set<string> {
  const selectors = css.split('}').map(block => block.split('{')[0] ?? '')
  return new Set(selectors.flatMap(selector =>
    [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => match[1] as string)))
}

describe('Parametria brand presentation', () => {
  it('renders the wordmark where there is room for text and the mark where there is not', () => {
    const css = parametriaBrandStyles()
    const mark = `url("${parametriaMarkDataUri()}") no-repeat center / contain`

    // Sidebar brand lockup: the mark, then the wordmark, with upstream's own svg hidden. Upstream's
    // BrandWordmark is a single svg carrying whale AND letterforms, so the mark is not an addition
    // to this site — a wordmark alone is what dropped a graphic the lockup already had.
    expect(css).toMatch(/\.dshDesktopUpstreamSidebar \.hHd-Xa_logoRow \.hHd-Xa_brand svg \{ display: none; \}/)

    // rc.8 fills the lockup's name box from the `sidebar.brand.name` slot: an svg when something
    // provides it (covered by the rule above), a TEXT fallback — `DSH Local Build` plus a build
    // revision — when nothing does, which no svg rule reaches. This covers that branch.
    expect(css).toMatch(/\.dshDesktopUpstreamSidebar \.hHd-Xa_logoRow \.hHd-Xa_brand \.hHd-Xa_brandName \{ display: none; \}/)
    expect(css).toContain(`.hHd-Xa_brand.hHd-Xa_wide::before { content: ""; flex: none; width: 24px; height: 24px; margin-right: 8px; background: ${mark}; }`)
    expect(css).toContain(`.hHd-Xa_brand.hHd-Xa_wide::after { content: "${PARAMETRIA_WORDMARK}"; flex: none; font-size: 15px; font-weight: 700; line-height: 1; letter-spacing: 0.05em; white-space: nowrap; }`)

    // Collapsed sidebar rail and empty-state hero: the mark, painted over the hidden svg.
    // The rail paints the SVG, not the `.railMark` box. rc.7 put that class on the svg itself, so
    // painting it worked and `> *` hid the whale's paths. rc.8 made it a wrapping span fed by the
    // `sidebar.brand.mark` slot: the span is inline-flex with no intrinsic size (a background on it
    // paints nothing) and the slot's div carries an inline `display: contents` that outranks `> *`.
    // Both broken states were seen in the running app; reaching the svg restores rc.7's arrangement.
    expect(css).toContain(`.dshDesktopUpstreamSidebar .hHd-Xa_railMark svg { background: ${mark}; }`)
    expect(css).toMatch(/\.dshDesktopUpstreamSidebar \.hHd-Xa_railMark svg > \* \{ display: none; \}/)
    expect(css).not.toMatch(/\.hHd-Xa_railMark \{/)
    expect(css).toContain(`.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish { background: ${mark}; }`)
    expect(css).toMatch(/\.dshDesktopConversationSurface \.pXSMma_fishHitbox \.pXSMma_fish > \* \{ display: none; \}/)
  })

  it('confines the lockup boxes to the expanded state and gives the mark no text to announce', () => {
    const sidebar = UPSTREAM_BRAND_CLASSES['@deepseek-ai/dsh-client-ui-sidebar']
    const lockupRules = parametriaBrandStyles()
      .split('}')
      .map(block => (block.split('{')[0] ?? '').trim())
      .filter(selector => selector.includes(`.${sidebar.brand}`))

    // Exhaustive: the two rules that reshape the button, the one covering rc.8's slot-filled name
    // box, and the two that generate boxes in it. A third generated box appearing here without a
    // decision is exactly what this count catches.
    expect(lockupRules).toHaveLength(5)

    // Every generated box is qualified by upstream's expanded-state class. The rail renders no
    // `.brand` element at all, so this is defence in depth rather than the only thing keeping the
    // 56px rail icon-only — but it is the difference between "cannot happen" and "does not today".
    const generated = lockupRules.filter(selector => selector.includes('::'))
    expect(generated).toHaveLength(2)
    for (const selector of generated) {
      expect(selector).toContain(`.${sidebar.brand}.${sidebar.wide}`)
    }

    // The mark's box must stay textless. Name-from-content gathers generated TEXT, so an empty
    // `content` keeps this box out of the accessible name unconditionally — unlike the wordmark,
    // whose silence depends on upstream's `aria-label` continuing to pre-empt name-from-content.
    const markContent = new RegExp(`\\.${sidebar.brand}\\.${sidebar.wide}::before \\{ content: "([^"]*)"`)
      .exec(parametriaBrandStyles())
    expect(markContent?.[1]).toBe('')
  })

  it('puts the mark left of the wordmark by the only mechanism that decides it', () => {
    const sidebar = UPSTREAM_BRAND_CLASSES['@deepseek-ai/dsh-client-ui-sidebar']
    const css = parametriaBrandStyles()

    // What actually orders these two boxes is which pseudo-element each one is: `::before` boxes
    // precede the originating element's content and `::after` boxes follow it, whatever order the
    // RULES appear in. So the mark must be the `::before` and the wordmark the `::after` — asserting
    // that the ::before rule is written first in the sheet would prove nothing about the rendering.
    const markIsBefore = new RegExp(`\\.${sidebar.wide}::before \\{[^}]*background: url`).test(css)
    const wordIsAfter = new RegExp(`\\.${sidebar.wide}::after \\{ content: "${PARAMETRIA_WORDMARK}"`).test(css)
    expect([markIsBefore, wordIsAfter]).toEqual([true, true])

    // The one thing that could still flip them is a reversal on the flex container they share, so
    // the lockup must declare none. `flex-direction` and `direction` are the two that reverse a row;
    // `order` would let either box jump the other regardless of its pseudo-element.
    const lockupRule = /\.hHd-Xa_brand \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(lockupRule).toContain('display: inline-flex')
    for (const reversal of ['flex-direction', 'direction:', 'row-reverse']) {
      expect(css).not.toContain(reversal)
    }
    expect(css).not.toMatch(/(?:^|[\s;{])order:/)
  })

  it('declares no colour at all, so both themes come from the ink the sidebar already sets', () => {
    const css = parametriaBrandStyles()

    // Not one colour declaration in the sheet — not even `color: inherit`, which would be inert
    // since that is already the inherited value. A single literal would be theme-blind; a pair keyed
    // on the dark-theme attribute would work but would pin two values whose whole job is to match a
    // palette upstream owns and retunes. Declaring nothing cannot drift from the palette it reads.
    const declared = [...css.matchAll(/(?:^|[\s;{])color:\s*([^;}]+)/g)].map(match => match[1] as string)
    expect(declared).toEqual([])

    // And the sheet must not have grown a theme-conditional branch by another route.
    expect(css).not.toContain('data-ds-dark-theme')
    expect(css).not.toContain('prefers-color-scheme')
  })

  it('replaces the empty-state headline without leaving the upstream string readable', () => {
    const css = parametriaBrandStyles()

    // display:none, not a visual hide: the superseded string must leave the accessibility tree.
    expect(css).toMatch(/\.dshDesktopConversationSurface \.pXSMma_headline \.pXSMma_headlineText \{ display: none; \}/)
    expect(css).toContain(`.dshDesktopConversationSurface .pXSMma_headline::after { content: "${HERO_HEADLINE_TEXT}"; grid-area: 1 / 2; }`)

    // The replacement must not re-introduce nowrap: upstream's headline text wraps, and this one
    // sits in the same auto-sized column.
    expect(css).not.toMatch(/\.pXSMma_headline::after \{[^}]*white-space/)
  })

  it('still finds the headline grid it places the replacement into', () => {
    const bundle = upstreamBundle(CONVERSATION)

    // The replacement claims a cell by explicit placement, so both facts are load-bearing: the
    // headline is a grid, and upstream puts the text it supersedes at row 1, column 2.
    expect(bundle).toMatch(/\.pXSMma_headline\{[^}]*display:grid/)
    expect(bundle).toContain('.pXSMma_headlineText{grid-area:1/2}')
  })

  it('still finds the superseded upstream headline in the pinned conversation bundle', () => {
    const bundle = upstreamBundle(CONVERSATION)

    // Key-anchored and both locales: a pin that renames, retranslates, or drops this entry must
    // fail here rather than ship the replacement over changed copy.
    expect(bundle).toContain('"hero.headline": "Into the Unknown"')
    expect(bundle).toContain('"hero.headline": "探索未至之境"')
  })

  it('keeps the inlined mark identical to the committed asset', () => {
    // The element list is read through the same `markElements` the two native icon derivations
    // use, not through a second regex of this spec's own. Two independent readers of one file
    // agree until the artwork gains an element type only one of them matches — and then each guard
    // keeps passing against its own idea of the mark while the copies silently diverge. The path
    // is asserted to be the same file for the same reason.
    expect(MARK_SOURCE_PATH).toBe(ASSET_PATH)
    const asset = readFileSync(ASSET_PATH, 'utf8')
    const assetElements = markElements(asset)
    const assetViewBox = /viewBox="([^"]+)"/.exec(asset)?.[1]

    expect(assetElements).toHaveLength(26)
    expect(PARAMETRIA_MARK_ELEMENTS).toEqual(assetElements)
    expect(PARAMETRIA_MARK_VIEW_BOX).toBe(assetViewBox)

    // The mark is painted as an image, so its own fills must survive into the data URI: this is a
    // brand mark whose blues the source documents as deliberate in both themes.
    const markup = decodeURIComponent(parametriaMarkDataUri().replace('data:image/svg+xml,', ''))
    expect(markup).toContain(`viewBox="${assetViewBox}"`)
    for (const element of assetElements) expect(markup).toContain(element)
    expect(markup).toContain('fill="#1a8fc4"')
    expect(markup).toContain('fill="#0e6a94"')
  })

  it('keeps both interpolated strings safe to embed in a CSS content value', () => {
    // `"` and `\` would break out of the quoted content value in the browser. `{` and `}` would
    // survive the browser fine but mis-tokenize selectedClasses() above, which splits on bare
    // braces — the drift guard would then compare a bogus selector set and could pass while the
    // real overrides had drifted. Rejected here so the failure is loud and at the source string.
    for (const value of [PARAMETRIA_WORDMARK, HERO_HEADLINE_TEXT]) {
      for (const forbidden of ['"', '\\', '{', '}']) {
        expect(value).not.toContain(forbidden)
      }
    }
  })

  it.each(Object.entries(UPSTREAM_BRAND_CLASSES))(
    'still finds every class it overrides in the pinned %s bundle',
    (packageName, classes) => {
      const bundle = upstreamBundle(packageName)

      // Anchored on the module export mapping, not the bare class: several of these names are
      // prefixes of one another, so a substring match could not detect a rename.
      for (const [local, emitted] of Object.entries(classes)) {
        expect(bundle).toContain(`"${local}": "${emitted}"`)
      }
      for (const anchor of UPSTREAM_BRAND_ANCHORS[packageName] ?? []) expect(bundle).toMatch(anchor)
    },
  )

  it('names exactly the upstream classes the pin was verified against', () => {
    const declared = new Set(Object.values(UPSTREAM_BRAND_CLASSES).flatMap(classes => Object.values(classes)))
    const selected = new Set([...selectedClasses(parametriaBrandStyles())]
      .filter(className => !className.startsWith(OVERLAY_CLASS_PREFIX)))

    // Two directions at once: no override reaches a class the pin was never verified against, and
    // no verified class goes unused.
    expect(selected).toEqual(declared)
  })

  it('composes the brand override into the advanced sheet once, and overrides upstream nowhere else', () => {
    const sheet = advancedStyleSheet()
    const brand = parametriaBrandStyles()

    // Exactly one occurrence: absent fails (length 1), a second composition point fails (length 3).
    expect(sheet.split(brand)).toHaveLength(2)

    // The rest of the sheet must reach no upstream brand class on its own. The two-direction class
    // guard above runs on parametriaBrandStyles() alone, so without this an override hand-written
    // into the base styles would escape the pin-drift guards entirely.
    const base = sheet.replace(brand, '')
    for (const emitted of Object.values(UPSTREAM_BRAND_CLASSES).flatMap(classes => Object.values(classes))) {
      expect(base).not.toContain(emitted)
    }
  })

  it('leaves compatibility mode running the upstream client without the BRAND override', () => {
    vi.stubGlobal('window', { location: { search: '?dsh-desktop-mode=compatibility&dsh-desktop-platform=darwin' } })
    const labels: string[] = []
    const ctx = {
      effect: (_run: () => unknown, label: string) => { labels.push(label) },
      workspaces: { create: vi.fn(), startSession: vi.fn() },
      loader: {},
    } as unknown as ClientContext

    try {
      apply(ctx)

      // Exhaustive, so a newly added advanced effect cannot slip into the compatibility path and
      // so an apply() that stopped running at all cannot pass by registering nothing.
      //
      // The cost surface joined this list under the owner's issue-#36 ruling, and it belongs here
      // rather than being excused. This guard's subject is the BRAND override —
      // `parametriaBrandStyles()` reaching the compatibility document from the client rather than
      // from `src/shell-branding.ts`, which would paint those pixels twice — and what the list
      // still forbids is any effect that REPLACES upstream presentation. The four that do (the
      // advanced styles, the theme presenter, the layout service, the root slot) remain absent
      // because `apply` reaches them only through its advanced branch.
      //
      // `tests/cost-surface-gating.spec.ts` owns the rest of that claim: the additive-only fences
      // for the entry that was added, and the advanced-mode counterpart to this snapshot, which it
      // derives from this same list rather than copying it.
      expect(labels).toEqual([
        'dsh-plugin-desktop: renderer boot health report',
        'dsh-plugin-desktop: workspace folder drop',
        'dsh-plugin-desktop: turn cost surface',
      ])
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
