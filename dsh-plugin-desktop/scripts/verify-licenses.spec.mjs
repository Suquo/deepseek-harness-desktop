import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLockDescriptorIndex,
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
  ])
  assert.match(notices, /\| @img\/sharp-win32-x64 \| 0\.35\.3 \| Apache-2\.0 AND LGPL-3\.0-or-later \|/u)
  assert.match(notices, /> Notice-required licenses in use: Apache-2\.0 AND LGPL-3\.0-or-later\./u)
})
