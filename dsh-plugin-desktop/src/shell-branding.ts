/**
 * Parametria identity for the served web shell.
 *
 * The desktop Host serves the upstream SPA over loopback, so every face of the product — the
 * compatibility shell, the advanced shell, and the same URL opened in a browser — receives its
 * document from one place: `frontend-static` renders `index.html` through
 * `webServer.applyIndexTaps()`, and answers `/favicon.svg` and `/manifest.webmanifest` from the
 * upstream dist unless a named route claims those paths first.
 *
 * That makes this module the shell-level half of the brand, and it owns exactly three things: the
 * document title, the two presentational assets the document points at, and — in compatibility
 * mode only — the brand stylesheet.
 *
 * The mode split matters. The advanced shell paints its own brand from
 * `src/client/brand.ts`, scoped to the wrappers it mounts upstream inside
 * (`.dshDesktopUpstreamSidebar`, `.dshDesktopConversationSurface`). Those wrappers do not exist in
 * the compatibility shell, where upstream's classes appear bare, so the advanced sheet's selectors
 * would match nothing there. The sheet below is the same treatment expressed for the unwrapped
 * document, and it is injected only when the generation runs in compatibility mode — so each mode
 * has exactly one source painting these pixels, never two.
 *
 * Brand values are never restated here: the product's display name, the wordmark, both accents, the
 * headline, the mark, and the upstream class table are imported from the client brand module, and
 * `tests/shell-branding.spec.ts` holds the two sheets to the same declarations.
 *
 * Compatibility mode carries visual branding by owner ruling (AGENTS.md, issue #26) and nothing
 * else: no slot, service, or behaviour of the upstream default client is touched from here.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HERO_HEADLINE_TEXT,
  PARAMETRIA_ACCENT_DARK,
  PARAMETRIA_ACCENT_LIGHT,
  PARAMETRIA_PRODUCT_NAME,
  PARAMETRIA_WORDMARK,
  UPSTREAM_BRAND_CLASSES,
} from './client/brand.ts'
import {
  PARAMETRIA_MARK_ELEMENTS,
  PARAMETRIA_MARK_VIEW_BOX,
  parametriaMarkDataUri,
} from './client/parametria-mark.ts'
import type { DesktopShellMode } from './runtime.ts'

/** Upstream dist path of the shell icon, claimed by a named route so the manifest icon follows. */
export const SHELL_FAVICON_PATH = '/favicon.svg'

/** Upstream dist path of the web manifest, claimed by a named route. */
export const SHELL_MANIFEST_PATH = '/manifest.webmanifest'

/**
 * Methods these routes answer, and the value their 405 advertises.
 *
 * One list, read twice — the refusal a client is told about is the same list the code enforces,
 * rather than a header that can quietly fall out of step with the branch above it.
 */
const SHELL_ASSET_METHODS = ['GET', 'HEAD'] as const

/** `Allow` field value of the 405 response, formatted as the RFC's comma-separated method list. */
export const SHELL_ASSET_ALLOW = SHELL_ASSET_METHODS.join(', ')

const SIDEBAR = UPSTREAM_BRAND_CLASSES['@deepseek-ai/dsh-client-ui-sidebar']
const CONVERSATION = UPSTREAM_BRAND_CLASSES['@deepseek-ai/dsh-client-ui-conversation']

/**
 * The Parametria mark as a standalone SVG document.
 *
 * Built from the same vendored element list the client sheet paints with, so the shell icon cannot
 * drift from the in-app mark. Nothing is read from disk: the elements are TypeScript literals that
 * bundle into the Host, which keeps the shell icon off the packaging closure surface entirely.
 * @returns an SVG document body.
 */
export function parametriaFaviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PARAMETRIA_MARK_VIEW_BOX}" fill="none">`
    + PARAMETRIA_MARK_ELEMENTS.join('')
    + '</svg>'
}

/**
 * The web manifest of the served shell.
 *
 * Upstream's own manifest shape is kept — id, scope, start URL, display mode, and the single
 * any-size SVG icon — because only the two name fields are brand. The icon keeps pointing at
 * {@link SHELL_FAVICON_PATH}, which the same generation serves as the Parametria mark.
 * @returns the manifest JSON body.
 */
export function parametriaWebManifest(): string {
  return `${JSON.stringify({
    id: '/',
    name: PARAMETRIA_PRODUCT_NAME,
    short_name: PARAMETRIA_PRODUCT_NAME,
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [
      {
        src: SHELL_FAVICON_PATH,
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }, null, 2)}\n`
}

/**
 * Answer one request for a presentational shell asset.
 *
 * These routes claim two paths the upstream dist would otherwise answer, so they keep the method
 * semantics that server has: read methods succeed, anything else is 405 rather than a body served
 * against a verb the static server would have refused.
 *
 * The refusal carries `Allow`. A 405 without it is an incomplete response — RFC 9110 §15.5.6 makes
 * the field mandatory on that status precisely because the status alone says only "not this
 * method", leaving a client no way to learn which method would have worked. The value is generated
 * from {@link SHELL_ASSET_METHODS}, the same list the branch below tests, so the advertised set
 * cannot drift from the enforced one.
 * @param req - the incoming request, read for its method.
 * @param res - the response this route owns.
 * @param contentType - MIME type of the asset.
 * @param body - the asset body, withheld from a HEAD response.
 */
export function serveShellAsset(
  req: IncomingMessage,
  res: ServerResponse,
  contentType: string,
  body: string,
): void {
  if (!(SHELL_ASSET_METHODS as readonly (string | undefined)[]).includes(req.method)) {
    res.writeHead(405, { allow: SHELL_ASSET_ALLOW })
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': contentType })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(body)
}

/**
 * Build the compatibility-shell brand stylesheet.
 *
 * The same three mark sites and the same headline the advanced sheet treats, selected without the
 * desktop wrappers. Selectors are composed from the upstream class table rather than written out,
 * so the pin-drift guards that stand behind that table stand behind this sheet too.
 *
 * Every rule is two classes deep. That is not decoration: upstream's CSS modules are injected by
 * the shell's own module script, which runs after this document-level sheet, so a rule that merely
 * tied on specificity would lose the cascade. Each selector here sits one level above the upstream
 * rule it supersedes — `.logoRow .railFish` over `.railFish`, `.fishHitbox .fish` over `.fish` —
 * and the nesting each one claims is upstream's own (`SidebarRoot.tsx`: the rail button lives
 * inside `.logoRow`).
 *
 * The accessibility arrangement is the advanced sheet's, for the same reason: upstream's marks are
 * `aria-hidden` decoration, so repainting their boxes costs no accessible name, and the lockup
 * button keeps announcing the "New session" action its `aria-label` names — generated `::after`
 * text is only reached by name-from-content, which that label pre-empts. The superseded headline is
 * removed with `display: none` so it leaves the accessibility tree rather than being announced
 * beside its replacement.
 * @returns the stylesheet text injected into the compatibility shell's document.
 */
export function compatibilityBrandStyles(): string {
  const mark = `url("${parametriaMarkDataUri()}") no-repeat center / contain`
  const lockup = `.${SIDEBAR.logoRow} .${SIDEBAR.brand}`
  return `
${lockup} { display: inline-flex; align-items: center; }
${lockup} svg { display: none; }
${lockup}.${SIDEBAR.wide}::after { content: "${PARAMETRIA_WORDMARK}"; flex: none; font-size: 15px; font-weight: 700; line-height: 1; letter-spacing: 0.05em; white-space: nowrap; color: ${PARAMETRIA_ACCENT_LIGHT}; }
body[data-ds-dark-theme] ${lockup}.${SIDEBAR.wide}::after { color: ${PARAMETRIA_ACCENT_DARK}; }
.${SIDEBAR.logoRow} .${SIDEBAR.railFish} { background: ${mark}; }
.${SIDEBAR.logoRow} .${SIDEBAR.railFish} > * { display: none; }
.${CONVERSATION.fishHitbox} .${CONVERSATION.fish} { background: ${mark}; }
.${CONVERSATION.fishHitbox} .${CONVERSATION.fish} > * { display: none; }
.${CONVERSATION.headline} .${CONVERSATION.headlineText} { display: none; }
.${CONVERSATION.headline}::after { content: "${HERO_HEADLINE_TEXT}"; grid-area: 1 / 2; }
`
}

/**
 * Apply the shell's brand identity to one index document.
 *
 * The title is rewritten in place when upstream ships one, and inserted into the head when it does
 * not, so the transform states the product name rather than assuming upstream's markup. The
 * compatibility sheet is appended at the end of the head, the conventional place for a document
 * stylesheet.
 *
 * The transform is pure and runs on every index response, including the SPA routing fallback.
 * @param html - the raw index document.
 * @param mode - the active native presentation mode; only compatibility receives the brand sheet.
 * @returns the branded document.
 */
export function brandShellIndex(html: string, mode: DesktopShellMode): string {
  const titled = /<title>[^<]*<\/title>/i.test(html)
    ? html.replace(/<title>[^<]*<\/title>/i, `<title>${PARAMETRIA_PRODUCT_NAME}</title>`)
    : html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}<title>${PARAMETRIA_PRODUCT_NAME}</title>`)
  if (mode !== 'compatibility') return titled
  const style = `<style>${compatibilityBrandStyles()}</style>`
  const head = /<\/head>/i.exec(titled)
  /* v8 ignore next -- head-less documents: upstream's index always carries one, so this arm only
  guards a hand-built fragment reaching the tap. */
  if (head === null) return `${titled}${style}`
  return `${titled.slice(0, head.index)}${style}${titled.slice(head.index)}`
}
