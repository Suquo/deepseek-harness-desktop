import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'

/**
 * The shell-mode boundary, snapshotted in BOTH directions.
 *
 * Standard 6 asks drift guards to be exhaustive two-direction snapshots, and
 * until now only one direction existed: `client-brand.spec.ts` pins exactly what
 * compatibility mode registers, so that an advanced effect cannot slip into the
 * compatibility path. Nothing pinned the other side.
 *
 * Issue #36 is exactly the change that makes the gap matter, because it MOVES an
 * effect across the boundary — the cost surface, from advanced-only to both
 * modes. A one-sided snapshot watches effects arrive in compatibility mode and
 * never watches one leave advanced mode, so an edit that dropped the theme
 * presenter or the root slot on the way past would have gone unremarked.
 *
 * This states the boundary itself: what compatibility mode runs, and exactly
 * what advanced mode adds on top of it. Neither list is written out as a literal
 * — both are produced by running `apply` — so the compatibility list still lives
 * in exactly one place, the brand spec that owns it, and no copy here can drift
 * from it.
 *
 * `cost-surface-gating.spec.ts` carries the static half: that the install site is
 * mode-independent, that the surface is additive, and that the four replacing
 * effects are still reached only through the advanced branch.
 */

/** Effects `applyAdvancedShell` adds on top of everything both modes run. */
const ADVANCED_ONLY_EFFECTS = [
  'desktop: layout service',
  'desktop: advanced shell styles',
  'desktop: theme presenter',
  'desktop: advanced root slot',
]

/**
 * Run `apply` for one mode and collect the effect labels it registers.
 *
 * The context records labels without running the effect bodies, which is what
 * makes the advanced arm reachable at all: everything `applyAdvancedShell` needs
 * from the context — the layout service, the theme snapshot, the root slot
 * registration — is used from inside an effect, never from `apply` itself.
 * @param mode - the shell mode to put in the Electron-owned query marker.
 * @returns the effect labels, in registration order.
 */
function effectLabels(mode: 'compatibility' | 'advanced'): string[] {
  vi.stubGlobal('window', { location: { search: `?dsh-desktop-mode=${mode}&dsh-desktop-platform=darwin` } })
  const labels: string[] = []
  const ctx = {
    effect: (_run: () => unknown, label: string) => { labels.push(label) },
    workspaces: { create: vi.fn(), startSession: vi.fn() },
    theme: { getTheme: vi.fn() },
    on: vi.fn(),
    slots: { register: vi.fn(), inject: vi.fn() },
    loader: {},
  } as unknown as ClientContext
  try {
    apply(ctx)
    return labels
  }
  finally {
    vi.unstubAllGlobals()
  }
}

describe('the desktop client shell-mode boundary', () => {
  it('runs every compatibility effect in advanced mode too, in the same order', () => {
    // The direction nothing guarded: advanced mode is compatibility mode PLUS
    // its own composition, never a different set. An effect quietly dropped from
    // the shared prefix — the boot health report, say — reddens here.
    const compatibility = effectLabels('compatibility')
    const advanced = effectLabels('advanced')
    expect(compatibility.length).toBeGreaterThan(0)
    expect(advanced.slice(0, compatibility.length)).toEqual(compatibility)
  })

  it('adds exactly the desktop-composed effects on top, and nothing else', () => {
    // The four that REPLACE upstream presentation. Exhaustive: a fifth advanced
    // effect, or one of these four escaping into the shared prefix, fails here.
    const compatibility = effectLabels('compatibility')
    const advanced = effectLabels('advanced')
    expect(advanced.slice(compatibility.length)).toEqual(ADVANCED_ONLY_EFFECTS)
    for (const advancedOnly of ADVANCED_ONLY_EFFECTS) {
      expect(compatibility, advancedOnly).not.toContain(advancedOnly)
    }
  })

  it('puts the cost surface on the shared side of the boundary', () => {
    // The owner's #36 ruling, stated as the runtime fact it is rather than as a
    // property of where the call happens to sit in the source.
    expect(effectLabels('compatibility')).toContain('dsh-plugin-desktop: turn cost surface')
    expect(effectLabels('advanced')).toContain('dsh-plugin-desktop: turn cost surface')
  })
})
