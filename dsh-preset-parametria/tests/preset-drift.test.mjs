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
    'parametria-capture':
      'issue #24: the Host-plane capture tool. A confined process cannot open the named pipe '
      + 'Playwright\'s driver spawn needs, and a delegated child cannot escalate at all, so the '
      + 'capture had to become a capability rather than a sandbox grant. It rides the preset '
      + 'because the preset is what makes it needed: a machine-wide row would work (host tool '
      + 'rows ARE inherited by preset agents) but would enter every profile\'s roster',
  },
  /** Rows this preset drops. Empty on purpose: parity with `standard` is the point. */
  removed: {},
  /** Rows kept, with a different config. Key = flattened row id, value = the reason. */
  reconfigured: {
    persona:
      'the run states its own shape: load the skill, delegate visual checks to '
      + 'subagent_validator rather than subagent, keep every artifact under the workspace-local '
      + '`.parametria-evidence/` run directory, and meet the two sandbox facts this '
      + 'host has (workspace-local uv cache; captures go through `parametria_capture` '
      + 'because the screenshot script cannot run confined at all — issue #24)',
    'skill-filesystem':
      'preset-local skill root (`customSkillDirs`) so the skill travels with the preset '
      + 'and registers into this preset\'s nearer registry layer',
  },
  /** Rows kept, enabled where upstream ships them disabled. Key = flattened row id, value = the reason. */
  enabled: {
    'delegation/tool-subagent-codex':
      'opt-in: the desktop profile mounts the codex provider on the host plane, so this preset '
      + 'exposes the subagent_codex delegation tool',
    'delegation/tool-subagent-claude-code':
      'opt-in: the desktop profile mounts the claude-code provider on the host plane, so this preset '
      + 'exposes the subagent_claude_code delegation tool',
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
      + 'it is the general lever for a refusal with no workspace-local answer',
    )
    // Issue #24 narrowed what that lever is FOR. The capture used to be its one
    // named case; it is now a tool, and the escalation sentence above survives
    // only as the general fallback. Three assertions, because the interesting
    // failure is a persona that keeps both paths and lets the model pick.
    assert.match(
      persona, /parametria_capture/,
      'the persona must name the capture tool: the escalation path it replaces is what the '
      + 'model reaches for otherwise, and 28 of 42 censused sessions did exactly that',
    )
    assert.ok(
      persona.includes('never ask for a wider sandbox in order to take a picture'),
      'the persona must forbid escalating FOR A CAPTURE outright — the tool is unconditional, '
      + 'and a persona that left the escalation available for captures leaves the interrupt available too',
    )
    assert.doesNotMatch(
      persona, /Ask once per capture/,
      'the per-capture escalation instruction is retired by issue #24: it is the sentence that '
      + 'taught the treadmill, and a capture now needs no approval at all',
    )
    // The delegate half, and the reason it cannot be left implicit: a delegated
    // session is pinned to `approval: never`
    // (`subagent/src/child-agent.ts:202`), decided before any answerer runs
    // (`user-approval/src/index.ts:312`), so a validator that tried to escalate
    // is refused with nothing to fall back on. The tool is its only capture path.
    assert.ok(
      persona.includes('approval prompts are switched off inside a delegated session'),
      'the persona must state why a delegate cannot escalate: without it, a validator that '
      + 'needs its own capture spends its turn discovering an automatic refusal',
    )
    // Per-call is the WHOLE instruction, not the first of two options. Issue #9
    // ruled against shipping a named whole-run preset for this, and the reason
    // reaches the persona too: the session-wide full-access preset bundles
    // `approval: never`, so a run that talked the user into it would be a run
    // that could no longer ask for anything afterwards. The escalation
    // instruction above is a per-call one and this keeps it that way — a
    // persona that grew a "or just switch the session to full access" sentence
    // would leave every assertion above green.
    assert.doesNotMatch(
      persona, /select the .* permission preset|switch the session|for the whole session/,
      'the persona must not route the run toward a session-wide widening: the full-access preset also '
      + 'switches approval prompts off, which is the state the per-call escalation exists to avoid',
    )
    // The evidence half of issue #9 item 1. Where a run's files land is decided
    // by an argument the model types, and the skill's own examples type an
    // absolute `C:/tmp/...` that `workspace-write` denies — so a run either
    // escalates or improvises bare filenames into the workspace root, which is
    // the litter the issue was filed for. Nothing in composition governs a CLI
    // argument, so this reaches the run as persona text or not at all.
    //
    // Anchored on the whole path, including the run-scoping segment. A bare
    // /\.parametria-evidence/ would stay green if the run directory lost its
    // per-run segment, and one shared directory across runs is how a validator
    // reads the previous run's screenshot and passes the current one.
    assert.ok(
      persona.includes('`.parametria-evidence/$env:DSH_SESSION_ID/`'),
      'the persona must name the run-scoped artifact directory verbatim: the workspace is the root '
      + 'writable under the standing workspace-write policy and above it, and DSH_SESSION_ID is the '
      + 'run-scoping token shell calls already carry when an agent owns them',
    )
    // The variable is injected only when the execution HAS an agent
    // (`shell-env/src/index.ts:157-159`), and an unset `$env:X` expands to the
    // empty string in PowerShell without erroring — which silently collapses
    // the run directory back to the shared root the segment above exists to
    // prevent. The persona must therefore carry its own fallback; nothing
    // downstream can detect the collapse.
    assert.ok(
      persona.includes('if it came out empty, put a timestamp there instead'),
      'the persona must handle an empty session-id segment: DSH_SESSION_ID is absent for an '
      + 'agent-less execution and PowerShell expands it to nothing, silently sharing one directory '
      + 'across every run',
    )
    // The delegate half, and the reason it is not optional: a subagent runs
    // under its OWN session id (verified in export dsh-session-60658537, whose
    // child header reads a different `id` with `parentSession` set), so a
    // delegate that expands $env:DSH_SESSION_ID for itself resolves a directory
    // the parent never wrote to. The instruction that closes that gap is
    // passing absolute paths down, so the instruction is what gets pinned.
    assert.ok(
      persona.includes('pass ABSOLUTE paths built from that directory to every command and to every `subagent_validator` prompt'),
      'the persona must instruct passing absolute paths to the delegate: a child resolves a different '
      + 'session id, so a path it derives itself is not the path the capture wrote to',
    )
    // The persona is inherited by delegate children through `composeFrom()`, so
    // every imperative in it is read by the validator too. Without this
    // sentence the paragraph is pure orchestrator voice, and a literal-minded
    // child creates a second run directory from its OWN session id and then
    // looks for the screenshot there rather than at the path it was handed —
    // which is the failure the sentence above exists to prevent, arriving from
    // the other side.
    assert.ok(
      persona.includes('if you ARE the delegate and were handed absolute paths, use them verbatim and derive nothing'),
      'the persona must address the delegate directly: it inherits this text, and an unaddressed '
      + 'imperative is one a child follows for itself',
    )
    // The third artifact class, and the one this shape was ruled in to reach.
    // Relocating the generator SCRIPT is not enough: the litter was what the
    // script WROTE (`gen-tsc-media-wall.js:389` wrote a bare `spec.json`), and a
    // bare filename inside a script resolves against the process cwd no matter
    // where the script itself sits. No CLI argument reaches inside a file the
    // model authors, so this instruction is the only thing covering it.
    assert.ok(
      persona.includes('A generator script you write must itself write its output to absolute paths under that same directory'),
      'the persona must instruct that generator scripts write ABSOLUTE paths: relocating the script '
      + 'without relocating its output reproduces the exact litter this slice exists to stop',
    )
    // The persona MENTIONS `C:/tmp` in both this paragraph and the uv one, so a
    // keyword assertion cannot tell "ignore both" from an endorsement — and an
    // endorsement is the skill's own documented behaviour leaking back in. The
    // overriding sentence is therefore matched whole. Both spellings are named
    // because the skill documents both: `C:/tmp/...` in its Windows examples
    // and a POSIX `/tmp/spec.json` as the decompiler's own default.
    assert.ok(
      persona.includes('The skill\'s own examples write to `C:/tmp/...` and `/tmp/...`; ignore both.'),
      'the persona must override the skill\'s documented output locations explicitly: a loaded skill\'s '
      + 'text competes with this persona, and both spellings are outside the workspace-write grant',
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
    // the two assertions above own it; rows declared in `DECLARED_DELTA.enabled`
    // are excluded because the test below owns their `disabled` difference.
    for (const [id, row] of ours) {
      const other = upstream.get(id)
      if (other === undefined) continue
      if (Object.hasOwn(DECLARED_DELTA.enabled, id)) continue
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

  it('enables exactly the declared rows and no others', () => {
    // The `disabled` half of the drift fence, split out so the equality case
    // above can keep comparing the whole row: a shared row whose `disabled`
    // differs from upstream must be declared here, with a reason, or fail.
    const enabled = []
    for (const [id, row] of ours) {
      const other = upstream.get(id)
      if (other === undefined) continue
      if (!sameValue(row.disabled, other.disabled)) enabled.push(id)
    }
    assert.deepEqual(enabled.sort(), Object.keys(DECLARED_DELTA.enabled).sort())
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

  it('withdraws delegation from the child rather than only budgeting it', () => {
    // Presence only, for the same reason as the cap above: the LIST is derived
    // from this composition's own rows in `validator-leaf.test.mjs`, which owns
    // that claim whole. Redundancy rather than sole coverage, stated precisely
    // because the opposite is easy to write: deleting the key does NOT go quiet
    // there — that file fails by name on `declares a per-child tool filter` and
    // throws on three more. What this line adds is a failure in the fence that
    // reads the row's SHAPE, next to the `maxDepth` presence check it pairs
    // with, so the row's two withdrawal claims are checked side by side.
    assert.ok(
      Object.hasOwn(row.config, 'toolFilter'),
      'the validator row must state a per-child tool filter; omitting it leaves the validator holding '
      + 'the sibling delegation rows it joins through composeFrom()',
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
