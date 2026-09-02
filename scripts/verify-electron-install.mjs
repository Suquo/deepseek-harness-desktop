import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ELECTRON_INSTALL_REMEDY = 'corepack yarn workspace dsh-plugin-desktop exec install-electron'

export class ElectronInstallIntegrityError extends Error {
  constructor(reason) {
    super(
      `Electron binary installation is incomplete: ${reason}. `
      + 'Electron 42+ no longer downloads its binary during dependency installation. '
      + `Remedy: ${ELECTRON_INSTALL_REMEDY}`,
    )
    this.name = 'ElectronInstallIntegrityError'
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

export function resolveElectronPackageDirectory() {
  const root = resolve(import.meta.dirname, '..')
  const requireFromDesktop = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
  return dirname(requireFromDesktop.resolve('electron/package.json'))
}

export function verifyWorkspaceElectronInstall() {
  return verifyElectronInstall(resolveElectronPackageDirectory())
}

const entryPoint = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href

if (import.meta.url === entryPoint) {
  const binary = verifyWorkspaceElectronInstall()
  process.stdout.write(`verify-electron-install: ${binary}\n`)
}
