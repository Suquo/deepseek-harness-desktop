/**
 * Parametria brand presentation for the desktop advanced shell.
 *
 * The product this fork carries is Parametria, and Parametria's own application brands itself with
 * a text wordmark rather than a logo: `PARAMETRIA`, bold, letter-spaced, in the app's accent. That
 * treatment is reproduced here wherever there is room for text. The two upstream sites that can
 * only carry a graphic — the 56px collapsed sidebar rail and the inline hero mark — take the
 * Parametria icon instead, from `./parametria-mark.ts`.
 *
 * The expanded sidebar lockup carries BOTH: the mark, then the wordmark. That is upstream's own
 * arrangement at that site rather than an addition to it — `BrandWordmark` is a single 182x24 svg
 * whose left 24 units are the whale and whose remainder is the letterforms, so replacing it with a
 * wordmark alone dropped a graphic the lockup had. It is restored beside the wordmark, not in place
 * of it.
 */

import { parametriaMarkDataUri } from './parametria-mark.ts'

/** Visible brand name, spelled as the Parametria application spells it. */
export const PARAMETRIA_WORDMARK = 'PARAMETRIA'

/**
 * The product's display name — the single spelling every user-visible surface states.
 *
 * Four surfaces carry it, reached from two different faces of this package: the served document's
 * `<title>` and the web manifest's `name`/`short_name` (`src/shell-branding.ts`), and the native
 * shell's `productName` and `windowTitle` (`src/index.ts`, which reach the tray tooltip, the tray's
 * "Open …" command, the Windows caption, and the accessible window title). They are one value, so
 * they are one constant; a rename that reached three of the four and not the fourth is the drift
 * this removes.
 *
 * This is display identity and nothing else. The application's ON-DISK identity is a separate value
 * on purpose: `main.ts` holds its own `PRODUCT_NAME` and passes it to `app.setName()` before the
 * first `app.getPath('userData')` read, so that string — not this one — names
 * `%APPDATA%\DSH Desktop`. The two look interchangeable and are not; moving the data identity is a
 * migration, not a rebrand, and is tracked separately.
 */
export const PARAMETRIA_PRODUCT_NAME = 'Parametria'

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
 * The lockup's replacement is a mark-then-wordmark pair, and its geometry is measured from the
 * upstream svg it supersedes rather than chosen. In `BrandWordmark` (`ui-primitives/src/
 * BrandWordmark.tsx`) the whale's clip box is 23.16 wide by 17.04 tall inside a 24-tall viewBox, and
 * the leftmost letterform path starts at x 26.96 — so upstream drew 17.0px of mark ink with a 3.7px
 * optical gap before the text. The Parametria mark's ink spans 74.6..425.4 of its 500-unit box
 * (70.2%), so a 24px box renders 16.8px of ink with 3.6px of its own padding to the right of it.
 * Both numbers land within a fifth of a pixel of upstream's, so a 24px box reproduces the mark
 * upstream drew here at the size it drew it.
 *
 * The pair is then set wider than upstream's on purpose. Reproducing upstream's 3.7px exactly reads
 * as too tight against these letterforms (owner call on the rendered lockup, 2026-08-20), so the
 * mark carries `margin-right: 8px` on top of the 3.6px its own artwork already supplies. 8px is not
 * an eyeballed number: it is the `gap` upstream sets on `.logoRow` itself, so the space inside the
 * lockup now matches the space between the lockup and the control beside it.
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
 * The mark's `::before` is exempt from that conditional, and its `content: ""` is what makes it so.
 * Name-from-content gathers the *text* of generated content, and an empty string has none, so this
 * box contributes nothing to the accessible name whether or not the label above it survives. The
 * emptiness is therefore load-bearing rather than idiomatic: giving the mark a textual `content`
 * would put a second brand string behind the same upstream-label dependency the wordmark already
 * rests on.
 *
 * Both generated boxes are qualified by `.hHd-Xa_wide`, upstream's own expanded-state class. The
 * rail renders no `.hHd-Xa_brand` element at all, so its icon-only resting state is reached by a
 * different rule entirely (`.hHd-Xa_railFish` below) and cannot pick either of these up.
 *
 * The hero headline replaces upstream's own text. It is removed with `display: none` rather than
 * hidden, so the superseded string leaves the accessibility tree instead of being announced
 * alongside the replacement, and the replacement claims the grid cell upstream assigned that text
 * (`grid-area: 1 / 2`) — every child of the headline grid is explicitly placed, so an auto-placed
 * replacement would only land correctly by accident.
 *
 * The wordmark takes NEUTRAL ink rather than Parametria's accent blue (owner call, 2026-08-20,
 * superseding the accent treatment this sheet shipped with). It gets there by riding the sidebar's
 * own text ink — `color: inherit` — which is the arrangement upstream's wordmark had, where the
 * letterforms were `currentColor` inside a `.hHd-Xa_brand` upstream declares `color: inherit`. So
 * the ink is dark on the light sidebar and light on the dark one without this sheet naming either
 * colour, and this sheet now pins no colour at all.
 *
 * Inheriting is what makes "neutral" a single declaration rather than a palette this sheet has to
 * maintain. Two literals keyed on `body[data-ds-dark-theme]` would also work — upstream's own theme
 * boot script sets that attribute on every index response, in both shell modes — but they would pin
 * two colours whose entire purpose is to match a palette upstream owns, and they would drift the
 * first time upstream retuned its label ink. Inheriting cannot drift from a palette it reads.
 *
 * The mark keeps its own brand blues in both themes, exactly as its source paints it; the accent
 * change is the wordmark TEXT only.
 * @returns the stylesheet text appended to the advanced-shell styles.
 */
export function parametriaBrandStyles(): string {
  const mark = `url("${parametriaMarkDataUri()}") no-repeat center / contain`
  const lockup = '.dshDesktopUpstreamSidebar .hHd-Xa_logoRow .hHd-Xa_brand'
  return `
${lockup} { display: inline-flex; align-items: center; }
${lockup} svg { display: none; }
${lockup}.hHd-Xa_wide::before { content: ""; flex: none; width: 24px; height: 24px; margin-right: 8px; background: ${mark}; }
${lockup}.hHd-Xa_wide::after { content: "${PARAMETRIA_WORDMARK}"; flex: none; font-size: 15px; font-weight: 700; line-height: 1; letter-spacing: 0.05em; white-space: nowrap; color: inherit; }
.dshDesktopUpstreamSidebar .hHd-Xa_railFish { background: ${mark}; }
.dshDesktopUpstreamSidebar .hHd-Xa_railFish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish { background: ${mark}; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_headline .pXSMma_headlineText { display: none; }
.dshDesktopConversationSurface .pXSMma_headline::after { content: "${HERO_HEADLINE_TEXT}"; grid-area: 1 / 2; }
`
}
