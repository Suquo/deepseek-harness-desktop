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
 * Workspace directories the persona instructs a run to create, in the two
 * spellings it uses: a `$PWD`-anchored assignment (`"$PWD\.uv-cache"`) and a
 * bare workspace-relative path (`.parametria-evidence/`). Both forms are
 * dot-prefixed, which is what keeps `C:/tmp/...` — named in the persona only to
 * be refused — out of the set.
 */
function personaWorkspaceDirs(text) {
  const dirs = new Set()
  for (const [, name] of text.matchAll(/\$PWD\\(\.[A-Za-z0-9][A-Za-z0-9._-]*)/g)) dirs.add(name)
  for (const [, name] of text.matchAll(/(?<![\w./\\])(\.[a-z][A-Za-z0-9._-]*)\//g)) dirs.add(name)
  return [...dirs].sort()
}

/**
 * Ask git whether a path inside the directory would be ignored.
 * @param path - repository-relative path to test.
 * @returns true when git ignores it.
 */
function isIgnored(path) {
  try {
    execFileSync('git', ['-C', REPO_ROOT, 'check-ignore', '--quiet', '--', path], { stdio: 'ignore' })
    return true
  } catch (error) {
    // Exit 1 is the documented "not ignored" answer. Anything else (128 for a
    // broken invocation, ENOENT for a missing git) is a broken fence rather
    // than a passing one, so it is re-thrown instead of read as a result.
    if (error.status === 1) return false
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

  it('ignores every one of them, so a run cannot dirty the tracked surface', () => {
    const unignored = dirs.filter(dir => !isIgnored(`${dir}/probe`))
    assert.deepEqual(
      unignored, [],
      'the persona instructs runs to create these directories in the session workspace, and this '
      + 'repository is that workspace whenever a run is driven from here — add them to .gitignore',
    )
  })

  it('still distinguishes ignored from tracked, so the check itself can fail', () => {
    // Without this, a `.gitignore` that had grown a catch-all `*` would satisfy
    // the assertion above while ignoring the entire repository.
    assert.equal(
      isIgnored('dsh-preset-parametria/package.json'), false,
      'git check-ignore reports a tracked file as ignored — the ignore rules have grown a catch-all',
    )
  })
})
