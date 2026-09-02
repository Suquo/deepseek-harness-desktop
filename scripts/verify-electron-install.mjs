import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ELECTRON_INSTALL_REMEDY = 'corepack yarn workspace dsh-plugin-desktop exec install-electron'
export const DEPENDENCY_INSTALL_REMEDY = 'corepack yarn install --immutable'

export class ElectronInstallIntegrityError extends Error {
  constructor(reason, remedy = ELECTRON_INSTALL_REMEDY) {
    super(`Electron binary installation is incomplete: ${reason}. Remedy: ${remedy}`)
    this.name = 'ElectronInstallIntegrityError'
    this.reason = reason
  }
}

/**
 * Assert that an Electron npm package has the binary selected by its installer.
 * @param {string} electronPackageDirectory absolute path to the Electron package
 * @returns {string} absolute path to the installed Electron executable
 */
export function verifyElectronInstall(electronPackageDirectory) {
  const pathFile = resolve(electronPackageDirectory, 'path.txt')
  let relativeBinary
  try {
    relativeBinary = readFileSync(pathFile, 'utf8').trim()
  } catch {
    throw new ElectronInstallIntegrityError(`${pathFile} (path.txt is missing)`)
  }

  if (relativeBinary === '') {
    throw new ElectronInstallIntegrityError(`${pathFile} is empty`)
  }

  const distDirectory = resolve(electronPackageDirectory, 'dist')
  const binary = resolve(distDirectory, relativeBinary)
  const distRelativeBinary = relative(distDirectory, binary)
  if (isAbsolute(distRelativeBinary) || distRelativeBinary === '..' || distRelativeBinary.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new ElectronInstallIntegrityError(`${pathFile} points outside dist (${relativeBinary})`)
  }

  try {
    if (!statSync(binary).isFile()) throw new Error('not a file')
  } catch {
    throw new ElectronInstallIntegrityError(`${binary} (the referenced binary is missing)`)
  }

  return binary
}

export function resolveElectronPackageDirectory(resolvePackage) {
  const root = resolve(import.meta.dirname, '..')
  const requireFromDesktop = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
  try {
    const packageJson = resolvePackage === undefined
      ? requireFromDesktop.resolve('electron/package.json')
      : resolvePackage()
    return dirname(packageJson)
  } catch {
    throw new ElectronInstallIntegrityError(
      'electron/package.json cannot be resolved from dsh-plugin-desktop',
      DEPENDENCY_INSTALL_REMEDY,
    )
  }
}

const runElectronInstaller = installScript => spawnSync(process.execPath, [installScript], {
  stdio: 'inherit',
})

export function ensureElectronInstall(electronPackageDirectory, runInstall = runElectronInstaller) {
  const installScript = resolve(electronPackageDirectory, 'install.js')
  let installFailure
  try {
    const result = runInstall(installScript)
    if (result?.error !== undefined) {
      installFailure = `install.js could not run (${result.error.message})`
    } else if (result?.status !== 0) {
      installFailure = `install.js exited with status ${result?.status ?? 'unknown'}`
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    installFailure = `install.js could not run (${detail})`
  }

  try {
    return verifyElectronInstall(electronPackageDirectory)
  } catch (error) {
    if (installFailure !== undefined && error instanceof ElectronInstallIntegrityError) {
      throw new ElectronInstallIntegrityError(`${installFailure}; ${error.reason}`)
    }
    throw error
  }
}

export function verifyWorkspaceElectronInstall({ resolvePackage, runInstall } = {}) {
  const electronPackageDirectory = resolveElectronPackageDirectory(resolvePackage)
  return ensureElectronInstall(electronPackageDirectory, runInstall)
}

const entryPoint = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href

if (import.meta.url === entryPoint) {
  const binary = verifyWorkspaceElectronInstall()
  process.stdout.write(`verify-electron-install: ${binary}\n`)
}
