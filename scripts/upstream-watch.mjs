// Lane C upstream watch — READ-ONLY report of how far this fork has drifted from
// the two upstreams it tracks:
//
//   1. deepseek-ai/deepseek-harness  — the pinned harness source (`upstream.json`
//      + the `deepseek-harness/` submodule gitlink), consumed as `@deepseek-ai/dsh-*`
//      npm packages plus the yarn `patches/` set.
//   2. anywhere-labs/deepseek-harness-desktop — the desktop overlay this repo forks,
//      tracked through the `upstream` git remote.
//
// This script NEVER writes: it does not bump the pin, does not touch the submodule,
// does not fetch, does not push, and does not edit any file. Every git invocation
// goes through `git()`, which throws on anything READ_ONLY_GIT (below) does not admit
// as a reading call, and every network read is a `gh api` GET. Its whole output is a
// report; the decision it feeds is the RM's (see `.engineering/upstream-watch.md`).
//
// Usage:
//   node scripts/upstream-watch.mjs             human-readable report
//   node scripts/upstream-watch.mjs --json      machine-readable report on stdout
//   node scripts/upstream-watch.mjs --offline   local facts only, no `gh api` calls
//   node scripts/upstream-watch.mjs --help      this header
//
// Exit code is 0 whenever the report was produced, even when the fork is behind —
// being behind is information, not a gate failure. Exit 2 means the invocation was
// rejected (unknown argument); any other non-zero means the report could not be
// produced. This is deliberately NOT part of `yarn check`: the headless gate must
// stay offline and deterministic.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

// The read-only fence. `git()` is the only way this script reaches git, and a call
// outside this list is a bug in the script, not a runtime condition to recover from —
// so it throws rather than degrading. `config` is the one subcommand that is not
// read-only by nature (`git config k v` writes), so it is admitted only in its
// reading form; the rest cannot modify anything whatever arguments they are given.
const READ_ONLY_GIT = new Map([
  ['config', args => args.includes('--get')],
  ['log', () => true],
  ['ls-tree', () => true],
  ['merge-base', () => true],
  ['rev-list', () => true],
  ['rev-parse', () => true],
])

const warnings = []
const warn = message => { warnings.push(message); return null }

const git = (...args) => {
  const permitted = READ_ONLY_GIT.get(args[0])
  if (!permitted || !permitted(args)) {
    throw new Error(`upstream-watch: refusing to run non-read-only git invocation "${args.join(' ')}"`)
  }
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

// `paginate` is opt-in and only ever used on array endpoints: on an OBJECT endpoint
// gh would emit one JSON object per page back to back, which is not parseable JSON.
const ghApi = (path, { paginate = false } = {}) => {
  if (offline) return null
  try {
    const raw = execFileSync('gh', ['api', ...(paginate ? ['--paginate'] : []), path], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // `--paginate` concatenates one array per page; splice the seams before parsing.
    return JSON.parse(paginate ? raw.replaceAll(/\]\s*\[/gu, ',') : raw)
  } catch (error) {
    return warn(`gh api ${path} failed (${String(error.message).split('\n')[0]})`)
  }
}

const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

// `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git` both
// reduce to `owner/repo`, which is what the gh API wants.
const toSlug = url => {
  if (!url) return null
  const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/u.exec(url.trim())
  return match ? `${match[1]}/${match[2]}` : null
}

const FLAGS = new Set(['--json', '--offline', '--help', '-h'])
const args = new Set(process.argv.slice(2))
// A typo'd `--ofline` must not quietly take the live network path.
for (const arg of args) {
  if (!FLAGS.has(arg)) {
    process.stderr.write(`upstream-watch: unknown argument "${arg}" (accepts ${[...FLAGS].join(', ')})\n`)
    process.exit(2)
  }
}
if (args.has('--help') || args.has('-h')) {
  // The header block only — everything above the first non-comment line. Section
  // markers and implementation notes further down are not help text.
  const header = []
  for (const line of readFileSync(import.meta.filename, 'utf8').split('\n')) {
    if (!line.startsWith('//')) break
    header.push(line.replace(/^\/\/ ?/u, ''))
  }
  process.stdout.write(`${header.join('\n')}\n`)
  process.exit(0)
}
const offline = args.has('--offline')
const asJson = args.has('--json')

// ---------------------------------------------------------------- pinned state

const upstreamJson = readJson('upstream.json')
const workspace = readJson('package.json')
const harnessSlug = toSlug(upstreamJson.repository)

// The submodule gitlink is read out of the committed tree, so this works whether
// or not `git submodule update --init` has ever run in this checkout — the watch
// must never depend on materialising upstream source.
const gitlinkLine = git('ls-tree', 'HEAD', 'deepseek-harness')
const submoduleGitlink = gitlinkLine ? /^\S+\s+commit\s+(\S+)/u.exec(gitlinkLine)?.[1] ?? null : null
if (submoduleGitlink && submoduleGitlink !== upstreamJson.commit) {
  warn(`pin drift: upstream.json commit ${upstreamJson.commit} != submodule gitlink ${submoduleGitlink}`)
}
if (upstreamJson.sourceVersion !== upstreamJson.runtimePackageVersion) {
  warn(`upstream.json sourceVersion ${upstreamJson.sourceVersion} != runtimePackageVersion ${upstreamJson.runtimePackageVersion}`)
}

// ---------------------------------------------------------------- harness side

const tags = ghApi(`repos/${harnessSlug}/tags?per_page=100`, { paginate: true }) ?? []
const releases = ghApi(`repos/${harnessSlug}/releases?per_page=100`, { paginate: true }) ?? []
const harnessRepo = ghApi(`repos/${harnessSlug}`)

// Identify our pin by SHA rather than by version string: the tag naming scheme is
// upstream's to change, but the commit we pinned is the commit we pinned.
const pinnedTag = tags.find(tag => tag.commit?.sha === upstreamJson.commit)?.name ?? null
if (tags.length > 0 && !pinnedTag) {
  warn(`pinned commit ${upstreamJson.commit.slice(0, 10)} does not match any of the ${tags.length} most recent tags — pin is mid-release or the tag was moved`)
}

const pinnedRelease = pinnedTag ? releases.find(release => release.tag_name === pinnedTag) ?? null : null
const newerReleases = pinnedRelease
  ? releases
    .filter(release => Date.parse(release.published_at) > Date.parse(pinnedRelease.published_at))
    .map(release => ({ tag: release.tag_name, publishedAt: release.published_at, prerelease: release.prerelease }))
  : []

const latestRelease = releases[0]
  ? { tag: releases[0].tag_name, publishedAt: releases[0].published_at, prerelease: releases[0].prerelease }
  : null

const harnessDefaultBranch = harnessRepo?.default_branch ?? null
// `compare/A...B` reports how far B has moved past A, which is exactly "how many
// commits behind the branch our pin sits".
const harnessCompare = harnessDefaultBranch
  ? ghApi(`repos/${harnessSlug}/compare/${upstreamJson.commit}...${harnessDefaultBranch}`)
  : null

// "0 releases behind", "we could not look", and "we looked but could not place our
// own pin" must never render the same way. The third case is the subtle one: if the
// pinned commit is not the commit of a published Release — a mid-release pin, a tag
// with no Release object, a moved tag — then `newerReleases` is empty for a reason
// that has nothing to do with being up to date, and calling that `current` would be
// exactly the false clean bill of health this script exists to prevent.
const harnessReachable = !offline && releases.length > 0
if (harnessReachable && !pinnedRelease) {
  warn(`pinned commit ${upstreamJson.commit.slice(0, 10)} does not correspond to any published release — "releases behind" cannot be computed for this pin`)
}
const harnessKnown = harnessReachable && pinnedRelease !== null

// A release-only verdict misses a pin that trails the branch with no release cut yet,
// so both signals the script already holds have to reach the status.
const commitsBehind = harnessCompare?.ahead_by ?? null
const harnessBehind = newerReleases.length > 0 || (commitsBehind ?? 0) > 0

const harness = {
  repository: harnessSlug,
  defaultBranch: harnessDefaultBranch,
  pinned: {
    commit: upstreamJson.commit,
    sourceVersion: upstreamJson.sourceVersion,
    runtimePackageVersion: upstreamJson.runtimePackageVersion,
    tag: pinnedTag,
    submoduleGitlink,
  },
  latestRelease,
  releasesBehind: harnessKnown ? newerReleases.length : null,
  newerReleases,
  commitsBehindDefaultBranch: commitsBehind,
  // `behind` wins over `indeterminate`: a positive drift signal is conclusive even
  // when the release side could not be placed.
  status: harnessBehind
    ? 'behind'
    : harnessKnown ? 'current' : harnessReachable ? 'indeterminate' : 'unknown',
}

// ---------------------------------------------------------------- overlay side

const overlayUrl = git('config', '--get', 'remote.upstream.url')
const overlaySlug = toSlug(overlayUrl)
const overlayRef = git('rev-parse', '--verify', '--quiet', 'refs/remotes/upstream/master')

// The last-merged point is DERIVED, never hand-maintained: it is the merge-base of
// our master and the overlay's master. A stale `upstream/master` does not move it —
// every commit fetched later is a descendant of that base — so the watch needs no
// fetch, and the number self-corrects the moment an overlay merge actually lands.
const lastMerged = overlayRef ? git('merge-base', 'origin/master', 'refs/remotes/upstream/master') : null
if (!overlayRef) {
  warn('no refs/remotes/upstream/master in this checkout — run `git fetch upstream` once (read-only) to enable overlay tracking')
}

const overlayHead = overlaySlug ? ghApi(`repos/${overlaySlug}/commits/master`) : null
const overlayCompare = lastMerged && overlayHead
  ? ghApi(`repos/${overlaySlug}/compare/${lastMerged}...${overlayHead.sha}`)
  : null
// `repos/{slug}.open_issues_count` counts issues AND pull requests together, so it
// cannot answer "how many open PRs" — the search endpoint can.
const overlayPullRequests = overlaySlug
  ? ghApi(`search/issues?q=${encodeURIComponent(`repo:${overlaySlug} is:pr is:open`)}&per_page=1`)
  : null

const overlay = {
  repository: overlaySlug,
  lastMergedCommit: lastMerged,
  lastMergedSource: 'merge-base(origin/master, refs/remotes/upstream/master)',
  localRefCommit: overlayRef,
  // The local remote-tracking ref does not affect `lastMergedCommit`, but a stale one
  // means the watch's local half is older than the numbers reported from the API.
  localRefIsStale: overlayRef && overlayHead ? overlayRef !== overlayHead.sha : null,
  headCommit: overlayHead?.sha ?? null,
  headDate: overlayHead?.commit?.committer?.date ?? null,
  commitsBehind: overlayCompare?.ahead_by ?? null,
  openPullRequests: overlayPullRequests?.total_count ?? null,
  status: overlayCompare ? (overlayCompare.ahead_by > 0 ? 'behind' : 'current') : 'unknown',
}

// ---------------------------------------------------------------- patch surface

const resolutions = workspace.resolutions ?? {}
const patchFiles = readdirSync(resolve(root, 'patches')).filter(name => name.endsWith('.patch')).sort()
const lockfileLines = readFileSync(resolve(root, 'yarn.lock'), 'utf8').split('\n')

const patches = patchFiles.map(file => {
  const body = readFileSync(resolve(root, 'patches', file), 'utf8')
  const stem = file.replace(/\.patch$/u, '')
  const at = stem.lastIndexOf('@')
  const packageName = at === -1 ? stem : stem.slice(0, at)
  const version = at === -1 ? null : stem.slice(at + 1)

  const targets = [...body.matchAll(/^\+\+\+ b\/(.+)$/gmu)].map(match => match[1].trim())
  // Bundlers emit content-hashed filenames; the same logical file reappears under a
  // different name on the next release, so these patches fail to apply by PATH
  // rather than by content and need the target re-identified, not just re-hunked.
  const hashNamedTargets = targets.filter(target => /-[A-Za-z0-9_-]{8}\.[cm]?js$/u.test(target))
  const hunks = (body.match(/^@@ /gmu) ?? []).length
  // A patch nobody references is dead weight; a resolution pointing at a missing
  // patch breaks install. Both are pin-bump hazards, so report the wiring.
  const wiredResolutions = Object.entries(resolutions)
    .filter(([, target]) => target.includes(`./patches/${file}`))
    .map(([selector]) => selector)
  // A resolutions entry only expresses intent. The proof that the patch is actually
  // in the installed tree is a `patch:` locator naming this file in the lockfile.
  const lockLocators = lockfileLines
    .filter(line => line.startsWith('  resolution: ') && line.includes(`./patches/${file}::`))
    .length

  return {
    file,
    package: packageName,
    version,
    // Only the harness-versioned patches have to be renamed and re-cut on a pin
    // bump; `app-builder-lib` and friends move on their own dependency's schedule.
    tracksHarnessPin: version === upstreamJson.runtimePackageVersion,
    hunks,
    targets,
    hashNamedTargets,
    wiredResolutions,
    lockLocators,
  }
})

for (const patch of patches) {
  if (patch.wiredResolutions.length === 0) {
    warn(`patch ${patch.file} is referenced by no resolutions entry — it is not applied to anything`)
  } else if (patch.lockLocators === 0) {
    warn(`patch ${patch.file} has resolutions entries but no patch: locator in yarn.lock — nothing in the installed tree uses it`)
  }
}
for (const [selector, target] of Object.entries(resolutions)) {
  const referenced = /\.\/patches\/([^"]+\.patch)/u.exec(target)?.[1]
  if (referenced && !patchFiles.includes(referenced)) {
    warn(`resolutions["${selector}"] points at patches/${referenced}, which does not exist`)
  }
}

const revalidation = patches.filter(patch => patch.tracksHarnessPin)

// ----------------------------------------------------------------- bump surface
//
// Every manifest entry pinned EXACTLY to the current runtimePackageVersion has to
// move in the same commit as the pin, or the tree is half-bumped. Enumerating them
// turns "bump the pin" into a countable worklist instead of a search.

const version = upstreamJson.runtimePackageVersion
const manifests = ['package.json', ...(workspace.workspaces ?? []).map(name => `${name}/package.json`)]

const bumpSurface = manifests.map(path => {
  const manifest = readJson(path)
  const fields = {}
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const pinned = Object.entries(manifest[field] ?? {})
      .filter(([, range]) => range === version)
      .map(([name]) => name)
    if (pinned.length > 0) fields[field] = pinned
  }
  // Resolutions selectors carry the version in either half and in both exact and
  // caret form, so this is a "mentions the version" match, not an exact-pin match.
  const pinnedResolutions = Object.entries(manifest.resolutions ?? {})
    .filter(([selector, target]) => selector.includes(version) || target.includes(version))
    .map(([selector]) => selector)
  if (pinnedResolutions.length > 0) fields.resolutions = pinnedResolutions
  const total = Object.values(fields).reduce((sum, entries) => sum + entries.length, 0)
  return { path, fields, total }
}).filter(entry => entry.total > 0)

const bumpSurfaceTotal = bumpSurface.reduce((sum, entry) => sum + entry.total, 0)

// ---------------------------------------------------------------------- render

// `verdict` gives a machine consumer the same conclusion the human ACTION line
// carries, so `--json` cannot be read as a clean bill of health when the text form
// would have said otherwise.
const verdict = harness.status === 'behind' || overlay.status === 'behind'
  ? 'behind'
  : [harness.status, overlay.status].some(status => status === 'unknown' || status === 'indeterminate')
    ? 'inconclusive'
    : 'current'

const report = { generatedAt: new Date().toISOString(), offline, verdict, harness, overlay, patches, bumpSurface, warnings }

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}

const lines = []
const say = line => lines.push(line)
const shortSha = sha => (sha ? sha.slice(0, 10) : '(unknown)')

say('UPSTREAM WATCH — read-only report (no pin was changed)')
say(`generated ${report.generatedAt}${offline ? ' [offline: local facts only]' : ''}`)
say('')
say(`HARNESS  ${harness.repository}  [${harness.status}]`)
say(`  pinned        ${harness.pinned.sourceVersion}  ${shortSha(harness.pinned.commit)}${harness.pinned.tag ? `  (${harness.pinned.tag})` : ''}`)
say(`  gitlink       ${shortSha(harness.pinned.submoduleGitlink)}${harness.pinned.submoduleGitlink === harness.pinned.commit ? '  matches upstream.json' : '  DRIFT vs upstream.json'}`)
say(`  latest release ${latestRelease ? `${latestRelease.tag}  ${latestRelease.publishedAt}${latestRelease.prerelease ? '  (prerelease)' : ''}` : '(unknown)'}`)
say(`  releases behind ${harness.releasesBehind ?? '(unknown)'}`)
for (const release of harness.newerReleases) {
  say(`    - ${release.tag}  ${release.publishedAt}${release.prerelease ? '  (prerelease)' : ''}`)
}
say(`  commits behind ${harness.defaultBranch ?? 'default branch'}: ${harness.commitsBehindDefaultBranch ?? '(unknown)'}`)
say('')
say(`OVERLAY  ${overlay.repository ?? '(no upstream remote)'}  [${overlay.status}]`)
say(`  last merged   ${shortSha(overlay.lastMergedCommit)}   via ${overlay.lastMergedSource}`)
say(`  overlay head  ${shortSha(overlay.headCommit)}${overlay.headDate ? `  ${overlay.headDate}` : ''}`)
say(`  commits behind ${overlay.commitsBehind ?? '(unknown)'}`)
say(`  open PRs upstream ${overlay.openPullRequests ?? '(unknown)'}`)
say(`  local upstream/master ref ${shortSha(overlay.localRefCommit)}${overlay.localRefIsStale ? '  (stale — a fetch would advance it)' : ''}`)
say('')
say(`PATCHES  ${patches.length} total — ${revalidation.length} pinned to the harness version and re-validated on any bump`)
for (const patch of patches) {
  const marker = patch.tracksHarnessPin ? 'RE-VALIDATE' : 'independent '
  say(`  ${marker}  ${patch.file}`)
  say(`                ${patch.hunks} hunk(s) -> ${patch.targets.join(', ') || '(no targets parsed)'}`)
  if (patch.hashNamedTargets.length > 0) {
    say(`                HASH-NAMED TARGET: ${patch.hashNamedTargets.join(', ')} — filename will change across releases`)
  }
  say(`                resolutions: ${patch.wiredResolutions.length}   yarn.lock patch: locators: ${patch.lockLocators}`)
}
say('')
say(`BUMP SURFACE  ${bumpSurfaceTotal} manifest entries carrying ${upstreamJson.runtimePackageVersion} — all move in the pin-bump commit`)
for (const entry of bumpSurface) {
  say(`  ${entry.path}  ${Object.entries(entry.fields).map(([field, entries]) => `${field}: ${entries.length}`).join('   ')}`)
}
say('  (--json lists every entry by name; dependency entries are exact pins, resolutions selectors carry the version in exact or caret form)')
say('')
if (warnings.length > 0) {
  say('WARNINGS')
  for (const message of warnings) say(`  - ${message}`)
  say('')
}
if (verdict === 'behind') {
  say('ACTION: report the delta to the RM. A pin bump is an RM inherit/adapt/hold-back/skip decision — see .engineering/upstream-watch.md.')
} else if (verdict === 'inconclusive') {
  say('ACTION: inconclusive — the drift could not be established for at least one upstream (see WARNINGS / --offline). This is NOT a clean bill of health.')
} else {
  say('ACTION: none. Pin is current against the latest harness release; no overlay commits to merge.')
}

process.stdout.write(`${lines.join('\n')}\n`)
