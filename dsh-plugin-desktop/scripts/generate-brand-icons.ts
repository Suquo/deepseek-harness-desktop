/**
 * Write the two committed native icon sources from the vendored Parametria mark.
 *
 * This generator is deliberately **not** part of `yarn build`. `build/tray-icon.svg` and
 * `build/app-icon.png` are committed source artifacts that the build chain consumes: the tray
 * bitmaps and the macOS Dock icon are derived from them on every build, and `tests/package.spec.ts`
 * pins the application icon by digest. A PNG re-encoded on every machine could not carry a digest
 * pin, so the raster is produced once, reviewed, and committed — the same arrangement the outgoing
 * vendored icon had. Run this after changing `assets/parametria-logo-icon.svg`; the drift guards in
 * `tests/package.spec.ts` fail until you do.
 *
 * Usage: `node scripts/generate-brand-icons.ts`
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import sharp from 'sharp'
import {
  APP_ICON_SIZE,
  appIconSvg,
  packageRoot,
  readMarkSource,
  trayIconSvg,
} from './brand-icon-sources.ts'

/**
 * Rasterize the application icon in the colour format the macOS derivation requires of its source.
 *
 * `generate-mac-app-icon.mjs` refuses any source that is not a 1024-pixel RGBA16 PNG carrying an
 * ICC profile, and copies that profile onto its own output — so the format is not incidental, it is
 * the contract between the two scripts.
 * @param source - contents of the vendored mark.
 * @returns the encoded PNG.
 */
export async function renderAppIcon(source: string): Promise<Buffer> {
  return sharp(Buffer.from(appIconSvg(source)), { density: 288 })
    .resize({ width: APP_ICON_SIZE, height: APP_ICON_SIZE, fit: 'fill' })
    .toColourspace('rgb16')
    .withIccProfile('srgb')
    .png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false })
    .toBuffer()
}

/**
 * Write both icon sources into `build/`.
 * @returns Resolves once both files are on disk.
 */
export async function generateBrandIcons(): Promise<void> {
  const source = await readMarkSource()
  await writeFile(join(packageRoot, 'build', 'tray-icon.svg'), trayIconSvg(source), 'utf8')
  await writeFile(join(packageRoot, 'build', 'app-icon.png'), await renderAppIcon(source))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateBrandIcons()
}
