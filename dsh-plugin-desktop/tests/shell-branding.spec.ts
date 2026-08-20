import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { UPSTREAM_BRAND_CLASSES, parametriaBrandStyles } from '../src/client/brand.ts'
import { PARAMETRIA_MARK_ELEMENTS, PARAMETRIA_MARK_VIEW_BOX } from '../src/client/parametria-mark.ts'
import {
  PARAMETRIA_SHELL_TITLE,
  SHELL_FAVICON_PATH,
  SHELL_MANIFEST_PATH,
  brandShellIndex,
  compatibilityBrandStyles,
  parametriaFaviconSvg,
  parametriaWebManifest,
  serveShellAsset,
} from '../src/shell-branding.ts'

const UPSTREAM_INDEX_PATH = fileURLToPath(
  new URL('../../deepseek-harness/apps/web/index.html', import.meta.url),
)

/** The index document the pinned upstream shell actually ships, so the tap is proven on real markup. */
function upstreamIndex(): string {
  return readFileSync(UPSTREAM_INDEX_PATH, 'utf8')
}

/**
 * Read every class token a stylesheet selects on.
 *
 * Selector text only: declaration bodies carry the mark's `data:` URI, whose host name would
 * otherwise read as class tokens.
 * @param css - stylesheet text.
 * @returns the class names appearing in selector position.
 */
function selectedClasses(css: string): Set<string> {
  const selectors = css.split('}').map(block => block.split('{')[0] ?? '')
  return new Set(selectors.flatMap(selector =>
    [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => match[1] as string)))
}

/**
 * Read every declaration block of a stylesheet, in source order.
 * @param css - stylesheet text.
 * @returns the trimmed contents of each `{ … }`.
 */
function declarationBlocks(css: string): string[] {
  return [...css.matchAll(/\{([^}]*)\}/g)].map(match => (match[1] as string).trim())
}

/** Capture one response's status, headers, and body. */
function fakeResponse(): { res: ServerResponse, status: () => number, headers: () => Record<string, string>, body: () => string } {
  let status = 0
  let headers: Record<string, string> = {}
  let body = ''
  const res = {
    writeHead: (code: number, value?: Record<string, string>) => { status = code; headers = value ?? {} },
    end: (chunk?: string) => { body = chunk ?? '' },
  } as unknown as ServerResponse
  return { res, status: () => status, headers: () => headers, body: () => body }
}

describe('Parametria shell identity', () => {
  it('renames the served document without disturbing the rest of the upstream index', () => {
    const html = upstreamIndex()
    const branded = brandShellIndex(html, 'advanced')

    // The pinned index ships DeepSeek's title; after the tap neither the element nor the string
    // survives, and exactly one title remains.
    expect(html).toContain('<title>DeepSeek Harness</title>')
    expect(branded).toContain(`<title>${PARAMETRIA_SHELL_TITLE}</title>`)
    expect(branded).not.toContain('DeepSeek')
    expect([...branded.matchAll(/<title>/g)]).toHaveLength(1)

    // Everything else the document carries is upstream's business: the tap is identity-only.
    expect(branded.replace(`<title>${PARAMETRIA_SHELL_TITLE}</title>`, '<title>DeepSeek Harness</title>'))
      .toBe(html)
  })

  it('states the title on a document that ships without one', () => {
    const branded = brandShellIndex('<html><head><meta charset="utf-8" /></head><body></body></html>', 'advanced')

    expect(branded).toContain(`<head><title>${PARAMETRIA_SHELL_TITLE}</title>`)
    expect(branded).toContain('<meta charset="utf-8" />')
  })

  it('paints the brand only in the mode whose shell has no sheet of its own', () => {
    const html = upstreamIndex()

    // Compatibility runs the upstream client bare, so the document-level sheet is its only brand.
    const compatibility = brandShellIndex(html, 'compatibility')
    expect(compatibility).toContain(`<style>${compatibilityBrandStyles()}</style>`)
    expect(compatibility.indexOf('<style>')).toBeLessThan(compatibility.indexOf('</head>'))

    // The advanced shell paints the same sites from its own stylesheet; a second source here would
    // mean two owners for one pixel.
    expect(brandShellIndex(html, 'advanced')).not.toContain('<style>')
  })

  it('keeps the compatibility sheet a restatement of the advanced one, never a fork', () => {
    // Same declarations, same order: the two sheets differ only in the ancestors they select
    // through, so any treatment that changes on one side and not the other fails here.
    expect(declarationBlocks(compatibilityBrandStyles())).toEqual(declarationBlocks(parametriaBrandStyles()))
  })

  it('names exactly the upstream classes the pin was verified against', () => {
    const declared = new Set(Object.values(UPSTREAM_BRAND_CLASSES).flatMap(classes => Object.values(classes)))

    // Two directions at once, and with nothing filtered out: unlike the advanced sheet this one
    // owns no wrapper classes, so every class it names must be a pinned upstream one.
    expect(selectedClasses(compatibilityBrandStyles())).toEqual(declared)
  })

  it('outranks the upstream rules it supersedes rather than tying with them', () => {
    // Upstream's CSS modules are injected by the shell's module script, which runs after this
    // document-level sheet. Between two rules of equal specificity the later one wins, so a rule
    // that supersedes an upstream declaration must outrank it — one more class than the single-class
    // rule it displaces.
    //
    // Pseudo-element rules are exempt, and only they: they introduce a box upstream does not style
    // at all, so there is no competing declaration for them to tie with. Every other rule here
    // repaints something upstream already declared and must win on specificity alone.
    const selectors = compatibilityBrandStyles()
      .split('}')
      .map(block => (block.split('{')[0] ?? '').trim())
      .filter(selector => selector.length > 0)

    const superseding = selectors.filter(selector => !selector.includes('::'))
    expect(superseding).not.toHaveLength(0)
    for (const selector of superseding) {
      expect([...selector.matchAll(/\.[A-Za-z][\w-]*/g)].length).toBeGreaterThanOrEqual(2)
    }

    // The exemption must stay narrow: the only rules it lets through are the two that generate the
    // brand's own content.
    expect(selectors.filter(selector => selector.includes('::'))).toHaveLength(3)
  })

  it('serves the same mark the client paints, built from the committed asset', () => {
    const svg = parametriaFaviconSvg()

    expect(svg).toContain(`viewBox="${PARAMETRIA_MARK_VIEW_BOX}"`)
    for (const element of PARAMETRIA_MARK_ELEMENTS) expect(svg).toContain(element)

    // The brand blues are deliberate in both themes, so they must survive into the shell icon.
    expect(svg).toContain('fill="#1a8fc4"')
    expect(svg).toContain('fill="#0e6a94"')
  })

  it('renames the manifest and points it at the icon this generation serves', () => {
    const manifest = JSON.parse(parametriaWebManifest()) as {
      name: string
      short_name: string
      icons: { src: string }[]
    }

    expect(manifest.name).toBe(PARAMETRIA_SHELL_TITLE)
    expect(manifest.short_name).toBe(PARAMETRIA_SHELL_TITLE)
    expect(parametriaWebManifest()).not.toContain('DeepSeek')
    expect(parametriaWebManifest()).not.toContain('DSH')

    // The icon entry must name the path the sibling route claims, or the manifest would fall
    // through to whatever the upstream dist still serves there.
    expect(manifest.icons.map(icon => icon.src)).toEqual([SHELL_FAVICON_PATH])
  })

  it('claims the two upstream dist paths the shell document points at', () => {
    const html = upstreamIndex()

    // The tap rewrites no href, so these routes are the only thing rebranding those two responses:
    // if upstream ever moved either path, the document would silently fetch the DeepSeek asset.
    expect(html).toContain(`href="${SHELL_FAVICON_PATH}"`)
    expect(html).toContain(`href="${SHELL_MANIFEST_PATH}"`)
  })

  it('answers asset requests the way the static server it displaces would', () => {
    const get = fakeResponse()
    serveShellAsset({ method: 'GET' } as IncomingMessage, get.res, 'image/svg+xml', 'body')
    expect(get.status()).toBe(200)
    expect(get.headers()).toEqual({ 'content-type': 'image/svg+xml' })
    expect(get.body()).toBe('body')

    // HEAD keeps the headers and withholds the body.
    const head = fakeResponse()
    serveShellAsset({ method: 'HEAD' } as IncomingMessage, head.res, 'image/svg+xml', 'body')
    expect(head.status()).toBe(200)
    expect(head.headers()).toEqual({ 'content-type': 'image/svg+xml' })
    expect(head.body()).toBe('')

    // Anything else is refused rather than served against a verb the dist server would have
    // answered 405.
    const post = fakeResponse()
    serveShellAsset({ method: 'POST' } as IncomingMessage, post.res, 'image/svg+xml', 'body')
    expect(post.status()).toBe(405)
    expect(post.body()).toBe('')
  })

  it('is a pure transform, so every index response gets the same document', () => {
    const html = upstreamIndex()
    const spy = vi.fn(() => brandShellIndex(html, 'compatibility'))

    expect(spy()).toBe(spy())
  })
})
