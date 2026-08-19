/**
 * Fence tying the persona's workspace directories to this repository's
 * `.gitignore` — the evidence half of issue #9 item 1.
 *
 * The problem this exists for: a Parametria run resolves its output paths
 * against the SESSION WORKSPACE, and the workspace of every harvested run so
 * far has been this repository. So each directory the persona tells a run to
 * create appears in the operator's working tree, and an unignored one shows up
 * as untracked litter next to real work — which is precisely what issue #9's
 * evidence half was filed for (`cabinet-*.png`, `spec.json`, and later a whole
 * second run's `gen-*.js` generators, all loose in the repository root).
 *
 * The fence therefore DERIVES its list from the persona rather than restating
 * it. A restated list would pass forever after the next persona edit: whoever
 * adds a third scratch directory has no reason to remember a `.gitignore` in
 * another package. Deriving means the persona itself is the input, so naming a
 * new workspace directory fails here until that directory is ignored.
 *
 * Ignoring is checked with `git check-ignore`, not by grepping `.gitignore`
 * for a matching line. The question worth asking is whether git actually
 * ignores the path — a line can be present and still not match (a leading
 * slash, a missing trailing slash, an earlier negation), and every one of those
 * near-misses leaves the litter exactly where it was.
 */

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PACKAGE_ROOT, REPO_ROOT, indexRows, readComposition } from './helpers.mjs'

const PRESET_DIR = join(PACKAGE_ROOT, 'preset')
const persona = indexRows(readComposition(join(PRESET_DIR, 'agent.cordis.yml'))).get('persona').config.text

/**
 * DOT-PREFIXED workspace directories the persona instructs a run to create.
 *
 * Scope, stated exactly because the sentences elsewhere that describe this
 * fence must not promise more than it does: this recognises a leading-dot name
 * that is either `$PWD`-anchored (`"$PWD\.uv-cache"`, either separator) or
 * written as a workspace-relative path (`.parametria-evidence/`). The dot is
 * what makes the extraction possible at all — it separates a directory from
 * ordinary prose, and it keeps `C:/tmp/...` and `/tmp/...`, named in the
 * persona only to be refused, out of the set.
 *
 * What it therefore does NOT catch, so nobody reads this fence as universal: a
 * directory without the leading dot (`parametria-gen/`). Both conventions this
 * profile uses are dot-prefixed, and a non-dot name is indistinguishable from
 * an ordinary word in prose without a parser this fence has no reason to grow.
 * A persona adding a non-dot scratch directory is a case a human reviewer has
 * to catch; every other spelling below is covered.
 */
function personaWorkspaceDirs(text) {
  const dirs = new Set()
  // `$PWD\.name` or `$PWD/.name`, and `${PWD}` likewise.
  for (const [, name] of text.matchAll(/\$\{?PWD\}?[\\/](\.[A-Za-z0-9][A-Za-z0-9._-]*)/g)) dirs.add(name)
  // A leading-dot path segment followed by a separator, in either spelling, and
  // not preceded by another path character (which would make it a suffix or a
  // nested reference rather than a workspace-root directory).
  for (const [, name] of text.matchAll(/(?<![\w$:.])\.([A-Za-z][A-Za-z0-9._-]*)[\\/]/g)) dirs.add(`.${name}`)
  return [...dirs].sort()
}

/**
 * Ask git whether the ignore RULES cover a path.
 *
 * `--no-index` is load-bearing, not tidiness. Without it `check-ignore`
 * consults the index first and reports any TRACKED path as not-ignored no
 * matter what the rules say — which silently disarms the counter-assertion
 * below, since its whole job is to notice a rule broad enough to swallow a
 * tracked file. (Measured: with a catch-all `*` added to `.gitignore`, the
 * index-aware form still answered "not ignored" for a tracked `package.json`,
 * so the guard passed while the repository was entirely ignored.) The question
 * worth asking is about the rules, so the rules are what gets asked.
 *
 * `core.excludesFile=` is emptied for the same reason: `check-ignore` honours
 * the developer's GLOBAL ignore file, so someone with `.uv-cache/` in their
 * personal excludes would see this fence green while THIS repository's
 * `.gitignore` — the file the failure message tells them to edit, and the only
 * one their colleagues get — lacked the entry.
 *
 * @param path - repository-relative path to test.
 * @returns the ignore rule source and pattern when the rules match, else null.
 */
function ignoreRule(path) {
  try {
    const out = execFileSync(
      'git',
      ['-c', 'core.excludesFile=', '-C', REPO_ROOT, 'check-ignore', '--no-index', '--verbose', '--', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const [source, line, pattern] = out.trim().split(':')
    return { source, line, pattern }
  } catch (error) {
    // Exit 1 is the documented "not ignored" answer. Anything else (128 for a
    // broken invocation, ENOENT for a missing git) is a broken fence rather
    // than a passing one, so it is re-thrown instead of read as a result.
    if (error.status === 1) return null
    throw error
  }
}

const dirs = personaWorkspaceDirs(persona)

describe('persona workspace directories vs this repository\'s .gitignore', () => {
  it('finds the directories the persona tells a run to create', () => {
    // A derivation that silently matches nothing would make every assertion
    // below vacuously true, which is the failure mode of a derived fence.
    assert.ok(dirs.length > 0, 'the persona names no workspace directory — the extraction below has gone stale')
    assert.ok(
      dirs.includes('.parametria-evidence'),
      'the persona must name `.parametria-evidence/` as the run\'s artifact root (issue #9 item 1): '
      + `derived ${JSON.stringify(dirs)}`,
    )
  })

  it('ignores every one of them, from this repository\'s own .gitignore', () => {
    const unignored = dirs.filter(dir => ignoreRule(`${dir}/probe`) === null)
    assert.deepEqual(
      unignored, [],
      'the persona instructs runs to create these directories in the session workspace, and this '
      + 'repository is that workspace whenever a run is driven from here — add them to .gitignore',
    )
    // Which FILE grants the ignore is part of the claim: a rule inherited from
    // `.git/info/exclude` covers one checkout and travels to nobody.
    for (const dir of dirs) {
      assert.equal(
        ignoreRule(`${dir}/probe`).source, '.gitignore',
        `${dir} is ignored by something other than the repository's own .gitignore, so the rule does `
        + 'not travel with the repository',
      )
    }
  })

  it('still reports ordinary tracked paths as unignored, so the check can fail', () => {
    // Without this, a `.gitignore` that had grown a catch-all would satisfy the
    // assertion above by ignoring the entire repository rather than by covering
    // the persona's directories.
    //
    // TWO controls, and the dot-prefixed one is not decoration: every path the
    // assertion above tests begins with a dot, so a `.*` rule — far likelier
    // than a bare `*`, and the exact shape someone reaches for when tidying
    // away dot-directories — would satisfy it while leaving a plain-named
    // artifact directory exposed. A control that shares the shape of the paths
    // under test is the only one that catches that.
    for (const control of ['dsh-preset-parametria/package.json', '.github/workflows/ci.yml']) {
      assert.equal(
        ignoreRule(control), null,
        `the ignore rules match ${control} — they have grown broad enough to hide tracked work, `
        + 'which makes the assertion above pass for the wrong reason',
      )
    }
  })
})
