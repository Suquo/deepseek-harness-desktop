import { readFileSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { UPSTREAM_BRAND_CLASSES, parametriaBrandStyles } from '../src/client/brand.ts'
import { PARAMETRIA_MARK_ELEMENTS, PARAMETRIA_MARK_VIEW_BOX } from '../src/client/parametria-mark.ts'
import {
  SHELL_FAVICON_PATH,
  SHELL_MANIFEST_PATH,
  brandShellIndex,
  compatibilityBrandStyles,
  parametriaFaviconSvg,
  parametriaWebManifest,
  serveShellAsset,
  SHELL_ASSET_ALLOW,
} from '../src/shell-branding.ts'

/**
 * The display name this product ships, spelled out rather than imported.
 *
 * The source reads one exported constant on every surface, which is the point of the consolidation
 * — but a spec that imported that constant would assert nothing about its value. Restating the
 * string here is what turns "all four surfaces agree" into "all four surfaces say Parametria".
 */
const PRODUCT_NAME = 'Parametria'

/**
 * Every TypeScript file under a directory, recursively.
 *
 * The consolidation fence sweeps the package's whole source tree rather than the two modules that
 * carry the name today, so a third surface that restates it is caught the day it appears. Both
 * extensions are swept: the client face ships `.tsx`, and a wordmark restated in a component would
 * be exactly the drift this is for.
 * @param root - absolute directory to walk.
 * @returns absolute paths of the TypeScript files found beneath it.
 */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map(entry => `${entry.parentPath}/${entry.name}`)
}

/**
 * Every string-literal value in a TypeScript source, with comments excluded.
 *
 * Written as a scanner rather than a regex on purpose. A regex that looks for a quoted name has to
 * choose between two failure modes: anchored to the exact string it misses `'Parametria Terminal'`
 * and `'Parametr' + 'ia'`, and loosened to span quote characters it starts matching prose — this
 * package's own doc comments are full of the word, and full of apostrophes that a naive tokenizer
 * reads as opening quotes. Walking the source once with a mode is the only version that answers
 * the question actually being asked: which *values* does this code state?
 * @param source - TypeScript or TSX source text.
 * @returns the contents of every string and template literal, comments dropped.
 */
function stringLiterals(source: string): string[] {
  const found: string[] = []
  let mode: 'code' | 'line' | 'block' | '"' | "'" | '`' = 'code'
  let value = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string
    const next = source[index + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') { mode = 'line'; index += 1 }
      else if (char === '/' && next === '*') { mode = 'block'; index += 1 }
      else if (char === '"' || char === "'" || char === '`') { mode = char; value = '' }
      continue
    }
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; index += 1 } continue }
    if (char === '\\') { value += next ?? ''; index += 1; continue }
    if (char === mode) { found.push(value); mode = 'code'; continue }
    value += char
  }
  return found
}

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

    // The pinned index ships upstream's own title; after the tap neither the element nor the
    // string survives, and exactly one title remains. The literal is pin-coupled: rc.7 shipped
    // `DeepSeek Harness`, rc.8 ships `DSH Local Build` (the same build-identity string its sidebar
    // now uses as `fallbackBrandName`). What the tap must do is unchanged — replace whatever title
    // upstream ships with ours, exactly once, touching nothing else — so this is a precondition to
    // re-derive on a pin bump, not a behavior that moved.
    const upstreamTitle = '<title>DSH Local Build</title>'
    expect(html).toContain(upstreamTitle)
    expect(branded).toContain('<title>Parametria</title>')
    expect(branded).not.toContain('DeepSeek')
    expect([...branded.matchAll(/<title>/g)]).toHaveLength(1)

    // Everything else the document carries is upstream's business: the tap is identity-only.
    expect(branded.replace('<title>Parametria</title>', upstreamTitle)).toBe(html)
  })

  it('states the title on a document that ships without one', () => {
    const branded = brandShellIndex('<html><head><meta charset="utf-8" /></head><body></body></html>', 'advanced')

    expect(branded).toContain(`<head><title>${PRODUCT_NAME}</title>`)
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

    // The exemption must stay narrow: the only rules it lets through are the three that generate the
    // brand's own boxes — the lockup mark, the lockup wordmark, and the headline.
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

    expect(manifest.name).toBe(PRODUCT_NAME)
    expect(manifest.short_name).toBe(PRODUCT_NAME)
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
    // answered 405 — and the refusal names the methods that would have worked, which RFC 9110
    // §15.5.6 makes mandatory on this status and no other. No content-type: there is no body.
    const post = fakeResponse()
    serveShellAsset({ method: 'POST' } as IncomingMessage, post.res, 'image/svg+xml', 'body')
    expect(post.status()).toBe(405)
    expect(post.headers()).toEqual({ allow: 'GET, HEAD' })
    expect(post.body()).toBe('')

    // A request with no method at all is refused the same way, rather than falling through the
    // inequality pair the branch used to be written as.
    const methodless = fakeResponse()
    serveShellAsset({} as IncomingMessage, methodless.res, 'image/svg+xml', 'body')
    expect(methodless.status()).toBe(405)
    expect(methodless.headers()).toEqual({ allow: 'GET, HEAD' })
  })

  it('advertises exactly the methods it answers', () => {
    // The `Allow` value and the accepted set are one list read twice, so this asserts the two
    // against a third statement of the same fact: every method named is served, and a method that
    // is not named is refused.
    //
    // OPTIONS is in the refused list deliberately, and it is the one place this route departs from
    // what RFC 9110 §9.3.7 would prefer. These two routes exist to displace the upstream dist
    // server on two paths, and matching its method semantics is the whole point of the branch —
    // adding an OPTIONS responder here would make the branded paths behave differently from every
    // other path that server answers. The refusal at least carries `Allow`, which is the field an
    // OPTIONS response would have been asked for. Pinned so the deviation is a decision on the
    // record rather than an accident nobody re-examines.
    const advertised = SHELL_ASSET_ALLOW.split(', ')
    expect(advertised).toEqual(['GET', 'HEAD'])

    for (const method of advertised) {
      const res = fakeResponse()
      serveShellAsset({ method } as IncomingMessage, res.res, 'image/svg+xml', 'body')
      expect(res.status()).toBe(200)
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = fakeResponse()
      serveShellAsset({ method } as IncomingMessage, res.res, 'image/svg+xml', 'body')
      expect(res.status()).toBe(405)
      expect(res.headers().allow).toBe(SHELL_ASSET_ALLOW)
    }
  })

  it('states the product display name once, and reads it everywhere else', () => {
    // The consolidation fence. Five user-visible surfaces carry the name over six read sites — the
    // served title (two arms of the transform), the manifest's `name` and `short_name`, and the
    // native shell's productName and windowTitle — reached from two modules. Any string literal in
    // `src/` that CONTAINS the name, other than the one declaration in `client/brand.ts`, is a
    // surface that has stopped reading the constant: that is exactly how four of five get renamed
    // and the fifth does not. Containment rather than equality, so `'Parametria Terminal'` and a
    // concatenated half both count.
    const root = fileURLToPath(new URL('..', import.meta.url))
    const declarations: string[] = []
    for (const file of sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))) {
      const stated = stringLiterals(readFileSync(file, 'utf8'))
        .filter(literal => literal.includes(PRODUCT_NAME))
      // Relative, because a fence's failure message is a result: an absolute path here would name
      // this machine in a report meant to be read anywhere.
      declarations.push(...stated.map(() => relative(root, file).replaceAll('\\', '/')))
    }

    expect(declarations).toEqual(['src/client/brand.ts'])
    expect(PRODUCT_NAME).toBe('Parametria')
    expect(parametriaWebManifest()).toContain(`"name": "${PRODUCT_NAME}"`)

    // The scanner reads values, not prose: a comment mentioning Parametria is not a restatement,
    // and a literal that merely contains the name is. Both directions asserted, because a scanner
    // that silently returned nothing would make the sweep above vacuous.
    expect(stringLiterals('// Parametria\nconst a = 1\n')).toEqual([])
    expect(stringLiterals('/* it\'s Parametria */\nconst a = "Parametria Terminal"\n'))
      .toEqual(['Parametria Terminal'])
  })

  it('is a pure transform, so every index response gets the same document', () => {
    const html = upstreamIndex()
    const spy = vi.fn(() => brandShellIndex(html, 'compatibility'))

    expect(spy()).toBe(spy())
  })
})
