import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createLockDescriptorIndex,
  includesLockedOptional,
  noticesDriftError,
  readLockedPackageArchives,
  ReleaseMatrixConfigurationError,
  renderNotices,
  resolveReleaseMatrix,
  resolveLockedPackage,
  targetsSupportedPlatform,
} from './verify-licenses.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('resolves the fork release declaration and fences explicit build architectures', () => {
  assert.equal(
    manifest.dshReleaseMatrixComment,
    'Fork-declared distribution set: macOS universal releases, Windows configured installer arches, and Linux x64/arm64 glibc development builds.',
  )
  assert.deepEqual(resolveReleaseMatrix(manifest), [
    { os: 'darwin', cpu: 'x64' },
    { os: 'darwin', cpu: 'arm64' },
    { os: 'win32', cpu: 'x64' },
    { os: 'linux', cpu: 'x64', libc: 'glibc' },
    { os: 'linux', cpu: 'arm64', libc: 'glibc' },
  ])

  assert.equal(targetsSupportedPlatform('os=darwin & cpu=arm64'), true)
  assert.equal(targetsSupportedPlatform('os=darwin & cpu=x64'), true)
  assert.equal(targetsSupportedPlatform('os=win32 & cpu=x64'), true)
  assert.equal(targetsSupportedPlatform('os=win32 & cpu=arm64'), false)
  assert.equal(targetsSupportedPlatform('os=linux & cpu=arm64 & libc=glibc'), true)
  assert.equal(targetsSupportedPlatform('os=linux & cpu=x64 & libc=musl'), false)
  assert.equal(targetsSupportedPlatform('os=win32 & cpu=ia32'), false)
  assert.equal(targetsSupportedPlatform('os=linux & cpu=riscv64'), false)
  assert.equal(targetsSupportedPlatform('os=freebsd & cpu=x64'), false)
  assert.equal(targetsSupportedPlatform('cpu=wasm32'), false)
  assert.equal(includesLockedOptional({ conditions: 'os=win32 & cpu=ia32' }), false)
  assert.equal(includesLockedOptional({}), true)
})

function singlePlatformManifest(target, cpu = ['x64']) {
  return {
    dshReleaseMatrix: [{ os: 'win32', cpu }],
    build: { win: { target } },
  }
}

for (const [shape, target] of [
  ['string target', 'nsis'],
  ['array-of-strings target', ['nsis', 'zip']],
  ['object target without arch', { target: 'nsis' }],
  ['array object target without arch', [{ target: 'nsis' }]],
  ['object target with array arch', { target: 'nsis', arch: ['x64'] }],
  ['object target with string arch', { target: 'nsis', arch: 'x64' }],
  ['string target with arch suffix', 'nsis:x64'],
]) {
  test(`accepts the documented Electron Builder ${shape}`, () => {
    assert.deepEqual(resolveReleaseMatrix(singlePlatformManifest(target)), [
      { os: 'win32', cpu: 'x64' },
    ])
  })
}

function assertMatrixError(manifestFixture, message) {
  assert.throws(
    () => resolveReleaseMatrix(manifestFixture),
    {
      name: ReleaseMatrixConfigurationError.name,
      message: `dsh-plugin-desktop: invalid dshReleaseMatrix/build configuration: ${message}`,
    },
  )
}

test('fails closed when build is absent', () => {
  assertMatrixError(
    { dshReleaseMatrix: [{ os: 'win32', cpu: ['x64'] }] },
    'build must be an object',
  )
})

test('fails closed when a declared platform section is absent', () => {
  assertMatrixError(
    { dshReleaseMatrix: [{ os: 'win32', cpu: ['x64'] }], build: {} },
    'dshReleaseMatrix declares win32 but build.win is missing',
  )
})

test('fails closed when a declared platform has no target', () => {
  assertMatrixError(
    { dshReleaseMatrix: [{ os: 'win32', cpu: ['x64'] }], build: { win: {} } },
    'build.win.target is required for declared win32',
  )
})

test('fails closed when a build target has no declaration', () => {
  assertMatrixError(
    {
      dshReleaseMatrix: [{ os: 'win32', cpu: ['x64'] }],
      build: { win: { target: 'nsis' }, mac: { target: 'dir' } },
    },
    'build.mac has targets but dshReleaseMatrix does not declare darwin',
  )
})

test('fails closed on an unrecognized target shape', () => {
  assertMatrixError(
    singlePlatformManifest(42),
    'build.win.target[0] must be a target name or target object',
  )
})

test('fails closed on an empty target list', () => {
  assertMatrixError(
    singlePlatformManifest([]),
    'build.win.target must not be empty',
  )
})

test('fails closed when an explicit target architecture disagrees with the declaration', () => {
  assertMatrixError(
    singlePlatformManifest({ target: 'nsis', arch: ['arm64'] }),
    'dshReleaseMatrix win32 CPUs [x64] do not match build.win target "nsis" architectures [arm64]',
  )
})

test('resolves an optional dependency to the exact lockfile record', () => {
  const descriptors = createLockDescriptorIndex(`
__metadata:
  version: 8
"native-darwin@npm:1.2.3, native-darwin@npm:^1.2.0":
  version: 1.2.3
  resolution: "native-darwin@npm:1.2.3"
  conditions: os=darwin & cpu=arm64
`)
  assert.deepEqual(resolveLockedPackage(descriptors, 'native-darwin', '^1.2.0'), {
    version: '1.2.3',
    resolution: 'native-darwin@npm:1.2.3',
    conditions: 'os=darwin & cpu=arm64',
  })
})

test('names notice drift and prints the exact regeneration command', () => {
  assert.equal(
    noticesDriftError(),
    'verify-licenses: THIRD_PARTY_NOTICES.md is out of date\n'
      + 'Regenerate it with: corepack yarn workspace dsh-plugin-desktop verify:notices',
  )
})

test('names a non-zero locked archive metadata fetch', () => {
  assert.throws(
    () => readLockedPackageArchives([
      { name: 'native-linux', record: { resolution: 'native-linux@npm:1.2.3' } },
    ], {
      yarnCommand: () => ({ command: 'yarn', prefix: [] }),
      spawnSync: () => ({ status: 1, stderr: 'cache unavailable\n', stdout: '' }),
    }),
    new Error('Yarn could not read locked optional package metadata: cache unavailable'),
  )
})

test('sorts notice rows by codepoint rather than locale', () => {
  const notices = renderNotices([
    { name: 'a-package', version: '1.0.0', license: 'MIT' },
    { name: 'B-package', version: '1.0.0', license: 'MIT' },
  ])
  assert.equal(
    notices,
    [
      '# Third-Party Notices',
      'DSH Desktop distributes the following third-party packages inside its installers.',
      'Each package ships with its own license text in the application files; this list records',
      'the package names, versions, and licenses for transparency.',
      '| Package | Version | License |',
      '| --- | --- | --- |',
      '| B-package | 1.0.0 | MIT |',
      '| a-package | 1.0.0 | MIT |',
    ].join('\n'),
  )
})

test('retains sharp LGPL attribution in generated notices', () => {
  const notices = renderNotices([
    { name: '@img/sharp-win32-x64', version: '0.35.3', license: 'Apache-2.0 AND LGPL-3.0-or-later' },
    { name: '@img/sharp-libvips-darwin-x64', version: '1.3.2', license: 'LGPL-3.0-or-later' },
  ])
  assert.equal(
    notices,
    [
      '# Third-Party Notices',
      'DSH Desktop distributes the following third-party packages inside its installers.',
      'Each package ships with its own license text in the application files; this list records',
      'the package names, versions, and licenses for transparency.',
      '| Package | Version | License |',
      '| --- | --- | --- |',
      '| @img/sharp-libvips-darwin-x64 | 1.3.2 | LGPL-3.0-or-later |',
      '| @img/sharp-win32-x64 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later |',
      '> Notice-required licenses in use: LGPL-3.0-or-later, Apache-2.0 AND LGPL-3.0-or-later. Their license texts ship inside node_modules; see the package LICENSE files for the full terms.',
    ].join('\n'),
  )
})
