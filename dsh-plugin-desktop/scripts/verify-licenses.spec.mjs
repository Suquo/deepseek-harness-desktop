import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLockDescriptorIndex,
  includesLockedOptional,
  noticesDriftError,
  renderNotices,
  resolveLockedPackage,
  targetsSupportedPlatform,
} from './verify-licenses.mjs'

test('selects every supported OS and CPU pair independent of the host', () => {
  for (const os of ['darwin', 'linux', 'win32']) {
    for (const cpu of ['arm64', 'x64']) {
      assert.equal(targetsSupportedPlatform(`os=${os} & cpu=${cpu}`), true, `${os}/${cpu}`)
    }
  }
  assert.equal(targetsSupportedPlatform('os=linux & cpu=x64 & libc=musl'), true)
  assert.equal(targetsSupportedPlatform('os=linux & cpu=arm64 & libc=glibc'), true)
  assert.equal(targetsSupportedPlatform('os=win32 & cpu=ia32'), false)
  assert.equal(targetsSupportedPlatform('os=linux & cpu=riscv64'), false)
  assert.equal(targetsSupportedPlatform('os=freebsd & cpu=x64'), false)
  assert.equal(targetsSupportedPlatform('cpu=wasm32'), false)
  assert.equal(includesLockedOptional({ conditions: 'os=win32 & cpu=ia32' }), false)
  assert.equal(includesLockedOptional({}), true)
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
