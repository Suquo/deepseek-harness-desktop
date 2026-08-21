/**
 * Grounded fence for the validator delegate being a LEAF: it holds no
 * delegation-starting tool at all.
 *
 * WHY, precisely, because the first version of this reasoning was wrong. The
 * validator row's `maxDepth` is enforced per START through the row that carries
 * it, and a child joins its parent's preset (`composeFrom`), so the validator
 * also holds every OTHER delegation row in this composition. PR #19 disclosed
 * that residual as "a depth-2 grandchild ON THE SESSION MODEL remains
 * reachable", i.e. the blind-child hole re-opening one level down. That claim
 * is FALSE at the pinned upstream, and issue #20 was re-scoped once it was
 * refuted: upstream resolves a child's route from its CALLING agent's live
 * options (`resolveChildAgentOptions`, `child-agent.ts:68-83`, spreading
 * `parent.options.provider/model` before the row's own `agentOptions`), and the
 * caller for a start made inside the validator IS the validator — which runs on
 * the route this row pins. A grandchild therefore inherits the VISION route: it
 * recurses and spends, it does not go blind.
 *
 * So this fence is about containment, not sight. A validation pass is a
 * question with an answer; an orchestrator is a different thing. The deny list
 * withdraws the capability rather than budgeting it, which is why it is a
 * `toolFilter` and not a second `maxDepth`.
 *
 * THE LIST IS DERIVED, NOT RESTATED. Every enabled row of this preset is
 * classified against the pinned upstream source — does its package both
 * register a model-facing tool AND reach a child-start seam? — and the deny
 * list must equal that set exactly. A delegation row added later and left
 * undenied fails here; so does a denied name this preset does not register,
 * which is the failure that would otherwise arrive as a broken delegation
 * rather than a red test (`tools.restrict()` throws on an unregistered name,
 * `core/tools/src/index.ts:1088-1092`, inside the child's creation window).
 *
 * DIVERGENCE DISCLOSURE — read before trusting a green. Unlike
 * `validator-depth.test.mjs`, which imports and EXECUTES upstream's own depth
 * functions, nothing here calls upstream code. `tools.restrict()` and the
 * `toolFilter` load-time check live in `core/tools/src/index.ts` and
 * `tool-subagent/src/index.ts`, and both carry VALUE imports from the
 * submodule's own pnpm workspace, which this package does not install
 * (`@deepseek-ai/schemastery` in each; `@deepseek-ai/cordis`,
 * `@deepseek-ai/dsh-scope`, `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-session`
 * in the registry; `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-subagent` in
 * the tool). The distinction is the whole reason `depth.ts` IS importable —
 * its only import is type-only, so stripping erases it; `tool-subagent`'s own
 * `@deepseek-ai/cordis` import is type-only too and is not what blocks that
 * file. What is grounded instead is every INPUT to those
 * functions: the classification, the tool names, and the provider capability
 * are all read out of the pinned upstream's source text with
 * declaration-anchored patterns that fail loud rather than silently matching
 * nothing. If a future layout makes the registry importable, exercise
 * `restrict()` against this list directly and delete this paragraph.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { LoaderExpression, PACKAGE_ROOT, UPSTREAM_ROOT, indexRows, readComposition } from './helpers.mjs'

/**
 * A child-start seam: the calls through which a plugin causes a new agent to
 * exist. Receiver-agnostic on purpose — the discrimination is done by the
 * conjunction with {@link TOOL_REGISTRATION} below, so this half stays
 * deliberately over-inclusive. `workflow-worker-thread` matches here and is
 * correctly excluded anyway: it starts children on behalf of a tool and
 * registers none of its own.
 */
const CHILD_START_SEAMS = [
  /\bsubagents\.start\(/,
  /\bstartContinuable\(/,
  /\bworkflowEngine\.start\(/,
]

/** A model-facing registration: the plugin gives the model something to call. */
const TOOL_REGISTRATION = /\bctx\.tools\.register\(/

/**
 * Index the pinned upstream's workspace packages by manifest name, so a preset
 * row's plugin name resolves to the source that decides what it does.
 * @returns a Map of package name to its absolute directory.
 */
function upstreamPackageIndex() {
  const index = new Map()
  const groups = join(UPSTREAM_ROOT, 'packages')
  for (const group of readdirSync(groups, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(groups, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(groups, group.name, entry.name)
      const manifest = join(dir, 'package.json')
      if (!existsSync(manifest)) continue
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof name === 'string') index.set(name, dir)
    }
  }
  return index
}

/**
 * The whole TypeScript source of one package, concatenated.
 * @param dir - the package directory.
 * @returns every `.ts` file under `src/`, joined.
 */
function sourceTextOf(dir) {
  const src = join(dir, 'src')
  // Never an empty corpus: an empty string fails both classification regexes,
  // so a package whose sources moved would be classified "does not delegate"
  // with no signal at all — the silent-partial-derivation failure this fence
  // exists to be free of.
  if (!existsSync(src)) {
    throw new Error(`upstream package at ${dir} has no src/ directory; the delegation classification cannot read it`)
  }
  const parts = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) parts.push(readFileSync(path, 'utf8'))
    }
  }
  walk(src)
  return parts.join('\n')
}

/**
 * The one row `name` that is not a package: the Loader's own group marker.
 * Enumerated rather than inferred, so an unrecognized non-package name fails
 * loud instead of silently dropping out of the classification.
 */
const NON_PACKAGE_ROW_NAMES = new Set(['cordis:group'])

/**
 * The workspace packages of THIS repository, indexed the same way as upstream's.
 *
 * The preset may mount a desktop-owned plugin beside the upstream rows —
 * issue #24's `dsh-plugin-desktop/parametria-capture` is the first. Classifying
 * such a row from its OWN source is what keeps this fence derived rather than
 * enumerated: a desktop plugin that later grew a child-start seam joins the
 * delegation set here, instead of slipping past as "not upstream, so not
 * checked".
 *
 * WHOLE-PACKAGE reading — the rule for upstream rows — is deliberately NOT used
 * for these. `dsh-plugin-desktop` is one package holding the entire Electron
 * shell, so its whole-`src/` corpus would classify `parametria-capture` by code
 * it does not contain: the day any unrelated desktop module gains a
 * `subagents.start(`, this fence would start DEMANDING that `parametria_capture`
 * join the validator's deny list — withdrawing from the delegate the one tool
 * the preset mounts for it (issue #24's first acceptance clause), with a green
 * suite. For upstream packages over-inclusion is the conservative direction;
 * for a monolith addressed by subpath it inverts, so a local row is classified
 * from the module its `name` actually points at.
 * @returns a Map of package name to its absolute directory.
 */
function localPackageIndex() {
  const index = new Map()
  const root = join(PACKAGE_ROOT, '..')
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const manifest = join(root, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof name === 'string') index.set(name, join(root, entry.name))
  }
  return index
}

/**
 * The package a row's plugin name refers to. A row may name a subpath export
 * (`.../dsh-tool-subagent-control/list-agents`, `dsh-plugin-desktop/parametria-capture`);
 * the package is the scope and the name after it for a scoped name, and the
 * first segment for an unscoped local one.
 *
 * Loudness is preserved by checking the RESULT against the indexes rather than
 * by the shape of the name: an unscoped name that resolves to no known package
 * still throws, so relaxing the scope requirement did not open a hole.
 * @param pluginName - the row's `name` field.
 * @returns the bare package name, or undefined for a known non-package row.
 * @throws when the name resolves to no indexed package and is not a known non-package row.
 */
function packageNameOf(pluginName) {
  if (NON_PACKAGE_ROW_NAMES.has(pluginName)) return undefined
  const segments = pluginName.split('/')
  const candidate = pluginName.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  if (candidate === undefined || !packages.has(candidate)) {
    throw new Error(
      `preset row name "${pluginName}" resolves to no package of the pinned upstream checkout or this `
      + 'workspace — the delegation classification cannot decide it, and a row it cannot decide must not '
      + 'pass unclassified. Add it to NON_PACKAGE_ROW_NAMES with a reason, or ground its source.',
    )
  }
  return candidate
}

const upstreamPackages = upstreamPackageIndex()
const localPackages = localPackageIndex()
for (const localName of localPackages.keys()) {
  // The two indexes are merged below; a collision would let a local package
  // silently answer for an upstream one, which is the loud-failure discipline
  // this file keeps everywhere else.
  if (upstreamPackages.has(localName)) {
    throw new Error(`package name "${localName}" exists both upstream and in this workspace; the classification cannot decide which source to read`)
  }
}
const packages = new Map([...upstreamPackages, ...localPackages])
const sources = new Map()

/**
 * Memoized source text for one preset row, failing loud on an unknown package.
 *
 * Keyed by the ROW NAME, not the package name, because the corpus differs: an
 * upstream row reads its whole package, a local row reads only the module its
 * subpath points at (see {@link localPackageIndex} for why the usual
 * over-inclusion inverts here).
 * @param pluginName - the row's `name` field.
 * @param packageName - its resolved package name.
 * @returns the source text the classification reads.
 */
function sourceOf(pluginName, packageName) {
  if (!sources.has(pluginName)) {
    const dir = packages.get(packageName)
    if (dir === undefined) {
      throw new Error(
        `preset row plugin "${packageName}" is not a package of the pinned upstream checkout — `
        + 'the classification below cannot decide whether it delegates. Run '
        + '`git submodule update --init deepseek-harness`, or re-ground this fence if the row is local.',
      )
    }
    if (!localPackages.has(packageName)) {
      sources.set(pluginName, sourceTextOf(dir))
    } else {
      const subpath = pluginName.slice(packageName.length + 1)
      const entry = join(dir, 'src', `${subpath.length === 0 ? 'index' : subpath}.ts`)
      if (!existsSync(entry)) {
        throw new Error(
          `local preset row "${pluginName}" points at no module: expected ${entry}. `
          + 'A local row is classified from its own entry, so an unresolvable one must not pass.',
        )
      }
      sources.set(pluginName, readFileSync(entry, 'utf8'))
    }
  }
  return sources.get(pluginName)
}

/**
 * The tool name a row registers, resolved from the nearest DECLARATION rather
 * than from a literal repeated here. Three sources in precedence order: the
 * row's own `toolName`, the upstream Config schema default it would otherwise
 * take, and the fixed name in the `defineTool` registration itself.
 * @param row - the preset row.
 * @param packageName - its resolved package name.
 * @returns the registered name and where it was read from.
 */
function registeredToolName(row, packageName) {
  const configured = row.config?.toolName
  if (typeof configured === 'string') return { name: configured, from: 'the row\'s own `toolName`' }
  const source = sourceOf(row.name, packageName)
  const schemaDefault = source.match(/\btoolName:\s*z\.string\(\)\.default\('([^']+)'\)/)
  if (schemaDefault !== null) {
    return { name: schemaDefault[1], from: `${packageName}'s Config schema default` }
  }
  const literals = [...source.matchAll(/\bctx\.tools\.register\(defineTool\(\{\s*name:\s*'([^']+)'/g)]
  if (literals.length === 1) {
    return { name: literals[0][1], from: `${packageName}'s \`defineTool\` declaration` }
  }
  throw new Error(
    `cannot resolve the tool name row "${row.id}" registers: ${packageName} states no \`toolName\` config, `
    + `no schema default, and ${literals.length} fixed \`defineTool\` names. Re-ground before trusting this fence.`,
  )
}

const rows = indexRows(readComposition(join(PACKAGE_ROOT, 'preset', 'agent.cordis.yml')))
const validator = rows.get('delegation/tool-subagent-validator')
const filter = validator.config.toolFilter

/** Rows this composition mounts: `disabled: true` registers nothing at all. */
const enabled = [...rows].filter(([, row]) => row.disabled !== true && row.group !== true)
const disabled = [...rows].filter(([, row]) => row.disabled === true)

/**
 * The classification this fence rests on: a row DELEGATES when its package both
 * hands the model a tool and reaches a child-start seam. Derived per row from
 * the pinned upstream source, never from a list kept here.
 */
function delegationRows(entries) {
  const found = []
  for (const [id, row] of entries) {
    const packageName = packageNameOf(row.name)
    if (packageName === undefined) continue
    const source = sourceOf(row.name, packageName)
    if (!TOOL_REGISTRATION.test(source)) continue
    if (!CHILD_START_SEAMS.some(seam => seam.test(source))) continue
    found.push({ id, row, ...registeredToolName(row, packageName) })
  }
  return found
}

const delegating = delegationRows(enabled)

describe('the validator delegate is a leaf', () => {
  it('declares a per-child tool filter, as a deny list', () => {
    assert.ok(filter !== undefined, 'the validator row must carry a `toolFilter`; omitting it leaves the child holding every delegation row this preset mounts')
    // Upstream rejects a filter naming neither side AT LOAD
    // (`tool-subagent/src/index.ts:274-276`); this reproduces that rule rather
    // than calling it — see the divergence disclosure in the file header.
    assert.ok(
      Array.isArray(filter.deny) && filter.deny.length > 0,
      'the filter must carry a non-empty `deny`. Stricter than upstream on purpose: upstream rejects only a '
      + 'filter naming NEITHER side, so `deny: []` would load and withdraw nothing — a filter present and inert '
      + 'is the shape this fence exists to refuse.',
    )
    assert.equal(
      filter.allow, undefined,
      'this filter must stay a deny list: an `allow` list is a CLOSED enumeration of everything the '
      + 'validator may call, so every tool upstream adds later would silently vanish from the child. '
      + 'A deny list states only the capability being withdrawn.',
    )
  })

  it('denies exactly the delegation-starting tools this preset registers', () => {
    // The exhaustiveness case, and the one that bites when a delegation row is
    // added later: the required set is DERIVED from upstream source per row, so
    // a new `dsh-tool-subagent` instance — or any future plugin that registers
    // a tool and starts children — must be denied here or fail this line.
    const required = delegating.map(entry => entry.name).sort()
    assert.deepEqual(
      [...filter.deny].sort(), required,
      'the deny list must equal the set of delegation-starting tools this composition registers.\n'
      + `  derived: ${delegating.map(entry => `${entry.name} (${entry.id}, via ${entry.from})`).join('\n           ')}`,
    )
  })

  it('names only tools this preset registers and leaves ENABLED', () => {
    // The name-safety case. `tools.restrict()` throws on a name that is not a
    // live global/inherited tool (`core/tools/src/index.ts:1088-1092`), and it
    // runs inside the CHILD's creation window — so a wrong name here does not
    // fail a build, it fails every `subagent_validator` delegation, which is
    // the issue #18 failure class arriving through a different door. A disabled
    // row registers nothing, so its tool name is exactly such a wrong name.
    const registered = new Set(delegating.map(entry => entry.name))
    for (const name of filter.deny) {
      assert.ok(
        registered.has(name),
        `deny list names "${name}", which no enabled row of this preset registers — `
        + 'that name would make `tools.restrict()` throw in the child creation window and break every validator spawn',
      )
    }
    for (const [id, row] of disabled) {
      const toolName = row.config?.toolName
      if (typeof toolName !== 'string') continue
      assert.ok(
        !filter.deny.includes(toolName),
        `deny list names "${toolName}" from the DISABLED row ${id}; a disabled row registers no tool, so the name is unknown at restrict() time`,
      )
    }
  })

  it('denies its own row too, so the leaf holds even where the depth cap already refuses', () => {
    // Not redundant with `maxDepth: 1`, which refuses a re-entry by throwing at
    // START. The filter removes the tool from the child's prompt entirely, so
    // the validator is never offered the call it would then be refused.
    assert.ok(
      filter.deny.includes(validator.config.toolName),
      'leaf means leaf: the validator must not hold its own delegate either',
    )
  })

  it('has no delegation row whose mounting is platform-conditional', () => {
    // A `!!js` expression on a delegation row would make the deny list correct
    // on one platform and fatal on the other: on the platform that disables the
    // row, its name is unregistered and restrict() throws. The deny list cannot
    // be conditional, so this composition must not contain the shape that would
    // require it.
    //
    // Guarded against a vacuous pass first: an empty derivation would satisfy
    // the loop with zero iterations, and this case must not lean on a sibling
    // case failing to notice that.
    assert.ok(delegating.length > 0, 'the delegation classification derived NO rows; every case here would pass vacuously')
    for (const entry of delegating) {
      assert.ok(
        !(entry.row.disabled instanceof LoaderExpression),
        `row ${entry.id} is conditionally disabled, so "${entry.name}" is registered on some platforms only — `
        + 'a static deny list cannot name it safely',
      )
    }
  })

  it('runs on a provider that upstream still declares can enforce a tool filter', () => {
    // The capability half. `subagents.start()` rejects a request carrying a
    // `toolFilter` when the provider does not declare the capability
    // (`subagent/src/index.ts:481-496`) — again at delegation time, not build
    // time. Derived: find the provider package whose default registry name is
    // the one this row asks for, then read its declaration.
    const wanted = validator.config.provider
    const candidates = []
    for (const [name, dir] of packages) {
      // A provider package declares its registry name and its capabilities in
      // its entry module; reading only that keeps this sweep over ~150
      // packages cheap. A package that moved either out of `src/index.ts`
      // drops out of the candidate set and fails the count below — loudly,
      // which is the intended direction.
      const entry = join(dir, 'src', 'index.ts')
      if (!existsSync(entry)) continue
      const source = readFileSync(entry, 'utf8')
      const declared = source.match(/\bproviderName:\s*z\.string\(\)\.default\('([^']+)'\)/)
      if (declared?.[1] === wanted) candidates.push({ name, source })
    }
    assert.equal(
      candidates.length, 1,
      `expected exactly one upstream package to register the "${wanted}" subagent provider by default, found ${candidates.length}`,
    )
    assert.match(
      candidates[0].source,
      /capabilities:\s*SubagentCapabilities\s*=\s*\{[^}]*\btoolFilter:\s*true/,
      `upstream provider package ${candidates[0].name} no longer declares the \`toolFilter\` capability; `
      + 'this row would be rejected at every delegation',
    )
  })
})
