/** Shared fixtures for the Parametria preset fences: paths and a `!!js`-tolerant YAML reader. */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

/** This package's directory (`<repo>/dsh-preset-parametria`). */
export const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** The product workspace root. */
export const REPO_ROOT = resolve(PACKAGE_ROOT, '..')
/** The pinned upstream checkout every drift fence compares against. */
export const UPSTREAM_ROOT = join(REPO_ROOT, 'deepseek-harness')

/**
 * A composition YAML is not plain YAML: `!!js <expression>` marks a Loader
 * expression evaluated at mount. A parser that does not know the tag would
 * either throw or silently drop the value, so the fences would compare
 * `undefined` to `undefined` and pass over a real difference. Preserving the
 * expression source verbatim keeps `disabled: !!js process.platform === 'win32'`
 * comparable between our preset and the shipped one it was copied from.
 */
const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  identify: value => value instanceof LoaderExpression,
  resolve: source => new LoaderExpression(source),
}

/** One `!!js` expression, compared by its source text. */
export class LoaderExpression {
  constructor(source) {
    this.source = String(source)
  }

  toJSON() {
    return `!!js ${this.source}`
  }
}

/**
 * Parse a composition or patch file.
 * @param path - absolute path to the YAML document.
 * @returns the parsed document with `!!js` values preserved.
 */
export function readComposition(path) {
  if (!existsSync(path)) {
    throw new Error(`fixture missing: ${path} — run 'git submodule update --init deepseek-harness' if this is the pinned upstream`)
  }
  return parse(readFileSync(path, 'utf8'), { customTags: [JS_TAG] })
}

/**
 * Index a composition's rows by id, descending into `group: true` rows so a
 * nested row is addressable as `<group>/<row>`. Flattening is what makes the
 * drift fence exhaustive: a row that moves between the top level and a group
 * changes its key and is reported, rather than matching by bare id.
 * @param rows - a parsed composition list.
 * @param prefix - the enclosing group path, for recursion.
 * @returns a Map of flattened id to row.
 */
export function indexRows(rows, prefix = '') {
  const index = new Map()
  for (const row of rows) {
    const key = `${prefix}${row.id}`
    if (index.has(key)) throw new Error(`duplicate row id ${key}`)
    index.set(key, row)
    if (row.group === true && Array.isArray(row.config)) {
      for (const [childKey, child] of indexRows(row.config, `${key}/`)) index.set(childKey, child)
    }
  }
  return index
}

/** The row's own configuration, with a group's nested row list excluded. */
export function rowConfig(row) {
  return row.group === true ? undefined : row.config
}

/** Structural equality over parsed YAML values, `!!js` expressions included. */
export function sameValue(left, right) {
  if (left instanceof LoaderExpression || right instanceof LoaderExpression) {
    return left instanceof LoaderExpression && right instanceof LoaderExpression
      && left.source === right.source
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]))
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return Object.is(left, right)
  }
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index])
    && leftKeys.every(key => sameValue(left[key], right[key]))
}

/**
 * Compose bundle patch layers the way `composeEntries` does, so a fence can
 * ask what a row's config actually is at the moment the profile's own patch
 * layer runs. Each layer is a list of `PatchOptions`: an `insert` adds rows,
 * an id-targeted entry REPLACES the named row's whole config. Later layers
 * win, which is exactly the semantics the profile patch then inherits.
 * @param paths - bundle patch files, in `dsh.profile.bundles` order.
 * @returns a Map of row id to the row as composed.
 */
export function composeBundles(paths) {
  const rows = new Map()
  for (const path of paths) {
    for (const entry of readComposition(path)) {
      if (Array.isArray(entry?.insert)) {
        for (const row of entry.insert) rows.set(row.id, { ...row })
        continue
      }
      if (typeof entry?.id !== 'string') continue
      const existing = rows.get(entry.id)
      // A patch naming an absent id is a warning upstream, not a row.
      if (existing === undefined) continue
      rows.set(entry.id, { ...existing, ...entry })
    }
  }
  return rows
}

/** The bundle patch files a `[dsh-base, dsh-web-app]` profile composes, in order. */
export function webProfileBundlePatches() {
  return [
    join(UPSTREAM_ROOT, 'packages', 'bundle', 'base', 'cordis.patch.yml'),
    join(UPSTREAM_ROOT, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'),
  ]
}

/**
 * Locate the installed pi-ai OpenRouter catalog data file.
 *
 * The INSTALLED package is the fence's subject rather than the submodule: it
 * is what `dsh-llm-pi-ai` actually resolves a model against at runtime, and a
 * resolutions or pin change that moves it is exactly the drift worth failing
 * on. Probing node_modules directly avoids depending on the package exporting
 * its own internal data path.
 * @returns absolute path to `openrouter.json`.
 */
export function openrouterCatalogPath() {
  const suffix = join(
    'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data', 'openrouter.json',
  )
  for (const anchor of [join(REPO_ROOT, 'dsh-plugin-desktop'), REPO_ROOT]) {
    const candidate = join(anchor, suffix)
    if (existsSync(candidate)) return candidate
  }
  throw new Error('pi-ai OpenRouter catalog not found; run `corepack yarn install --immutable` first')
}

/**
 * The installed catalog entry for one OpenRouter model id.
 * @param modelId - e.g. `google/gemini-3.6-flash`.
 * @returns the catalog entry, or undefined when the catalog does not ship it.
 */
export function openrouterCatalogEntry(modelId) {
  const data = JSON.parse(readFileSync(openrouterCatalogPath(), 'utf8'))
  let found
  const visit = value => {
    if (found !== undefined || value === null || typeof value !== 'object') return
    if (value.id === modelId) {
      found = value
      return
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(data)
  return found
}
