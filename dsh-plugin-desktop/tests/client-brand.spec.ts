import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  HERO_HEADLINE_TEXT,
  SUQUO_BRAND_NAME,
  SUQUO_MARK_PATHS,
  SUQUO_MARK_VIEW_BOX,
  UPSTREAM_BRAND_CLASSES,
  suquoBrandStyles,
  suquoMarkDataUri,
} from '../src/client/brand.ts'
import { apply } from '../src/client/index.ts'
import { advancedStyleSheet } from '../src/client/styles.ts'

const require = createRequire(import.meta.url)
const ASSET_PATH = fileURLToPath(new URL('../../assets/suquo-systems-logo-light.svg', import.meta.url))

/** Selector classes owned by the desktop overlay itself rather than by a pinned upstream package. */
const OVERLAY_CLASS_PREFIX = 'dshDesktop'

/**
 * Read every class token a stylesheet selects on.
 *
 * Only selector text is scanned: declaration bodies carry the mark's `data:` URI, whose host name
 * would otherwise read as class tokens.
 * @param css - stylesheet text.
 * @returns the class names appearing in selector position.
 */
function selectedClasses(css: string): Set<string> {
  const selectors = css.split('}').map(block => block.split('{')[0] ?? '')
  return new Set(selectors.flatMap(selector =>
    [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => match[1] as string)))
}

describe('Suquo Systems brand lockup', () => {
  it('replaces the upstream mark at all three of its render sites', () => {
    const css = suquoBrandStyles()
    const mark = `url("${suquoMarkDataUri()}")`

    // Sidebar brand lockup: mark plus the wordmark, upstream's own svg hidden.
    expect(css).toMatch(/\.dshDesktopUpstreamSidebar \.hHd-Xa_logoRow \.hHd-Xa_brand > svg \{ display: none; \}/)
    expect(css).toContain(`.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand::before { content: ""; flex: none; width: 40px; height: 21px; background-color: currentColor; -webkit-mask: ${mark} no-repeat center / contain; mask: ${mark} no-repeat center / contain; }`)
    expect(css).toContain(`.hHd-Xa_brand.hHd-Xa_wide::after { content: "${SUQUO_BRAND_NAME}";`)

    // Collapsed sidebar rail and empty-state hero: mark only, repainted in place.
    expect(css).toMatch(/\.dshDesktopUpstreamSidebar \.hHd-Xa_railFish \{[^}]*background-color: currentColor;/)
    expect(css).toMatch(/\.dshDesktopUpstreamSidebar \.hHd-Xa_railFish > \* \{ display: none; \}/)
    expect(css).toMatch(/\.dshDesktopConversationSurface \.pXSMma_fishHitbox \.pXSMma_fish \{[^}]*background-color: currentColor;/)
    expect(css).toMatch(/\.dshDesktopConversationSurface \.pXSMma_fishHitbox \.pXSMma_fish > \* \{ display: none; \}/)

    // Every site paints through currentColor, which is what makes one asset serve both themes.
    const maskRules = [...css.matchAll(/\{[^}]*mask: url\([^}]*\}/g)]
    expect(maskRules).toHaveLength(3)
    for (const [rule] of maskRules) expect(rule).toContain('background-color: currentColor')

    // Nothing may pin a foreground colour: both themes are served by inheriting upstream's.
    expect(css).not.toMatch(/[^-]color:(?! currentColor)/)
  })

  it('replaces the empty-state headline without leaving the upstream string readable', () => {
    const css = suquoBrandStyles()

    // display:none, not a visual hide: the superseded string must leave the accessibility tree.
    expect(css).toMatch(/\.dshDesktopConversationSurface \.pXSMma_headline \.pXSMma_headlineText \{ display: none; \}/)
    expect(css).toContain(`.dshDesktopConversationSurface .pXSMma_headline::after { content: "${HERO_HEADLINE_TEXT}"; order: 2; white-space: nowrap; }`)

    // Generated content is last in DOM order, so every remaining grid item is ordered explicitly.
    expect(css).toMatch(/\.pXSMma_headline \.pXSMma_fishHitbox \{ order: 1; \}/)
    expect(css).toMatch(/\.pXSMma_headline \.pXSMma_previewBadge \{ order: 3; \}/)
  })

  it('still finds the superseded upstream headline in the pinned conversation bundle', () => {
    const bundle = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')

    // A pin that renames, retranslates, or drops this entry must fail here rather than ship the
    // replacement over changed copy.
    expect(bundle).toContain('Into the Unknown')
    expect(bundle).not.toContain(HERO_HEADLINE_TEXT)
  })

  it('keeps the inlined mark identical to the committed asset', () => {
    const asset = readFileSync(ASSET_PATH, 'utf8')
    const assetPaths = [...asset.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(match => match[1])
    const assetViewBox = /viewBox="([^"]+)"/.exec(asset)?.[1]

    expect(assetPaths).toHaveLength(2)
    expect(SUQUO_MARK_PATHS).toEqual(assetPaths)
    expect(SUQUO_MARK_VIEW_BOX).toBe(assetViewBox)

    // A mask reads alpha only: shipping a fill would silently pin the mark to one theme.
    const markup = decodeURIComponent(suquoMarkDataUri().replace('data:image/svg+xml,', ''))
    expect(markup).toContain(`viewBox="${assetViewBox}"`)
    for (const commands of assetPaths) expect(markup).toContain(`<path d="${commands}"/>`)
    expect(markup).not.toContain('fill')
    expect(markup).not.toContain('#686867')
  })

  it.each(Object.entries(UPSTREAM_BRAND_CLASSES))(
    'still finds every class it overrides in the pinned %s bundle',
    (packageName, classes) => {
      const bundle = readFileSync(require.resolve(`${packageName}/client`), 'utf8')
      for (const className of classes) expect(bundle).toContain(className)
    },
  )

  it('names exactly the upstream classes the pin was verified against', () => {
    const declared = new Set(Object.values(UPSTREAM_BRAND_CLASSES).flat())
    const selected = [...selectedClasses(suquoBrandStyles())]
      .filter(className => !className.startsWith(OVERLAY_CLASS_PREFIX))

    // Two directions: no override reaches an unverified class, and no verified class goes unused.
    expect(new Set(selected)).toEqual(declared)
    expect([...declared].every(className => selected.includes(className))).toBe(true)
  })

  it('ships the brand override only inside the advanced-shell stylesheet', () => {
    expect(advancedStyleSheet()).toContain(suquoBrandStyles())
    expect(advancedStyleSheet().indexOf(SUQUO_BRAND_NAME))
      .toBeGreaterThan(advancedStyleSheet().indexOf('.dshDesktopResizeHandle'))
  })

  it('leaves compatibility mode running the upstream client without the override', () => {
    vi.stubGlobal('window', { location: { search: '?dsh-desktop-mode=compatibility&dsh-desktop-platform=darwin' } })
    const labels: string[] = []
    const ctx = {
      effect: (_run: () => unknown, label: string) => { labels.push(label) },
      workspaces: { create: vi.fn(), startSession: vi.fn() },
      loader: {},
    } as unknown as ClientContext

    try {
      apply(ctx)
      expect(labels).not.toContain('desktop: advanced shell styles')
      expect(labels).not.toContain('desktop: advanced root slot')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
