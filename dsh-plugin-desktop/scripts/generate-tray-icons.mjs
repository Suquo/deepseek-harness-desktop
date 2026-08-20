/**
 * Generate native tray bitmaps from the repository-owned brand SVG.
 *
 * The single-colour rule this asserts is what makes the macOS template variants possible: a
 * template image carries alpha only, and it is produced below by replacing the one brand colour
 * with black. `scripts/generate-brand-icons.ts` derives a source that satisfies it from the
 * vendored mark; this script only ever consumes the committed result.
 *
 * The colour is read out of the source rather than restated here. The invariant this script needs
 * is not "the colour is that particular blue" — it is "there is exactly one colour to replace", and
 * reading it is what makes that the thing actually checked. `tests/package.spec.ts` is where the
 * value is pinned.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath, 'utf8')

// Read by ATTRIBUTE, not by scanning for `#` tokens: a token scan misses `fill="white"`,
// `fill="rgb(…)"` and `style="fill:…"`, each of which would put a second colour into a template
// image that can only carry alpha.
const colors = new Set(
  [...source.matchAll(/(?:fill|stroke)\s*=\s*"([^"]*)"/giu)]
    .map(match => match[1].trim().toLowerCase())
    .filter(value => value !== 'none' && value !== ''),
)
const [BRAND_BLUE] = colors
if (colors.size !== 1 || !/^#[0-9a-f]{3,8}$/u.test(BRAND_BLUE ?? '')) {
  throw new Error(
    `generate-tray-icons: tray-icon.svg must name exactly one hex paint value, found ${
      colors.size === 0 ? 'none' : [...colors].join(', ')
    }`,
  )
}
if (/<style\b|style\s*=|prefers-color-scheme/iu.test(source)) {
  throw new Error('generate-tray-icons: tray-icon.svg must not carry style rules')
}

const variants = [
  ['tray-iconTemplate.png', '#000000', 16],
  ['tray-iconTemplate@2x.png', '#000000', 32],
  ['tray-icon-blue.png', BRAND_BLUE, 16],
  ['tray-icon-blue@1.25x.png', BRAND_BLUE, 20],
  ['tray-icon-blue@1.5x.png', BRAND_BLUE, 24],
  ['tray-icon-blue@2x.png', BRAND_BLUE, 32],
]

await Promise.all(variants.map(async ([filename, color, size]) => {
  const rendered = source.replaceAll(BRAND_BLUE, color)
  await sharp(Buffer.from(rendered))
    .resize({ width: size, height: size, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
