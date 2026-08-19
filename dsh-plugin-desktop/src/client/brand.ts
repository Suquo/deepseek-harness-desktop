/**
 * Suquo Systems brand lockup for the desktop advanced shell.
 *
 * Geometry is a verbatim copy of `assets/suquo-systems-logo-light.svg` (the Suquo Systems
 * wordmark asset), inlined because the client bundle ships as one self-contained file with no
 * asset loader. `tests/client-brand.spec.ts` re-derives both path commands from that file, so the
 * inline copy cannot drift from the committed asset.
 *
 * The mark is monochrome, so it is painted as a CSS mask over `currentColor` rather than as an
 * image: it inherits the resolved theme's foreground colour and therefore needs no dark variant.
 */

/** Visible brand name rendered beside the mark. */
export const SUQUO_BRAND_NAME = 'Suquo Systems'

/**
 * Empty-state headline this product shows in place of the upstream one.
 *
 * Upstream authors the headline as the `hero.headline` entry of the conversation package's own
 * locale namespace. The locale registry is single-occupant — `LocaleRuntime.register` throws on a
 * duplicate (namespace, locale) pair — so a desktop client plugin cannot re-register that
 * namespace, and the substitution happens in the stylesheet with the marks.
 */
export const HERO_HEADLINE_TEXT = 'Parametric Definitions'

/** Source view box of the Suquo Systems mark. */
export const SUQUO_MARK_VIEW_BOX = '0 0 493.36 256.34'

/** Path commands of the Suquo Systems mark, in asset order. */
export const SUQUO_MARK_PATHS: readonly string[] = [
  'M350.71,213.17h-4.85v-33.17c12.34-.61,14.97-2.22,18.81-4.65s6.27-6.67,7.89-12.54,1.82-14.97,1.82-26.9v-2.22c0-23.66-.4-39.44-3.84-47.13-3.03-7.08-8.09-11.12-16.38-12.14-3.03.4-5.87,1.01-8.49,2.43-3.64,1.62-6.27,5.06-8.29,10.11s-3.03,12.14-3.64,21.64c0,1.62-.4,12.94-.81,33.98-.4,21.03-1.62,36.41-3.64,46.11-2.02,9.71-5.87,17.39-11.73,23.46-5.87,6.07-14.56,8.9-26.29,8.9s-1.42,0-2.22,0h-11.73c51.17,48.74,132.07,46.72,180.82-4.45,48.74-51.17,46.72-132.07-4.65-180.82-49.35-46.92-127.02-46.92-176.17,0h15.17v36.2c-4.05,0-15.98,1.21-20.43,3.64s-7.89,7.08-9.51,13.96c-1.62,6.88-2.83,17.6-2.83,32.16v10.52c0,10.52.61,21.03,2.43,31.35,1.21,7.08,4.05,12.14,8.09,15.37,3.24,2.43,8.49,3.84,14.76,4.45,4.45-.4,8.09-1.01,10.52-2.43,3.64-1.82,6.07-5.26,7.69-10.32s2.43-12.74,2.63-23.06c.4-14.56.81-28.92,1.42-42.68.61-13.75,1.82-25.89,4.05-35.8,2.22-9.91,6.47-17.6,12.34-23.46,6.07-5.87,14.56-8.7,25.69-8.7s1.82,0,3.03,0h7.08c11.73,0,20.63,3.03,26.5,9.3s8.9,14.97,10.72,26.29c1.82,11.33,1.82,25.89,1.82,43.69v17.19c0,14.36.81,26.29,0,35.6s-1.82,17.6-4.45,24.88c-2.63,7.28-6.47,11.12-11.93,15.17-5.46,4.05-12.74,4.45-22.05,4.45h-10.52',
  'M142.58,43.07h4.85v33.17c-12.34.61-14.97,2.22-18.81,4.65s-6.27,6.67-7.89,12.54-1.82,14.97-1.82,26.9v2.22c0,23.66.4,39.44,3.84,47.13,3.03,7.08,8.09,11.12,16.38,12.14,3.03-.4,5.87-1.01,8.49-2.43,3.64-1.62,6.27-5.06,8.29-10.11,2.02-5.06,3.03-12.14,3.64-21.64,0-1.62.4-12.94.81-33.98s1.62-36.41,3.64-46.11,5.87-17.39,11.73-23.46c5.87-5.87,14.56-8.9,26.29-8.9s1.42,0,2.22,0h11.73C164.83-13.56,83.93-11.33,35.19,39.84c-48.74,51.17-46.52,132.07,4.65,180.82,49.35,46.92,127.02,46.72,176.17,0h-15.17v-36.2c4.05,0,15.98-1.21,20.43-3.64s7.89-7.08,9.51-13.96,2.63-17.6,2.63-32.16v-10.52c0-10.52-.61-21.03-2.43-31.55-1.21-7.08-4.05-12.14-8.09-15.37-3.24-2.43-8.49-3.84-14.76-4.45-4.45.4-8.09,1.01-10.52,2.43-3.64,1.82-6.07,5.26-7.69,10.32s-2.43,12.74-2.63,23.06c-.4,14.56-.81,28.92-1.42,42.68s-1.82,25.89-4.05,35.8c-2.22,9.91-6.47,17.6-12.34,23.46-5.87,5.87-14.56,8.7-25.69,8.7s-1.82,0-3.03,0h-7.08c-11.73,0-20.63-3.03-26.5-9.3s-8.9-14.97-10.72-26.29-1.82-25.89-1.82-43.69v-17.19c0-14.36-.81-26.29,0-35.6.61-9.3,1.82-17.6,4.45-24.88s6.47-11.12,11.93-15.17,12.74-4.45,22.05-4.45h10.52',
]

/**
 * Build the mask image for the Suquo Systems mark.
 *
 * Fill is intentionally omitted: a CSS mask reads alpha, and the default black fill is fully
 * opaque, so the painted colour comes from `background-color` at every use site.
 * @returns a `data:` URI usable as a CSS `mask-image`.
 */
export function suquoMarkDataUri(): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SUQUO_MARK_VIEW_BOX}">`
    + SUQUO_MARK_PATHS.map(commands => `<path d="${commands}"/>`).join('')
    + '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

/**
 * Upstream class names the brand override attaches to, by the package that ships them.
 *
 * These are content-derived module prefixes baked into the pinned upstream client bundles. They
 * are stable for a pinned upstream version and change when the submodule pin moves, so
 * `tests/client-brand.spec.ts` asserts every one of them still exists in the shipped bundle and
 * that this table and the stylesheet name exactly the same set.
 */
export const UPSTREAM_BRAND_CLASSES = {
  '@deepseek-ai/dsh-client-ui-sidebar': ['hHd-Xa_logoRow', 'hHd-Xa_brand', 'hHd-Xa_wide', 'hHd-Xa_railFish'],
  '@deepseek-ai/dsh-client-ui-conversation': [
    'pXSMma_fishHitbox',
    'pXSMma_fish',
    'pXSMma_headline',
    'pXSMma_headlineText',
    'pXSMma_previewBadge',
  ],
} as const satisfies Record<string, readonly string[]>

/**
 * Build the advanced-shell brand stylesheet.
 *
 * Three upstream sites render a DeepSeek mark: the sidebar brand lockup, the collapsed sidebar
 * rail, and the empty-state hero headline. Each upstream mark is an `aria-hidden` decorative
 * `<svg>`, so hiding it and repainting the box costs no accessible name; the sidebar lockup keeps
 * its own `aria-label`.
 *
 * The hero headline replaces upstream's own text. It is removed with `display: none` rather than
 * hidden, so the superseded string leaves the accessibility tree instead of being announced
 * alongside the replacement, and the three remaining grid items carry explicit `order` because
 * the generated content is last in DOM order.
 *
 * No rule sets `color`: mark, wordmark, and headline inherit the foreground upstream already
 * resolved for the surrounding surface, which is what keeps them legible under whichever theme is
 * active.
 * @returns the stylesheet text appended to the advanced-shell styles.
 */
export function suquoBrandStyles(): string {
  const mark = suquoMarkDataUri()
  const maskShorthand = (uri: string) => `-webkit-mask: url("${uri}") no-repeat center / contain; mask: url("${uri}") no-repeat center / contain;`
  return `
.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand { display: inline-flex; align-items: center; gap: 8px; }
.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand > svg { display: none; }
.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand::before { content: ""; flex: none; width: 40px; height: 21px; background-color: currentColor; ${maskShorthand(mark)} }
.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand.hHd-Xa_wide::after { content: "${SUQUO_BRAND_NAME}"; flex: none; font-size: 15px; font-weight: 600; line-height: 1; white-space: nowrap; letter-spacing: 0.01em; }
.dshDesktopUpstreamSidebar .hHd-Xa_railFish { background-color: currentColor; ${maskShorthand(mark)} }
.dshDesktopUpstreamSidebar .hHd-Xa_railFish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish { background-color: currentColor; ${maskShorthand(mark)} }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_headline .pXSMma_headlineText { display: none; }
.dshDesktopConversationSurface .pXSMma_headline .pXSMma_fishHitbox { order: 1; }
.dshDesktopConversationSurface .pXSMma_headline::after { content: "${HERO_HEADLINE_TEXT}"; order: 2; white-space: nowrap; }
.dshDesktopConversationSurface .pXSMma_headline .pXSMma_previewBadge { order: 3; }
`
}
