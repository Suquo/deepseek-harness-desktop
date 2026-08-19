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
  indexRows,
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

describe('the `permission` restatement', () => {
  const bundlePresets = bundles.get('permission').config.presets
  const ourPresets = patched.get('permission').config.presets

  it('replaces the whole config, so `presets` is the only key on either side', () => {
    // The bundle row carries `presets` alone. If a future pin gives it a
    // second key — `defaultPreset`, a label table, anything — this patch would
    // silently discard it, which is what this assertion turns into a red gate
    // rather than a boot-time surprise.
    assert.deepEqual(Object.keys(bundles.get('permission').config), ['presets'])
    assert.deepEqual(Object.keys(patched.get('permission').config), ['presets'])
  })

  it('carries every shipped preset forward with its exact bundled meaning', () => {
    // Direction one: nothing the bundle shipped may be dropped or reshaped by
    // the restatement. Compared per entry rather than as one object so a
    // failure names the preset that changed.
    for (const [name, spec] of Object.entries(bundlePresets)) {
      assert.ok(Object.hasOwn(ourPresets, name), `the restatement drops the shipped preset "${name}"`)
      assert.ok(
        sameValue(ourPresets[name], spec),
        `the restatement changes the shipped preset "${name}":\n`
        + `  ours:   ${JSON.stringify(ourPresets[name])}\n`
        + `  bundle: ${JSON.stringify(spec)}`,
      )
    }
  })

  it('adds exactly one preset of its own', () => {
    // Direction two: an entry that appears here without appearing in this list
    // is a permission surface nobody reviewed.
    const added = Object.keys(ourPresets).filter(name => !Object.hasOwn(bundlePresets, name))
    assert.deepEqual(added, ['parametria-capture'])
  })

  it('gives that preset full file access with the approval channel LEFT ON', () => {
    // The whole point of the row. `danger-full-access` alone would be the
    // shipped preset the live run already selected; `approval: ask` is the
    // difference, and the shipped entry's `never` is what told that run's model
    // not to request a per-call escalation at all.
    assert.ok(sameValue(ourPresets['parametria-capture'], {
      sandbox: 'danger-full-access',
      approval: 'ask',
    }))
    assert.notEqual(ourPresets['parametria-capture'].approval, 'never')
  })

  it('is the same preset name the persona tells the run to ask for', () => {
    // The two halves of this fix live in different files: the profile patch
    // declares the entry, the preset's persona tells the model to ask the user
    // for it by name. Renaming either alone leaves a persona pointing at a
    // preset that does not exist — a dead instruction the model would follow
    // into an unknown-preset error, and nothing else here would notice.
    const persona = indexRows(readComposition(join(PACKAGE_ROOT, 'preset', 'agent.cordis.yml')))
      .get('persona').config.text
    const added = Object.keys(ourPresets).filter(name => !Object.hasOwn(bundlePresets, name))
    for (const name of added) {
      assert.ok(
        persona.includes(`\`${name}\` permission preset`),
        `the profile adds the preset "${name}" but the persona never names it, so the run cannot ask for it`,
      )
    }
  })

  it('does not become the default: exactly one entry matches the composed pair', () => {
    // `defaultPreset` is absent on both sides, so the plugin infers it — and
    // `derive()` returns the FIRST entry matching (sandbox, approval), so a new
    // entry sharing the composed pair and declared earlier would silently
    // become the boot default. The composed pair is workspace-write + ask:
    // `sandbox-policy` mode and `approval` policy both key off the same
    // DSH_PERMISSION_MODE expression, whose fallback is workspace-write.
    assert.equal(bundles.get('permission').config.defaultPreset, undefined)
    assert.equal(patched.get('permission').config.defaultPreset, undefined)
    assert.equal(
      bundles.get('approval').config.policy.source,
      "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'",
    )
    const matching = Object.entries(ourPresets)
      .filter(([, spec]) => spec.sandbox === 'workspace-write' && spec.approval === 'ask')
      .map(([name]) => name)
    assert.deepEqual(matching, ['workspace-write'])
  })
})

describe('capabilities the README says the base composition already provides', () => {
  // Each of these is why the patch layer stays as small as it is. The README
  // states them as reasons for NOT configuring something, which makes each one
  // a checkable claim rather than a comment.
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
