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
 * bundles, so `tests/client-brand.spec.ts` asserts each pair against the bundle's own module export
 * table — matching the whole mapping, not a bare substring, because several of these names are
 * prefixes of one another.
 *
 * What actually moves them is worth stating precisely, because the rc.7 -> rc.8 bump disproved the
 * obvious guess. The PREFIX did not change across that bump — `hHd-Xa_` and `pXSMma_` survived it
 * unchanged — so a pin move does not by itself invalidate these pairs. What invalidated one was
 * upstream RENAMING a class: rc.8 restructured the sidebar brand region, retiring `railFish` in
 * favour of `railMark` and giving the lockup real child elements (`brandIdentity > brandMark +
 * brandName`) where rc.7 had a bare inline svg. The mapping assertion catches exactly that, which is
 * why it is anchored on the local-to-emitted pair rather than on the prefix.
 */
export const UPSTREAM_BRAND_CLASSES = {
  '@deepseek-ai/dsh-client-ui-sidebar': {
    logoRow: 'hHd-Xa_logoRow',
    brand: 'hHd-Xa_brand',
    wide: 'hHd-Xa_wide',
    brandName: 'hHd-Xa_brandName',
    railMark: 'hHd-Xa_railMark',
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
 * The lockup's replacement is a mark-then-wordmark pair, and its box is sized from the upstream svg
 * it supersedes rather than chosen. `BrandWordmark` (`ui-primitives/src/BrandWordmark.tsx`) renders
 * at `size = 24`, so its units are px: the whale's clip box is 23.16 wide by 17.04 tall, and the
 * leftmost letterform path starts at x 26.96 — upstream's mark ink is therefore 17.04px TALL, with
 * a 3.66px gap to the text. The Parametria mark's solid ink spans 74.6..425.4 on both axes of its
 * 500-unit box (70.2%), so a 24px box renders it 16.8px square: within a fifth of a pixel of
 * upstream's mark HEIGHT, which is the dimension that sets optical size in a horizontal lockup.
 *
 * Width is deliberately not matched and could not be: the whale is a wide shape and this mark is
 * square, so at equal height the replacement is about 6.4px narrower. Matching width instead would
 * have made it 23px tall and visibly larger than the ink it replaces.
 *
 * The 70.2% figure is the SOLID ink. The source's hairline construction lines run wider
 * (30.75..469.25) and its corner circles reach 430.66 — see `./parametria-mark.ts`, which keeps them
 * because they do not resolve at these sizes. The padding quoted here is padding-to-solid-ink, which
 * is what the eye reads, not the artwork's outermost extent.
 *
 * The pair is then set wider than upstream's on purpose: reproducing upstream's 3.66px exactly reads
 * as too tight against these letterforms (owner call on the rendered lockup, 2026-08-20). The mark
 * carries `margin-right: 8px`, which is not an eyeballed number — it is the same `gap` upstream
 * declares on `.logoRow` itself, so the declared space inside the lockup equals the declared space
 * between the lockup and the control beside it. Optically the pair then reads about 11.6px apart,
 * because the mark's own 3.6px of padding sits inside that margin.
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
 * different rule entirely (`.hHd-Xa_railMark` below) and cannot pick either of these up.
 *
 * The rail rules below paint the SVG rather than the `.hHd-Xa_railMark` box, and that indirection is
 * load-bearing. At rc.7 `railFish` was a class upstream put ON the svg itself
 * (`<FishLogo className={railFish} size={24}/>`), so painting `.railFish` painted a box the svg's own
 * 24px geometry sized, and `> *` hid the whale's `<path>` children inside it. rc.8 turned that class
 * into a wrapping `<span>` whose content comes from the `sidebar.brand.mark` slot, which interposes
 * `<div data-slot… style="display: contents">`. Two things break at once: the span is `inline-flex`
 * with no intrinsic size, so a background on it has nothing to paint, and `> *` now names that div,
 * whose INLINE `display: contents` outranks any rule this sheet can write.
 *
 * Both failure modes were observed in the running app rather than deduced. Keeping `> *` left
 * upstream's whale drawn over our mark (svg visible, 24x17.66, opacity 1); widening it to `*` hid the
 * whale but collapsed the span to 0x0 and painted nothing at all. Reaching the svg restores rc.7's
 * arrangement exactly — our background on the box upstream's own svg sizes, its paths hidden inside
 * it. Every headless gate was green through both broken states, because no fence in this repo can
 * see a computed style.
 *
 * `.hHd-Xa_brandName` is hidden for the same reason the svg above it is, and it needs its own rule
 * because rc.8 gave that box a second, non-svg form. At rc.7 the lockup's whole content was one
 * decorative `<svg>`, so `svg { display: none }` hid the brand outright. rc.8 splits the lockup into
 * `brandIdentity > brandMark + brandName` and fills `brandName` from the `sidebar.brand.name` SLOT:
 * when something provides that slot it renders upstream's wordmark svg — already covered by the rule
 * above, and that is what a running advanced shell shows today — but when nothing does, the fallback
 * is TEXT (`DSH Local Build` plus a build revision), which no svg rule reaches. That fallback is
 * live, not hypothetical: this build's own served `<title>` is `DSH Local Build`.
 *
 * So this rule is coverage for the fallback branch rather than a fix for a double wordmark anyone
 * has seen. Either way it restores the rc.7 rendering — one brand, ours — instead of changing what
 * this sheet does.
 *
 * The hero headline replaces upstream's own text. It is removed with `display: none` rather than
 * hidden, so the superseded string leaves the accessibility tree instead of being announced
 * alongside the replacement, and the replacement claims the grid cell upstream assigned that text
 * (`grid-area: 1 / 2`) — every child of the headline grid is explicitly placed, so an auto-placed
 * replacement would only land correctly by accident.
 *
 * The wordmark takes NEUTRAL ink rather than Parametria's accent blue (owner call, 2026-08-20,
 * superseding the accent treatment this sheet shipped with), and it gets there by this sheet DECLARING
 * NO COLOUR AT ALL. `color` is an inherited property and a pseudo-element inherits from the element
 * that originates it, so the wordmark takes `.hHd-Xa_brand`'s colour, which upstream declares as
 * `color: inherit` and lets the sidebar's own themed label ink flow into. Dark on the light sidebar,
 * near-white on the dark one, with nothing here to keep in step.
 *
 * There is deliberately no `color: inherit` written out below. It would be inert — that is already
 * the inherited value — and an inert declaration reads as a mechanism when it is only a comment.
 * This paragraph is the comment.
 *
 * Two literals keyed on `body[data-ds-dark-theme]` would have worked instead — upstream's own theme
 * boot script sets that attribute on every index response, in both shell modes — but they would pin
 * two colours whose entire purpose is to match a palette upstream owns, and they would drift the
 * first time upstream retuned its label ink. What is NOT guarded, and is worth stating rather than
 * implying: if upstream retuned that ink to something non-neutral, the wordmark would follow it. The
 * pin-drift anchor in `tests/client-brand.spec.ts` guards the delegation (`.brand` still inheriting),
 * not the resolved colour, which no fence in a stylesheet can reach.
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
${lockup} .hHd-Xa_brandName { display: none; }
${lockup}.hHd-Xa_wide::before { content: ""; flex: none; width: 24px; height: 24px; margin-right: 8px; background: ${mark}; }
${lockup}.hHd-Xa_wide::after { content: "${PARAMETRIA_WORDMARK}"; flex: none; font-size: 15px; font-weight: 700; line-height: 1; letter-spacing: 0.05em; white-space: nowrap; }
.dshDesktopUpstreamSidebar .hHd-Xa_railMark svg { background: ${mark}; }
.dshDesktopUpstreamSidebar .hHd-Xa_railMark svg > * { display: none; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish { background: ${mark}; }
.dshDesktopConversationSurface .pXSMma_fishHitbox .pXSMma_fish > * { display: none; }
.dshDesktopConversationSurface .pXSMma_headline .pXSMma_headlineText { display: none; }
.dshDesktopConversationSurface .pXSMma_headline::after { content: "${HERO_HEADLINE_TEXT}"; grid-area: 1 / 2; }
`
}
