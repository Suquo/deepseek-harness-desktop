# Plan: Notices Matrix From Electron Builder Targets

## Summary

Replace the license verifier's hardcoded platform cross-product with a release matrix derived from `dsh-plugin-desktop/package.json` Electron Builder targets. Match Linux optional packages against glibc unless an explicit musl target exists, preserve deterministic codepoint ordering, expose the locked-archive read seam for a non-zero-exit regression test, consolidate the duplicate missing-lock failure, and regenerate the committed notices file with only the unsupported musl rows removed.

## User Story

As a desktop release maintainer
I want third-party notices to follow the configured installer targets
So that the legal inventory neither claims unsupported binaries nor silently drifts when target architectures change

## Metadata

| Field | Value |
|---|---|
| Type | BUG_FIX |
| Complexity | MEDIUM |
| Source | inline-capture |
| Systems Affected | Desktop packaging license verification |
| Tracker | github |
| Issue | #81 |
| Source PRD | N/A |

---

## Constraints

- `AGENTS.md`: keep the gate headless and do not edit `deepseek-harness/`.
- ADR H-0001: keep the change in the desktop-owned overlay; no upstream fork edits.
- The committed `THIRD_PARTY_NOTICES.md` diff must consist only of the four unsupported linuxmusl and four unsupported win32-arm64 row deletions (RM ruling on #81).
- Target entries with explicit `arch` lists narrow that platform; string entries use the repository's supported x64/arm64 release default.

## Patterns to Follow

### Naming and data derivation

```js
// SOURCE: dsh-plugin-desktop/scripts/verify-licenses.mjs:119-133
export function createLockDescriptorIndex(lockfile) { /* derive an exact lookup from source data */ }
export function resolveLockedPackage(descriptors, name, range) { /* query the derived lookup */ }
```

### Error Handling

```js
// SOURCE: dsh-plugin-desktop/scripts/verify-licenses.mjs:223-226
if (result.status !== 0) {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
  throw new Error(`Yarn could not read locked optional package metadata: ${detail}`)
}
```

### Tests

```js
// SOURCE: dsh-plugin-desktop/scripts/verify-licenses.spec.mjs:28-42
test('resolves an optional dependency to the exact lockfile record', () => {
  // Arrange an isolated record, invoke the exported seam, assert the exact result.
})
```

---

## Files to Change

| File | Action | Purpose |
|---|---|---|
| `dsh-plugin-desktop/scripts/verify-licenses.mjs` | UPDATE | Derive and enforce target tuples, deterministic sort, testable archive failure, consolidated missing-lock error |
| `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | UPDATE | Cover target derivation/mutation, libc selection, sorting, and non-zero archive fetch |
| `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` | UPDATE | Remove unsupported musl and Windows arm64 rows through the generator |
| `.engineering/reports/notices-matrix-from-targets-report.md` | CREATE | Record implementation and validation evidence |

---

## Tasks

### Task 1: Derive and test the release platform matrix

- **Files**: verifier and focused spec
- **Action**: UPDATE
- **Implement**: Parse Electron Builder `build.mac`, `build.win`, and `build.linux` target entries into exact `(os, cpu, libc)` tuples; respect explicit per-target arch arrays; use x64/arm64 for string targets; default Linux targets to glibc and recognize explicit musl target names.
- **Mirror**: `dsh-plugin-desktop/scripts/verify-licenses.mjs:119-133` — pure derivation plus query helpers.
- **Validate**: `corepack yarn workspace dsh-plugin-desktop node --test scripts/verify-licenses.spec.mjs`

### Task 2: Harden deterministic output and failure coverage

- **Files**: verifier and focused spec
- **Action**: UPDATE
- **Implement**: Replace locale-sensitive sorting with codepoint comparison; inject/export the locked-archive reader's spawn seam and assert a non-zero result produces the named error; remove the duplicate missing-lock branch/message without weakening failure behavior.
- **Mirror**: `dsh-plugin-desktop/scripts/verify-licenses.mjs:223-226` — stable actionable failure text.
- **Validate**: `corepack yarn workspace dsh-plugin-desktop node --test scripts/verify-licenses.spec.mjs`

### Task 3: Regenerate and fence the notices asset

- **File**: `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md`
- **Action**: UPDATE
- **Implement**: Run the canonical regeneration command, verify the diff contains only the ruled eight deletions (four linuxmusl and four win32-arm64 rows), and run `verify:licenses`.
- **Mirror**: package script `verify:notices` in `dsh-plugin-desktop/package.json:131`.
- **Validate**: `corepack yarn workspace dsh-plugin-desktop verify:licenses`

---

## End-to-End Verification

This is a headless release-accounting change; launching Electron would not exercise it and is prohibited inside the gate.

1. Run the focused Node spec and `verify:licenses`.
2. From a clean committed tree, change one configured target architecture.
3. Run the named license verification and confirm the derived matrix/notices fence fails red.
4. Restore the mutation and verify the tree returns clean.
5. Run `corepack yarn check` in the worktree and record its tail beside `git rev-parse HEAD`.

---

## Validation

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

---

## Acceptance Criteria

- [ ] Matrix derives from Electron Builder targets and respects per-platform architectures.
- [ ] Linux defaults to glibc unless a musl target is configured.
- [ ] Notices change only by removing four linuxmusl and four win32-arm64 rows.
- [ ] Row sorting is a codepoint comparison.
- [ ] Non-zero locked-archive reads produce a named, directly tested error.
- [ ] Duplicate missing-lock reporting is consolidated.
- [ ] Target-architecture mutation makes the matrix/notices check fail.
- [ ] Full headless gate passes at the pushed commit.
- [ ] Self code review passes or all findings are resolved/disclosed.
- [ ] Issue is updated and the PR closes #81.
