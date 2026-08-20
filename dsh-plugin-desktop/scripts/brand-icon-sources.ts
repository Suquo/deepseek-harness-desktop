/**
 * Derive the native icon sources from the one vendored Parametria mark.
 *
 * `assets/parametria-logo-icon.svg` is the single piece of brand artwork this package owns; the
 * client mark module vendors its element list verbatim and `tests/client-brand.spec.ts` re-derives
 * that copy from this file. The two native icon sources are derived from the same file here, so no
 * icon in this package is hand-authored artwork that could drift from the mark the app paints.
 *
 * Two derivations, because the two surfaces have different constraints:
 *
 * - The **application icon** carries the mark exactly as drawn — both blues and the `#fff`
 *   construction hairlines — on an opaque plate. The plate is not decoration: the hairlines are
 *   white, so on transparency or on a light ground they are invisible, and the mark renders as
 *   drawn only over a dark one. The outgoing icon was a full-bleed rounded square too, so the
 *   product's icon silhouette in a dock or taskbar is unchanged.
 * - The **tray icon** must survive being recoloured to a single flat value: macOS template images
 *   carry alpha and nothing else, and `generate-tray-icons.mjs` produces the template variants by
 *   replacing the one brand colour with black. A two-colour mark with white hairlines cannot
 *   survive that, so the tray source is the mark's solid elements only, flattened to one colour,
 *   cropped to the artwork's own bounding box so the glyph fills a 16-pixel box.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root, resolved from this file rather than from the working directory. */
export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** The one vendored piece of Parametria artwork every icon in this package derives from. */
export const MARK_SOURCE_PATH = join(packageRoot, 'assets', 'parametria-logo-icon.svg')

/** Single flat colour of the tray source, the mark's primary blue. */
export const TRAY_BRAND_COLOR = '#1a8fc4'

/** Opaque ground the application icon paints the mark over. */
export const APP_ICON_PLATE_COLOR = '#0d0d0d'

/** Pixel width and height of the application icon. */
export const APP_ICON_SIZE = 1024

/**
 * Corner radius of the application icon plate, as a fraction of its side.
 *
 * Apple's icon grid puts the corner radius of a full-bleed app icon at just under a quarter of the
 * side; the outgoing icon used the same treatment. Windows and Linux do not mask an icon at all,
 * so the shape has to live in the artwork on every platform.
 */
export const APP_ICON_CORNER_RATIO = 0.2237

/**
 * Fraction of the plate the mark's own artwork box occupies.
 *
 * The mark is drawn with generous margin inside its 500-unit view box; measured against the
 * artwork rather than the view box, this is the visual weight the outgoing icon carried.
 */
export const APP_ICON_ARTWORK_RATIO = 0.72

/** View box of the vendored mark. */
export const MARK_VIEW_BOX = '0 0 500 500'

/**
 * Bounding box of the mark's solid elements, in view-box units.
 *
 * The mark's construction hairlines run out to 30.75 and 469.25, but the drawn glyph — the two
 * lettered paths, the two polygons and the node dots — occupies the square between the outermost
 * dots, whose centres sit at 74.6 and 425.4 with a radius of 5.26.
 */
export const MARK_ARTWORK_BOX = Object.freeze({
  x: 69.34,
  y: 69.34,
  size: 361.32,
})

/**
 * Split the vendored mark file into its drawing elements.
 * @param source - contents of `assets/parametria-logo-icon.svg`.
 * @returns every child element of the root `<svg>`, in source order, whitespace stripped.
 */
export function markElements(source: string): string[] {
  const body = /<svg\b[^>]*>([\s\S]*)<\/svg>/u.exec(source)
  if (body === null) throw new Error('brand-icon-sources: the mark is not a single <svg> document')
  const elements = (body[1] as string).match(/<[a-z]+\b[^>]*\/>/gu) ?? []
  if (elements.length === 0) throw new Error('brand-icon-sources: the mark has no drawing elements')
  return elements
}

/**
 * Build the tray icon source: the mark's solid elements, flattened to one colour.
 *
 * `<line>` elements are the construction grid. They are dropped rather than recoloured because
 * they are `#fff` hairlines that read as grid over the artwork, not as part of the glyph — and a
 * monochrome silhouette cannot express the figure/ground they rely on.
 * @param source - contents of `assets/parametria-logo-icon.svg`.
 * @returns an SVG document whose only colour is {@link TRAY_BRAND_COLOR}.
 */
export function trayIconSvg(source: string): string {
  const solid = markElements(source)
    .filter(element => !element.startsWith('<line'))
    .map(element => element.replace(/fill="#[0-9a-f]{3,8}"/giu, `fill="${TRAY_BRAND_COLOR}"`))
  const { x, y, size } = MARK_ARTWORK_BOX
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="${x} ${y} ${size} ${size}" fill="none">\n`
    + `${solid.join('\n')}\n</svg>\n`
}

/**
 * Build the application icon source: the whole mark, centred on an opaque rounded plate.
 * @param source - contents of `assets/parametria-logo-icon.svg`.
 * @returns an SVG document at {@link APP_ICON_SIZE} pixels square.
 */
export function appIconSvg(source: string): string {
  const { x, y, size } = MARK_ARTWORK_BOX
  const artwork = APP_ICON_SIZE * APP_ICON_ARTWORK_RATIO
  const offset = (APP_ICON_SIZE - artwork) / 2
  const radius = APP_ICON_SIZE * APP_ICON_CORNER_RATIO
  const scale = artwork / size
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" `
    + `viewBox="0 0 ${APP_ICON_SIZE} ${APP_ICON_SIZE}" fill="none">\n`
    + `<rect x="0" y="0" width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" rx="${radius}" ry="${radius}" fill="${APP_ICON_PLATE_COLOR}"/>\n`
    + `<g transform="translate(${offset} ${offset}) scale(${scale}) translate(${-x} ${-y})">\n`
    + `${markElements(source).join('\n')}\n</g>\n</svg>\n`
}

/**
 * Read the vendored mark.
 * @returns the file contents.
 */
export async function readMarkSource(): Promise<string> {
  return readFile(MARK_SOURCE_PATH, 'utf8')
}
