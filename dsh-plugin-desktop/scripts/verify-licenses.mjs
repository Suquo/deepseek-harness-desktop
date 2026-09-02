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

const BUILD_PLATFORM_OSES = [
  ['mac', 'darwin'],
  ['win', 'win32'],
  ['linux', 'linux'],
]
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

/** Named configuration failure: an unknown shape must never shrink notices cleanly. */
export class ReleaseMatrixConfigurationError extends Error {
  constructor(message) {
    super(`dsh-plugin-desktop: invalid dshReleaseMatrix/build configuration: ${message}`)
    this.name = 'ReleaseMatrixConfigurationError'
  }
}

function releaseMatrixError(message) {
  throw new ReleaseMatrixConfigurationError(message)
}

/** Normalize every documented Electron Builder target shape without guessing an arch. */
function normalizeBuildTargets(value, label) {
  const targets = Array.isArray(value) ? value : [value]
  if (targets.length === 0) releaseMatrixError(`${label} must not be empty`)
  return targets.map((target, index) => {
    const targetLabel = `${label}[${String(index)}]`
    const normalized = typeof target === 'string' ? { target } : target
    if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)
      || typeof normalized.target !== 'string' || normalized.target.length === 0) {
      return releaseMatrixError(`${targetLabel} must be a target name or target object`)
    }
    let name = normalized.target
    let arch = normalized.arch
    const suffixPosition = name.lastIndexOf(':')
    if (suffixPosition > 0) {
      if (arch === undefined) arch = name.slice(suffixPosition + 1)
      name = name.slice(0, suffixPosition)
    }
    if (arch === undefined) return { name }
    const architectures = Array.isArray(arch) ? arch : [arch]
    if (architectures.length === 0
      || architectures.some((architecture) => typeof architecture !== 'string' || architecture.length === 0)) {
      return releaseMatrixError(`${targetLabel}.arch must be a non-empty architecture or array`)
    }
    return { name, architectures: [...new Set(architectures)] }
  })
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

/** Resolve the fork declaration after fencing it in both directions against build targets. */
export function resolveReleaseMatrix(manifest) {
  const declaration = manifest?.dshReleaseMatrix
  if (!Array.isArray(declaration) || declaration.length === 0) {
    return releaseMatrixError('dshReleaseMatrix must be a non-empty array')
  }
  const build = manifest?.build
  if (typeof build !== 'object' || build === null || Array.isArray(build)) {
    return releaseMatrixError('build must be an object')
  }

  const buildKeyByOs = new Map(BUILD_PLATFORM_OSES.map(([buildKey, os]) => [os, buildKey]))
  const declaredByOs = new Map()
  for (const [index, entry] of declaration.entries()) {
    const label = `dshReleaseMatrix[${String(index)}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return releaseMatrixError(`${label} must be an object`)
    }
    if (typeof entry.os !== 'string' || !buildKeyByOs.has(entry.os)) {
      return releaseMatrixError(`${label}.os must be one of darwin, win32, linux`)
    }
    if (declaredByOs.has(entry.os)) {
      return releaseMatrixError(`dshReleaseMatrix declares ${entry.os} more than once`)
    }
    if (!Array.isArray(entry.cpu) || entry.cpu.length === 0
      || entry.cpu.some((cpu) => typeof cpu !== 'string' || cpu.length === 0)
      || new Set(entry.cpu).size !== entry.cpu.length) {
      return releaseMatrixError(`${label}.cpu must be a non-empty array of unique architectures`)
    }
    if (entry.os === 'linux') {
      if (typeof entry.libc !== 'string' || entry.libc.length === 0) {
        return releaseMatrixError(`${label}.libc must name the declared Linux libc`)
      }
    } else if (entry.libc !== undefined) {
      return releaseMatrixError(`${label}.libc is only valid for Linux`)
    }
    declaredByOs.set(entry.os, entry)
  }

  for (const [buildKey, os] of BUILD_PLATFORM_OSES) {
    const hasSection = Object.hasOwn(build, buildKey)
    const section = build[buildKey]
    const declared = declaredByOs.get(os)
    if (!hasSection) {
      if (declared !== undefined) {
        return releaseMatrixError(`dshReleaseMatrix declares ${os} but build.${buildKey} is missing`)
      }
      continue
    }
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      return releaseMatrixError(`build.${buildKey} must be an object when present`)
    }
    if (!Object.hasOwn(section, 'target')) {
      return releaseMatrixError(`build.${buildKey}.target is required when build.${buildKey} is present`)
    }
    const targets = normalizeBuildTargets(section.target, `build.${buildKey}.target`)
    if (declared === undefined) {
      return releaseMatrixError(`build.${buildKey} has targets but dshReleaseMatrix does not declare ${os}`)
    }
    for (const target of targets) {
      if (target.architectures !== undefined && !sameStringSet(target.architectures, declared.cpu)) {
        return releaseMatrixError(
          `dshReleaseMatrix ${os} CPUs [${declared.cpu.join(', ')}] do not match build.${buildKey} target ${JSON.stringify(target.name)} architectures [${target.architectures.join(', ')}]`,
        )
      }
    }
  }

  return declaration.flatMap((entry) => entry.cpu.map((cpu) => {
    const platform = { os: entry.os, cpu }
    if (entry.libc !== undefined) platform.libc = entry.libc
    return platform
  }))
}

const supportedPlatforms = resolveReleaseMatrix(rootManifest)

/** Return true when a Yarn condition can ship in the configured release matrix. */
export function targetsSupportedPlatform(condition, platforms = supportedPlatforms) {
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
  const libc = terms.get('libc')
  return os !== undefined && platforms.some((platform) => platform.os === os
    && (cpu === undefined || platform.cpu === cpu)
    && (libc === undefined || platform.libc === libc))
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
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
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
export function readLockedPackageArchives(requests, options = {}) {
  const locators = [...new Set(requests.map((request) => request.record.resolution))]
  const { command, prefix } = options.yarnCommand?.() ?? yarnCommand()
  const result = (options.spawnSync ?? spawnSync)(command, [
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
          let installed
          if (record === undefined) {
            if (section === 'dependencies') installed = installedPackage(name, current.manifestPath)
            if (installed === undefined) {
              failures.push(`${current.name} -> ${name}: absent package has no matching yarn.lock entry`)
              continue
            }
          }
          if (section === 'optionalDependencies' && !includesLockedOptional(record)) continue
          installed ??= installedPackage(name, current.manifestPath)
          if (installed !== undefined) {
            queued.add(name)
            queue.push(installed)
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
