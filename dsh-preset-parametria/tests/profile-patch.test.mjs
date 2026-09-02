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
  REPO_ROOT,
  composeBundles,
  readComposition,
  sameValue,
  webProfileBundlePatches,
} from './helpers.mjs'

const PROFILE_DIR = join(PACKAGE_ROOT, 'profile')
const manifest = JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'))
// Read the pin rather than restate it. These three are pin surface — they move
// with `upstream.json` on every bump, and `scripts/verify-layout.mjs` holds the
// manifest against `runtimePackageVersion` for exactly that reason. A literal
// here would be a SECOND statement of the same fact, and the half of the bump
// someone forgets; the value of this assertion is the exact package SET, which
// the deepEqual below still fences.
const { runtimePackageVersion } = JSON.parse(
  readFileSync(join(REPO_ROOT, 'upstream.json'), 'utf8'),
)
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

  it('carries exactly the two optional subagent provider bundles', () => {
    // The preset's `subagent_validator` row denies `subagent_codex` and
    // `subagent_claude_code` by NAME, and `tools.restrict()` throws on a name
    // that never registered — so a profile that does not mount these providers
    // loses every validator spawn to a config error (the 2026-08-28 run).
    // Upstream is explicit that a preset cannot provide this host dependency:
    // the PROFILE installs the bundles (this manifest) and mounts them (the
    // insert fence below). Pinned to the harness runtime version, like every
    // other pinned manifest — see `pinSurface` in `scripts/verify-layout.mjs`.
    // `dsh-sdk-protocol` rides along because the subagent bundles import it as
    // a PEER — without the explicit pin the profile boots to
    // ERR_MODULE_NOT_FOUND on the first provider import (hit live 2026-08-28).
    // The desktop profile carries the same three pins for the same reason.
    assert.deepEqual(manifest.dependencies, {
      '@deepseek-ai/dsh-sdk-protocol': runtimePackageVersion,
      '@deepseek-ai/dsh-subagent-claude-code': runtimePackageVersion,
      '@deepseek-ai/dsh-subagent-codex': runtimePackageVersion,
    })
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

  it('changes rows through `config` and nothing else', () => {
    // A patch entry's every key beyond `id`/`name` is copied onto the target
    // row, so `disabled: true`, a `group`, or an `isolate` realm added to one
    // of these entries would unmount or relocate the plugin rather than
    // configure it — with the restatement fences below still passing, because
    // they only ever look inside `config`. A rider from issue #9's sandbox
    // slice: that slice's own row did not survive its ruling, but the hazard it
    // exposed belongs to every patch entry and the fence is one loop.
    for (const [id, entry] of patched) {
      assert.deepEqual(
        Object.keys(entry).sort(), ['config', 'id'],
        `patch entry ${id} carries a key beyond id/config: a patch key is copied onto the target ROW, not merged into its config`,
      )
    }
  })

  it('inserts exactly the two subagent provider rows and nothing else', () => {
    // The provider bundles the manifest installs still need HOST-plane rows to
    // mount — a dependency alone composes nothing. This is the profile-side
    // half of the validator fix (see the manifest fence above): with these
    // rows mounted, the preset's `tool-subagent-codex` / `tool-subagent-
    // claude-code` rows register their tools and the validator's deny list
    // resolves every name it states. Exhaustive in both directions: a third
    // insert appearing here fails, and so does losing either provider row.
    //
    // Everything ELSE the profile needs stays already-composed — notably
    // `dsh-session-stats`, which the `dsh-web-app` bundle mounts; the
    // session-stats assertion is what keeps that claim true.
    assert.deepEqual(
      patchEntries.filter(entry => entry?.insert !== undefined).flatMap(entry => entry.insert),
      [
        { id: 'subagent-codex', name: '@deepseek-ai/dsh-subagent-codex' },
        { id: 'subagent-claude-code', name: '@deepseek-ai/dsh-subagent-claude-code' },
      ],
    )
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

  it('leaves that row alone in the PROFILE layer, where the route no longer lives', () => {
    // The route moved to the machine-wide layer on issue #1's owner ruling —
    // the plane the preset that pins it already sits on. Presence there and
    // absence here are fenced in both directions by
    // `tests/machine-patch.test.mjs`; this is the profile-side half, stated
    // where a reader of the profile patch will look for it.
    assert.equal(patched.get('llm-pi-ai'), undefined)
  })
})

describe('capabilities the README says the base composition already provides', () => {
  // Each of these is why the patch layer stays as small as it is. The README
  // states them as reasons for NOT configuring something, which makes each one
  // a checkable claim rather than a comment.
  it('already composes the permission presets, so the profile adds none', () => {
    // Restated after issue #9 ruled on a proposed fourth entry
    // (`parametria-capture`: danger-full-access + ask, for the Playwright
    // capture pass). The owner rejected it, and the reason is what this
    // assertion now protects rather than mere minimalism: the desktop's
    // full-access risk acknowledgement is gated on the preset KEY, not on the
    // sandbox mode it carries —
    // `packages/client/ui-conversation/src/client/skeleton/PermissionSelect.tsx`
    // declares `const FULL_ACCESS = 'danger-full-access'` and routes only that
    // literal id through its confirmation Modal. ANY added entry carrying
    // `sandbox: danger-full-access` under a different name would therefore
    // reach unconfined file access from the composer's Access chip without the
    // acknowledgement step. So this is a two-part fence: the shipped table is
    // unchanged, and the patch layer does not target the row at all.
    assert.deepEqual(Object.keys(bundles.get('permission').config.presets).sort(), [
      'danger-full-access', 'read-only', 'workspace-write',
    ])
    assert.equal(
      patched.has('permission'), false,
      'the profile patches the permission table: any entry carrying danger-full-access under a non-shipped key '
      + 'bypasses the desktop full-access acknowledgement, which issue #9 ruled against',
    )
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
