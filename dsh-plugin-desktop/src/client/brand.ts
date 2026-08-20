/**
 * Parametria brand presentation for the desktop advanced shell.
 *
 * The product this fork carries is Parametria, and Parametria's own application brands itself with
 * a text wordmark rather than a logo: `PARAMETRIA`, bold, letter-spaced, in the app's accent. That
 * treatment is reproduced here wherever there is room for text. The two upstream sites that can
 * only carry a graphic — the 56px collapsed sidebar rail and the inline hero mark — take the
 * Parametria icon instead, from `./parametria-mark.ts`.
 */

import { parametriaMarkDataUri } from './parametria-mark.ts'

/** Visible brand name, spelled as the Parametria application spells it. */
export const PARAMETRIA_WORDMARK = 'PARAMETRIA'

/** Wordmark accent under a light theme. */
export const PARAMETRIA_ACCENT_LIGHT = '#0288d1'

/** Wordmark accent under a dark theme. */
export const PARAMETRIA_ACCENT_DARK = '#4fc3f7'

/**
 * Empty-state headline this product shows in place of the upstream one.
 *
 * Upstream authors the headline as the `hero.headline` entry of the conversation package's own
 * locale namespace. The locale registry is single-occupant — `LocaleRuntime.register` throws on a
 * duplicate (namespace, locale) pair — so a desktop client plugin cannot re-register that
 * namespace, and the substitution happens in the stylesheet with the marks.
 *
 * A stylesheet cannot read the active locale, so this one string stands in every locale: under
 * `zh` it replaces upstream's own `探索未至之境` with English. That is a deliberate consequence of
 * the mechanism, not an oversight; a localized headline needs a seam that does not exist yet.
 */
export const HERO_HEADLINE_TEXT = 'Parametric Definitions'

/**
 * Upstream classes the brand override attaches to: CSS-module local name to emitted class, by the
 * package that ships them.
 *
 * The emitted names are content-derived per-module prefixes baked into the pinned upstream client
 * bundles. They are stable for a pinned upstream version and change when the submodule pin moves,
 * so `tests/client-brand.spec.ts` asserts each pair against the bundle's own module export table
 * — matching the whole mapping, not a bare substring, because several of these names are prefixes
 * of one another.
 */
export const UPSTREAM_BRAND_CLASSES = {
  '@deepseek-ai/dsh-client-ui-sidebar': {
    logoRow: 'hHd-Xa_logoRow',
    brand: 'hHd-Xa_brand',
    wide: 'hHd-Xa_wide',
    railFish: 'hHd-Xa_railFish',
  },
  '@deepseek-ai/dsh-client-ui-conversation': {
    fishHitbox: 'pXSMma_fishHitbox',
    fish: 'pXSMma_fish',
    headline: 'pXSMma_headline',
    headlineText: 'pXSMma_headlineText',
  },
} as const satisfies Record<string, Readonly<Record<string, string>>>

/**
 * Build the advanced-shell brand stylesheet.
 *
 * Three upstream sites render a DeepSeek mark: the sidebar brand lockup, the collapsed sidebar
 * rail, and the empty-state hero headline. Each upstream mark is an `aria-hidden` decorative
 * `<svg>`, so hiding it and repainting the box costs no accessible name.
 *
 * The wordmark that takes the lockup's place is decorative too, and deliberately so. The lockup is
 * a `<button>` carrying `aria-label={t('session.new.label')}` (`ui-sidebar/src/client/
 * SidebarRoot.tsx:137`), so its accessible name is the "New session" action it performs, not a
 * brand name — and it stays that way. The reason is precedence, not exclusion: the accessible name
 * computation reaches `aria-label` (accname step 2C) before it would ever gather name from content
 * (step 2F), so content is not consulted at all. Generated `::before`/`::after` text *is* part of
 * name-from-content, so were that label ever dropped upstream, this `::after` would start
 * announcing the wordmark. The button therefore keeps announcing its action exactly as before —
 * the same arrangement upstream already had, where its own wordmark was an `aria-hidden` image
 * inside that button — conditional on upstream's label continuing to exist.
 *
 * The hero headline replaces upstream's own text. It is removed with `display: none` rather than
 * hidden, so the superseded string leaves the accessibility tree instead of being announced
 * alongside the replacement, and the replacement claims the grid cell upstream assigned that text
 * (`grid-area: 1 / 2`) — every child of the headline grid is explicitly placed, so an auto-placed
 * replacement would only land correctly by accident.
 *
 * The wordmark is the only themed value: it carries the accent Parametria uses for the theme in
 * play, keyed off the dark-theme attribute the desktop theme presenter sets on `<body>`. The mark
 * keeps its own brand blues in both themes, exactly as its source paints it.
 * @returns the stylesheet text appended to the advanced-shell styles.
 */
export function parametriaBrandStyles(): string {
  const mark = `url("${parametriaMarkDataUri()}") no-repeat center / contain`
  const lockup = '.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand'
  return `
${lockup} { display: inline-flex; align-items: center; }
${lockup} svg { display: none; }
${lockup}.hHd-Xa_wide::after { content: "${PARAMETRIA_WORDMARK}"; flex: none; font-size: 15px; font-weight: 700; line-height: 1; letter-spacing: 0.05em; white-space: nowrap; color: ${PARAMETRIA_ACCENT_LIGHT}; }
body[data-ds-dark-theme] ${lockup}.hHd-Xa_wide::after { color: ${PARAMETRIA_ACCENT_DARK}; }
.dshDesktopUpstreamSidebar .hHd-Xa_railFish { background: ${mark}; }
.dshDesktopUpstreamSidebar .hHd-Xa_railFish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish { background: ${mark}; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_headline .pXSMma_headlineText { display: none; }
.dshDesktopConversationSurface .pXSMma_headline::after { content: "${HERO_HEADLINE_TEXT}"; grid-area: 1 / 2; }
`
}
