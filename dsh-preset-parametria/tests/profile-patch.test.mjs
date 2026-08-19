/**
 * Fences over the profile the installer materializes into `$DSH_HOME`.
 *
 * Two hazards drive these. First, an id-targeted patch REPLACES the named
 * row's whole config — no deep merge — so a bundle field this patch forgets to
 * restate is silently dropped at boot. Second, the desktop launcher owns its
 * own bundle and rejects a profile that lists it. Both are checked against the
 * pinned upstream rather than against a comment.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PACKAGE_ROOT,
  composeBundles,
  readComposition,
  sameValue,
  webProfileBundlePatches,
} from './helpers.mjs'

const PROFILE_DIR = join(PACKAGE_ROOT, 'profile')
const manifest = JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'))
const patchEntries = readComposition(join(PROFILE_DIR, 'cordis.patch.yml'))
const bundles = composeBundles(webProfileBundlePatches())
const patched = new Map(patchEntries.filter(entry => typeof entry?.id === 'string').map(entry => [entry.id, entry]))

describe('the profile manifest', () => {
  it('is named the way `initProfile` names a profile directory', () => {
    assert.equal(manifest.name, 'dsh-profile-parametria')
    assert.equal(manifest.private, true)
  })

  it('declares base then web-app, which is what makes the profile web-capable', () => {
    // `existingProfile` marks a profile web-capable only when dsh-base is
    // present and dsh-web-app comes after it; a desktop launch over a profile
    // that is not web-capable has no client to layer its shell on.
    assert.deepEqual(manifest.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])
  })

  it('does not list the launcher-owned desktop bundle', () => {
    // Any profile other than `desktop` naming `dsh-plugin-desktop` is reported
    // with a `problem` and cannot be selected at all.
    assert.ok(!manifest.dsh.profile.bundles.includes('dsh-plugin-desktop'))
  })

  it('brings no out-of-tree plugin dependencies of its own', () => {
    assert.deepEqual(manifest.dependencies, {})
  })
})

describe('the patch layer', () => {
  it('is a top-level list, which is the only shape the loader accepts', () => {
    // An empty or comments-only patch file throws at boot rather than parsing
    // to an empty layer, so the file must always hold a real list.
    assert.ok(Array.isArray(patchEntries))
    assert.ok(patchEntries.length > 0)
  })

  it('targets only rows the composed bundles actually provide', () => {
    // A patch naming an absent id is a stderr warning at boot and nothing
    // else — the intended change simply never happens.
    for (const id of patched.keys()) {
      assert.ok(bundles.has(id), `patch targets row ${id}, which the composed bundles do not provide`)
    }
  })

  it('inserts nothing: every capability this profile needs is already composed', () => {
    // Notably `dsh-session-stats`, which the harness research listed as absent
    // from the default composition: the `dsh-web-app` bundle mounts it, and
    // this profile builds on that bundle, so per-step timing is available
    // without an insert. The assertion is what keeps that claim true.
    assert.deepEqual(patchEntries.filter(entry => entry?.insert !== undefined), [])
    assert.ok(bundles.has('session-stats'), 'dsh-web-app no longer mounts session-stats; per-step timing would be lost')
  })
})

describe('the `agent-presets` restatement', () => {
  it('restates every field the bundle layer set, because a patch replaces the whole config', () => {
    const bundleConfig = bundles.get('agent-presets').config ?? {}
    const ourConfig = patched.get('agent-presets').config
    assert.deepEqual(
      Object.keys(ourConfig).sort(), Object.keys(bundleConfig).sort(),
      'the patch drops or adds a config key relative to the bundle row it replaces',
    )
  })

  it('boots the parametria preset by default', () => {
    assert.equal(patched.get('agent-presets').config.default, 'parametria')
  })

  it('leaves the user preset root scanned, which is where the installer puts the preset', () => {
    // `includeUserRoot` is the plugin's own schema default; naming it here
    // would be the only way to turn `$DSH_HOME/.agent-presets` off, and the
    // installed preset would then be invisible.
    assert.equal(patched.get('agent-presets').config.includeUserRoot, undefined)
    assert.equal(bundles.get('agent-presets').config.includeUserRoot, undefined)
  })
})

describe('the `llm-pi-ai` restatement', () => {
  it('replaces a bundle row that carries no config, so nothing is dropped', () => {
    // dsh-base mounts the adapter dormant. If a future pin gives that row a
    // config, this patch would silently discard it — which is what this
    // assertion turns into a failed gate.
    assert.equal(bundles.get('llm-pi-ai').config, undefined)
  })

  it('adds the validator route without touching the operator\'s own routes', () => {
    const providers = patched.get('llm-pi-ai').config.providers
    assert.deepEqual(Object.keys(providers), ['parametria-vision'])
  })
})

describe('capabilities the README says the base composition already provides', () => {
  // Each of these is why the patch layer stays as small as it is. The README
  // states them as reasons for NOT configuring something, which makes each one
  // a checkable claim rather than a comment.
  it('already composes the permission presets, so the profile adds none', () => {
    assert.deepEqual(Object.keys(bundles.get('permission').config.presets).sort(), [
      'danger-full-access', 'read-only', 'workspace-write',
    ])
  })

  it('already defaults the sandbox to workspace-write at the session\'s own root', () => {
    assert.equal(bundles.get('sandbox-policy').config.mode.source, "process.env.DSH_PERMISSION_MODE ?? 'workspace-write'")
    assert.equal(bundles.get('sandbox-policy').config.workspaceRoot.source, 'process.cwd()')
  })

  it('already composes a shell tool on every platform', () => {
    // The skill drives node/uv/playwright through the shell; command-level
    // policy is a tools/pre-execute plugin, not composition.
    assert.ok(bundles.has('tool-bash'))
    assert.ok(bundles.has('tool-pwsh'))
  })
})

describe('the session default model', () => {
  it('is deliberately left at the bundle default', () => {
    // Issue #1's acceptance criterion is that a run whose MAIN model is
    // text-only still produces successful subagent image reads. Pinning a
    // vision model for the session here would make that untestable.
    assert.equal(patched.has('agent-default-model'), false)
    assert.ok(sameValue(bundles.get('agent-default-model').config, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    }), 'the bundle default changed; re-read the deferral reasoning in cordis.patch.yml')
  })
})
