/**
 * Exhaustive two-direction drift fence between the `parametria` preset and the
 * shipped `standard` preset it was copied from.
 *
 * Authoring a preset means copying a shipped composition and editing the copy
 * — the shipped install belongs to the deployment and an upgrade overwrites
 * it. The cost of a copy is that upstream moves and the copy does not. This
 * fence pays that cost: every row, every row name, and every row config is
 * compared in BOTH directions against the pinned upstream, and the only
 * permitted differences are the ones DECLARED below. A row added, removed, or
 * reconfigured upstream fails here naming itself, and so does an undeclared
 * local edit.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PACKAGE_ROOT,
  UPSTREAM_ROOT,
  indexRows,
  readComposition,
  rowConfig,
  sameValue,
} from './helpers.mjs'

const PRESET_DIR = join(PACKAGE_ROOT, 'preset')
const UPSTREAM_STANDARD = join(
  UPSTREAM_ROOT, 'apps', 'cli', 'config', 'agent-presets', 'standard', 'agent.cordis.yml',
)

/**
 * The complete, closed declaration of how `parametria` differs from
 * `standard`. Every entry names the reason, because a delta without one is
 * indistinguishable from drift someone forgot to reconcile.
 */
const DECLARED_DELTA = {
  /** Rows this preset adds. Key = flattened row id, value = the reason. */
  added: {
    'delegation/tool-subagent-validator':
      'issue #1: a second delegation instance pinned to the vision route, because child '
      + 'model policy is per-instance and per-call model selection does not exist',
  },
  /** Rows this preset drops. Empty on purpose: parity with `standard` is the point. */
  removed: {},
  /** Rows kept, with a different config. Key = flattened row id, value = the reason. */
  reconfigured: {
    persona:
      'the run states its own shape: load the skill, delegate visual checks to '
      + 'subagent_validator rather than subagent, and meet the two sandbox facts this '
      + 'host has (workspace-local uv cache; per-call escalation for the screenshot script)',
    'skill-filesystem':
      'preset-local skill root (`customSkillDirs`) so the skill travels with the preset '
      + 'and registers into this preset\'s nearer registry layer',
  },
}

const ours = indexRows(readComposition(join(PRESET_DIR, 'agent.cordis.yml')))
const upstream = indexRows(readComposition(UPSTREAM_STANDARD))

describe('parametria preset vs the pinned upstream `standard` preset', () => {
  it('adds exactly the declared rows', () => {
    const added = [...ours.keys()].filter(id => !upstream.has(id)).sort()
    assert.deepEqual(added, Object.keys(DECLARED_DELTA.added).sort())
  })

  it('drops exactly the declared rows', () => {
    const removed = [...upstream.keys()].filter(id => !ours.has(id)).sort()
    assert.deepEqual(removed, Object.keys(DECLARED_DELTA.removed).sort())
  })

  it('reconfigures exactly the declared rows and no others', () => {
    const reconfigured = []
    for (const [id, row] of ours) {
      const other = upstream.get(id)
      if (other === undefined) continue
      if (!sameValue(rowConfig(row), rowConfig(other))) reconfigured.push(id)
    }
    assert.deepEqual(reconfigured.sort(), Object.keys(DECLARED_DELTA.reconfigured).sort())
  })

  it('states WHAT each reconfigured row became, not merely that it differs', () => {
    // Knowing which rows differ is only half a fence: without this, a second
    // accidental edit to an already-declared row would still pass.
    const persona = ours.get('persona').config.text
    assert.match(persona, /subagent_validator/, 'the persona must route visual checks to the validator')
    assert.match(persona, /suquo-systems-parametria/, 'the persona must name the skill the run depends on')
    // The sandbox half of issue #9 item 1. Composition cannot inject a
    // non-`DSH_*` variable into a shell call and the sandbox seam has no
    // extra-writable-root vocabulary, so these two facts reach the run as
    // persona text or not at all — which makes their presence a fence, not a
    // style preference. The live run rediscovered both by trial (two denied uv
    // cache locations, then a denied Playwright driver spawn).
    //
    // Matched as the WHOLE instruction rather than by keyword. A bare
    // /UV_CACHE_DIR/ still matches a persona that misspells the variable or
    // relocates the cache back outside the workspace — both of which reinstate
    // the exact denial this text exists to prevent, while the fence stays
    // green. The assignment is what the model has to emit, so the assignment is
    // what gets pinned.
    assert.ok(
      persona.includes('$env:UV_CACHE_DIR = "$PWD\\.uv-cache"'),
      'the persona must state the workspace-local uv cache assignment verbatim: '
      + 'the default cache and any absolute path outside the session workspace are denied under workspace-write',
    )
    // Anchored on the instruction for the same reason as the line above, and
    // this one has a sharper failure mode: the `approval: never` policy teaches
    // the model the exact INVERSE sentence ("do not request sandbox
    // escalation — do not set `sandbox_permissions`"), so a persona that
    // drifted into forbidding the escalation would keep a bare
    // /sandbox_permissions/ green while reinstating the failure this text
    // exists to prevent.
    assert.ok(
      persona.includes('retry that exact command once with `sandbox_permissions: danger-full-access`'),
      'the persona must INSTRUCT the per-call escalation, naming the one wider mode above workspace-write — '
      + 'it is the narrowest path past the one refusal that has no relocation answer',
    )
    // The whole-run alternative is a durable claim on full file access whose
    // only in-session release is a human switching back, so the sentence that
    // asks for the switch-back is load-bearing rather than courtesy — and it is
    // the stopgap the profile patch's release paragraph explicitly leans on for
    // the case neither upstream release covers.
    assert.ok(
      persona.includes('switch back to `workspace-write`'),
      'the persona must have the run ask for the switch-back once the capture phase ends: it is the only '
      + 'release reaching the person who made the selection',
    )
    assert.deepEqual(Object.keys(ours.get('skill-filesystem').config), ['customSkillDirs'])
  })

  it('keeps the shared rows in upstream order, so a moved row is visible', () => {
    // `indexRows` keys a nested row by `<group>/<row>`, so a row that moves
    // between the top level and a group is already reported as one added and
    // one dropped. What is left to catch is reordering WITHIN a level, which
    // this comparison of the shared subsequence covers.
    const shared = [...ours.keys()].filter(id => upstream.has(id))
    const upstreamShared = [...upstream.keys()].filter(id => ours.has(id))
    assert.deepEqual(shared, upstreamShared)
  })

  it('keeps every shared row identical to upstream outside its config', () => {
    // Compare the WHOLE row minus `config`, rather than enumerating
    // name/disabled/group/isolate. An enumerated list is a CLOSED key set: an
    // upstream row that gains a new top-level key — `when:`, `optional:`, some
    // future loader field — would drift in silently, because nothing looks at
    // the keys nobody thought to name. `config` is excluded here only because
    // the two assertions above own it.
    for (const [id, row] of ours) {
      const other = upstream.get(id)
      if (other === undefined) continue
      const { config: _ourConfig, ...ourRest } = row
      const { config: _upstreamConfig, ...upstreamRest } = other
      assert.ok(
        sameValue(ourRest, upstreamRest),
        `row ${id} differs from upstream outside its config:\n`
        + `  ours:     ${JSON.stringify(ourRest)}\n`
        + `  upstream: ${JSON.stringify(upstreamRest)}`,
      )
    }
  })

  it('states a reason for every declared difference', () => {
    for (const section of Object.values(DECLARED_DELTA)) {
      for (const [id, reason] of Object.entries(section)) {
        assert.ok(
          typeof reason === 'string' && reason.length > 20,
          `declared delta ${id} carries no usable reason`,
        )
      }
    }
  })
})

describe('the vision-pinned validator row', () => {
  const row = ours.get('delegation/tool-subagent-validator')

  it('is a second `dsh-tool-subagent` instance with its own tool name', () => {
    assert.equal(row.name, '@deepseek-ai/dsh-tool-subagent')
    assert.equal(row.config.toolName, 'subagent_validator')
    const names = [...ours.values()]
      .filter(other => other.name === '@deepseek-ai/dsh-tool-subagent')
      .map(other => other.config.toolName)
    assert.equal(new Set(names).size, names.length, 'each tool-subagent instance needs a distinct toolName')
  })

  it('pins the route and model explicitly rather than inheriting the session model', () => {
    assert.deepEqual(row.config.agentOptions, {
      provider: 'parametria-vision',
      model: 'google/gemini-3.6-flash',
    })
  })

  it('states its own delegation cap rather than inheriting upstream\'s default', () => {
    // Presence only. The VALUE is derived from upstream's own depth arithmetic
    // in `validator-depth.test.mjs`, which owns that claim whole: a literal
    // re-asserted here is exactly how this row shipped — and how a fence came
    // to certify — a cap that refused the delegation the persona mandates
    // (issue #18).
    assert.ok(
      Object.hasOwn(row.config, 'maxDepth'),
      'the validator row must state a depth cap; omitting it silently takes upstream\'s default of 3',
    )
  })

  it('runs one-shot, so the parent waits for the verdict', () => {
    assert.equal(row.config.backgroundMode, 'one-shot')
  })

  it('is the only tool-subagent row that pins a model', () => {
    for (const [id, other] of ours) {
      if (other.name !== '@deepseek-ai/dsh-tool-subagent') continue
      if (id === 'delegation/tool-subagent-validator') continue
      assert.equal(
        other.config.agentOptions, undefined,
        `row ${id} pins a model; only the validator may, or a plain delegate would stop inheriting the session model`,
      )
    }
  })
})

describe('the preset-local skill root', () => {
  it('is mounted from the preset directory, not an absolute path', () => {
    const dirs = ours.get('skill-filesystem').config.customSkillDirs
    assert.equal(dirs.length, 1)
    assert.match(dirs[0].source, /new URL\('skills\/', baseUrl\)/)
  })

  it('ships empty, so it cannot shadow the operator\'s installed skill', () => {
    // The preset layer is nearer than the deployment's, and the nearest layer
    // wins duplicates outright. A placeholder SKILL.md under the real skill's
    // name would therefore REPLACE the working skill with a stub. Issue #7
    // migrates the canonical copy in here; until then the root stays empty.
    const entries = readdirSync(join(PRESET_DIR, 'skills'), { withFileTypes: true })
    const skills = entries.filter(entry => entry.isDirectory() || entry.name.toLowerCase().endsWith('.md'))
    assert.deepEqual(
      skills.map(entry => entry.name), [],
      'the preset-local skill root must stay empty until issue #7 migrates the canonical skill',
    )
  })
})
