import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  DEPENDENCY_INSTALL_REMEDY,
  ELECTRON_INSTALL_REMEDY,
  ElectronInstallIntegrityError,
  verifyElectronInstall,
  verifyWorkspaceElectronInstall,
} from './verify-electron-install.mjs'

const fixtures = []

const makeFixture = () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dsh-electron-install-'))
  fixtures.push(fixture)
  return fixture
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true })
  }
})

for (const relativeBinary of [
  'electron',
  'electron.exe',
  'Electron.app/Contents/MacOS/Electron',
]) {
  test(`accepts an installed ${relativeBinary} binary`, () => {
    const electronPackage = makeFixture()
    const binary = join(electronPackage, 'dist', ...relativeBinary.split('/'))
    mkdirSync(join(binary, '..'), { recursive: true })
    writeFileSync(join(electronPackage, 'path.txt'), relativeBinary)
    writeFileSync(binary, '')

    assert.equal(verifyElectronInstall(electronPackage), binary)
  })
}

test('rejects an Electron package with no installation metadata', () => {
  const electronPackage = makeFixture()

  assert.throws(
    () => verifyElectronInstall(electronPackage),
    error => error instanceof ElectronInstallIntegrityError
      && error.name === 'ElectronInstallIntegrityError'
      && error.message.includes('path.txt is missing')
      && error.message.includes(ELECTRON_INSTALL_REMEDY),
  )
})

test('rejects installation metadata whose binary is missing', () => {
  const electronPackage = makeFixture()
  writeFileSync(join(electronPackage, 'path.txt'), 'electron')

  assert.throws(
    () => verifyElectronInstall(electronPackage),
    error => error instanceof ElectronInstallIntegrityError
      && error.message.includes('the referenced binary is missing')
      && error.message.includes(join('dist', 'electron'))
      && error.message.includes(ELECTRON_INSTALL_REMEDY),
  )
})

test('rejects installation metadata that escapes Electron dist', () => {
  const electronPackage = makeFixture()
  writeFileSync(join(electronPackage, 'path.txt'), '../outside-electron')
  writeFileSync(join(electronPackage, 'outside-electron'), '')

  assert.throws(
    () => verifyElectronInstall(electronPackage),
    error => error instanceof ElectronInstallIntegrityError
      && error.message.includes('path.txt points outside dist')
      && error.message.includes(ELECTRON_INSTALL_REMEDY),
  )
})

test('the workspace entry ensures the binary before verifying it', () => {
  const electronPackage = makeFixture()
  const packageJson = join(electronPackage, 'package.json')
  writeFileSync(packageJson, '{}')
  let installCalls = 0

  const binary = verifyWorkspaceElectronInstall({
    resolvePackage: () => packageJson,
    runInstall: (installScript) => {
      installCalls += 1
      assert.equal(installScript, join(electronPackage, 'install.js'))
      mkdirSync(join(electronPackage, 'dist'), { recursive: true })
      writeFileSync(join(electronPackage, 'path.txt'), 'electron')
      writeFileSync(join(electronPackage, 'dist', 'electron'), '')
      return { status: 0 }
    },
  })

  assert.equal(installCalls, 1)
  assert.equal(binary, join(electronPackage, 'dist', 'electron'))
})

test('the workspace entry fails with the named error when ensure leaves the binary unusable', () => {
  const electronPackage = makeFixture()
  const packageJson = join(electronPackage, 'package.json')
  writeFileSync(packageJson, '{}')

  assert.throws(
    () => verifyWorkspaceElectronInstall({
      resolvePackage: () => packageJson,
      runInstall: () => ({ status: 1 }),
    }),
    error => error instanceof ElectronInstallIntegrityError
      && error.message.includes('install.js exited with status 1')
      && error.message.includes(ELECTRON_INSTALL_REMEDY),
  )
})

test('the workspace entry wraps an absent Electron package with the named dependency-install remedy', () => {
  const missing = new Error('Cannot find module electron/package.json')
  missing.code = 'MODULE_NOT_FOUND'

  assert.throws(
    () => verifyWorkspaceElectronInstall({ resolvePackage: () => { throw missing } }),
    error => error instanceof ElectronInstallIntegrityError
      && error.name === 'ElectronInstallIntegrityError'
      && error.message.includes('electron/package.json cannot be resolved')
      && error.message.includes(DEPENDENCY_INSTALL_REMEDY),
  )
})
