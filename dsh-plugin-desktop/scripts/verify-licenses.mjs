/**
 * Verify every production dependency shipped inside the desktop installers
 * carries a redistribution-safe license and fence the generated notices file.
 *
 * The installed dependency tree is the source for ordinary packages. Optional
 * packages for the supported release matrix are completed from yarn.lock and
 * their exact package archives, so the result does not depend on the host OS.
 *
 * @module scripts/verify-licenses
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { parse as parseYaml } from 'yaml'

const scriptPath = fileURLToPath(import.meta.url)
const packageRoot = dirname(dirname(scriptPath))
const projectRoot = dirname(packageRoot)
const rootManifestPath = join(packageRoot, 'package.json')
const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
const noticesPath = join(packageRoot, 'THIRD_PARTY_NOTICES.md')

const TARGET_OSES = new Set(['darwin', 'linux', 'win32'])
const TARGET_CPUS = new Set(['arm64', 'x64'])
const REGEN_COMMAND = 'corepack yarn workspace dsh-plugin-desktop verify:notices'
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']

/** Licenses accepted for redistribution inside the desktop installers. */
const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
  'CC0-1.0',
  'Zlib',
  'Python-2.0',
])

/**
 * Licenses that permit redistribution only when their notice obligations are
 * honored. Sharp ships libvips as a separate @img/sharp-libvips-* package on
 * macOS and Linux and inside the @img/sharp-win32-* package on Windows. Their
 * license texts ship inside node_modules in the installer. Keep this list
 * minimal and review any addition.
 */
const NOTICE_LICENSES = new Set([
  'LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later',
])

/**
 * Locate one installed package manifest by walking node_modules directories
 * upward from the parent manifest. Reads the real package.json regardless of
 * the package's `exports` map, which often hides the `./package.json` subpath.
 */
function resolvePackageManifest(name, fromManifestPath) {
  const segments = name.split('/')
  const folder = name.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  const entry = name.startsWith('@') ? segments.slice(2).join('/') : segments.slice(1).join('/')
  let dir = dirname(fromManifestPath)
  for (;;) {
    const candidate = join(dir, 'node_modules', folder, entry, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Normalize the license field of one package manifest. */
function licenseExpression(manifest) {
  const value = manifest.license
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && typeof value.type === 'string') return value.type
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((item) => (typeof item === 'string' ? item : item.type))
      .filter(Boolean)
      .join(' OR ')
  }
  return undefined
}

/**
 * Return true when a Yarn condition can ship in the supported release matrix.
 * libc is deliberately not narrowed: glibc and musl are both variants of the
 * requested linux/x64 and linux/arm64 OS/CPU triples.
 */
export function targetsSupportedPlatform(condition) {
  if (typeof condition !== 'string') return false
  const terms = new Map(
    condition.split(' & ').map((term) => {
      const separator = term.indexOf('=')
      return separator === -1
        ? [term, '']
        : [term.slice(0, separator), term.slice(separator + 1)]
    }),
  )
  const os = terms.get('os')
  const cpu = terms.get('cpu')
  return os !== undefined
    && TARGET_OSES.has(os)
    && (cpu === undefined || TARGET_CPUS.has(cpu))
}

/** Generic optionals ship everywhere; conditioned optionals must match the matrix. */
export function includesLockedOptional(record) {
  return record.conditions === undefined || targetsSupportedPlatform(record.conditions)
}

/** Build an exact descriptor-to-lock-record index from Yarn's lockfile. */
export function createLockDescriptorIndex(lockfile) {
  const parsed = parseYaml(lockfile)
  const descriptors = new Map()
  for (const [descriptorList, record] of Object.entries(parsed)) {
    if (descriptorList === '__metadata') continue
    for (const descriptor of descriptorList.split(', ')) descriptors.set(descriptor, record)
  }
  return descriptors
}

/** Resolve one manifest dependency range to its exact Yarn lock record. */
export function resolveLockedPackage(descriptors, name, range) {
  const normalizedRange = range.startsWith('npm:') ? range : `npm:${range}`
  return descriptors.get(`${name}@${normalizedRange}`) ?? descriptors.get(`${name}@${range}`)
}

/** The stable, actionable failure emitted when the committed asset drifts. */
export function noticesDriftError() {
  return [
    'verify-licenses: THIRD_PARTY_NOTICES.md is out of date',
    `Regenerate it with: ${REGEN_COMMAND}`,
  ].join('\n')
}

function noticeRequirements(manifests) {
  const entries = manifests.filter((entry) => NOTICE_LICENSES.has(entry.license))
  const usedLicenses = new Set(entries.map((entry) => entry.license))
  return {
    entries,
    licenses: [...NOTICE_LICENSES].filter((license) => usedLicenses.has(license)),
  }
}

/** Render the committed notice format from validated package manifests. */
export function renderNotices(manifests) {
  const noticeRequirementsInUse = noticeRequirements(manifests)
  const lines = [
    '# Third-Party Notices',
    '',
    'DSH Desktop distributes the following third-party packages inside its installers.',
    'Each package ships with its own license text in the application files; this list records',
    'the package names, versions, and licenses for transparency.',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...[...manifests]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `| ${entry.name} | ${entry.version ?? ''} | ${entry.license} |`),
    '',
    noticeRequirementsInUse.entries.length === 0
      ? ''
      : `> Notice-required licenses in use: ${noticeRequirementsInUse.licenses.join(', ')}. Their license texts ship inside node_modules; see the package LICENSE files for the full terms.`,
    '',
  ].filter((line) => line !== '')
  return lines.join('\n')
}

function installedPackage(name, fromManifestPath) {
  const manifestPath = resolvePackageManifest(name, fromManifestPath)
  if (manifestPath === undefined) return undefined
  return {
    name,
    manifestPath,
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
    hasLicenseFile: LICENSE_FILES.some((file) => existsSync(join(dirname(manifestPath), file))),
    fromArchive: false,
  }
}

function yarnCommand() {
  const corepackRoot = process.env.COREPACK_ROOT
  if (corepackRoot !== undefined) {
    return { command: process.execPath, prefix: [join(corepackRoot, 'dist', 'yarn.js')] }
  }
  const yarnPath = process.env.npm_execpath
  if (yarnPath !== undefined && /\.[cm]?js$/u.test(yarnPath)) {
    return { command: process.execPath, prefix: [yarnPath] }
  }
  throw new Error(`Run this check through Corepack Yarn: ${REGEN_COMMAND}`)
}

/**
 * Ask Yarn for each exact lock locator. Yarn reuses its cache when present and
 * otherwise fetches the lockfile-resolvable archive; it never links or builds
 * these packages into node_modules.
 */
function readLockedPackageArchives(requests) {
  const locators = [...new Set(requests.map((request) => request.record.resolution))]
  const { command, prefix } = yarnCommand()
  const result = spawnSync(command, [
    ...prefix,
    'info',
    ...locators,
    '-A',
    '-R',
    '--manifest',
    '--cache',
    '--json',
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`Yarn could not read locked optional package metadata: ${detail}`)
  }

  const metadata = new Map()
  for (const line of result.stdout.split(/\r?\n/u).filter(Boolean)) {
    const row = JSON.parse(line)
    metadata.set(row.value, row.children)
  }

  return requests.map((request) => {
    const locator = request.record.resolution
    const cachePath = metadata.get(locator)?.Cache?.Path
    if (typeof cachePath !== 'string') {
      throw new Error(`${locator}: Yarn did not return a package archive path`)
    }
    const archive = new AdmZip(cachePath)
    const prefixPath = `node_modules/${request.name}/`
    const manifestEntry = archive.getEntry(`${prefixPath}package.json`)
    if (manifestEntry === null) {
      throw new Error(`${locator}: cached package archive has no package.json`)
    }
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
    if (manifest.name !== request.name || manifest.version !== request.record.version) {
      throw new Error(`${locator}: cached package manifest does not match yarn.lock`)
    }
    const hasLicenseFile = LICENSE_FILES.some((file) => archive.getEntry(`${prefixPath}${file}`) !== null)
    return {
      name: request.name,
      manifestPath: rootManifestPath,
      manifest,
      hasLicenseFile,
      fromArchive: true,
    }
  })
}

function validateManifest(current, failures, manifests) {
  if (current.name === rootManifest.name) return
  const license = licenseExpression(current.manifest)
  if (license === undefined && !current.hasLicenseFile) {
    failures.push(`${current.name}: no license field and no LICENSE file`)
  } else if (license !== undefined && license.startsWith('SEE LICENSE IN ')) {
    if (!current.hasLicenseFile) {
      failures.push(`${current.name}: license refers to ${JSON.stringify(license)} but no LICENSE file is shipped`)
    }
  } else if (license !== undefined && !ALLOWED_LICENSES.has(license) && !NOTICE_LICENSES.has(license)) {
    failures.push(`${current.name}: license ${JSON.stringify(license)} is not on the redistribution allowlist`)
  }
  manifests.push({
    name: current.name,
    version: current.manifest.version,
    license: license ?? 'SEE LICENSE FILE',
  })
}

function walkProductionPackages() {
  const lockDescriptors = createLockDescriptorIndex(readFileSync(join(projectRoot, 'yarn.lock'), 'utf8'))
  const failures = []
  const manifests = []
  const seen = new Set()
  const queued = new Set([rootManifest.name])
  const queue = [{
    name: rootManifest.name,
    manifestPath: rootManifestPath,
    manifest: rootManifest,
    hasLicenseFile: true,
    fromArchive: false,
  }]

  for (let index = 0; index < queue.length;) {
    const pendingArchives = new Map()
    while (index < queue.length) {
      const current = queue[index]
      index += 1
      if (current === undefined || seen.has(current.name)) continue
      seen.add(current.name)
      validateManifest(current, failures, manifests)

      for (const section of ['dependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(current.manifest[section] ?? {})) {
          if (queued.has(name) || seen.has(name)) continue
          const record = resolveLockedPackage(lockDescriptors, name, range)
          if (section === 'optionalDependencies') {
            if (record === undefined) {
              failures.push(`${current.name} -> ${name}: absent package has no matching yarn.lock entry`)
              continue
            }
            if (!includesLockedOptional(record)) continue
          }
          const installed = installedPackage(name, current.manifestPath)
          if (installed !== undefined) {
            queued.add(name)
            queue.push(installed)
            continue
          }

          if (record === undefined) {
            failures.push(`${current.name} -> ${name}: absent package has no matching yarn.lock entry`)
            continue
          }
          const isRequiredArchiveDependency = current.fromArchive && section === 'dependencies'
          if (isRequiredArchiveDependency || section === 'optionalDependencies') {
            queued.add(name)
            pendingArchives.set(name, { name, record })
          } else if (section === 'dependencies') {
            failures.push(`${current.name} -> ${name}: could not locate its manifest`)
          }
        }
      }
    }

    if (pendingArchives.size > 0) {
      try {
        queue.push(...readLockedPackageArchives([...pendingArchives.values()]))
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return { failures, manifests, total: seen.size - 1 }
}

function main() {
  const { failures, manifests, total } = walkProductionPackages()
  if (failures.length > 0) {
    process.stderr.write(`verify-licenses: ${failures.length} production package(s) need attention\n`)
    for (const failure of failures) process.stderr.write(`- ${failure}\n`)
    process.exit(1)
  }

  const expectedNotices = renderNotices(manifests)
  const noticesArg = process.argv.indexOf('--notices')
  if (noticesArg !== -1) {
    const target = process.argv[noticesArg + 1]
    if (target === undefined) {
      process.stderr.write('verify-licenses: --notices requires a file path\n')
      process.exit(1)
    }
    writeFileSync(join(packageRoot, target), expectedNotices)
  } else {
    const committedNotices = existsSync(noticesPath) ? readFileSync(noticesPath, 'utf8') : undefined
    if (committedNotices !== expectedNotices) {
      process.stderr.write(`${noticesDriftError()}\n`)
      process.exit(1)
    }
  }

  const noticeRequirementsInUse = noticeRequirements(manifests)
  const summary = noticeRequirementsInUse.entries.length === 0
    ? `verify-licenses: ${total} production packages carry redistribution-safe licenses`
    : `verify-licenses: ${total} production packages checked; ${noticeRequirementsInUse.entries.length} use notice-required licenses (${noticeRequirementsInUse.licenses.join(', ')})`
  process.stdout.write(`${summary}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) main()
