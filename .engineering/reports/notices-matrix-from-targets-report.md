# Implementation Report: Notices Matrix From Electron Builder Targets

**Plan**: `.engineering/plans/completed/notices-matrix-from-targets.plan.md` (`Source: inline-capture`)
**Branch**: `claude/issue-81-notices-matrix-from-targets`
**Status**: ✅ COMPLETE
**Tracker ref**: #81

## Summary

The license verifier now derives exact `(os, cpu, libc)` tuples from the Electron Builder target declarations instead of maintaining an independent OS/CPU cross-product. The current manifest resolves to Darwin x64/arm64, Windows x64, and Linux glibc x64/arm64, so the regenerated notices remove exactly the four linuxmusl and four win32-arm64 packages that no configured target ships.

The same change replaces locale-sensitive notice ordering with codepoint comparison, directly covers a non-zero Yarn archive-metadata fetch, and consolidates the duplicated missing-lock diagnostic without rejecting installed required dependencies.

## Tasks Completed

| # | Task | File | Status |
|---|---|---|---|
| 1 | Derive and fence the release platform matrix | `dsh-plugin-desktop/scripts/verify-licenses.mjs` | ✅ |
| 2 | Cover target architectures, libc, sorting, and archive-fetch failure | `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | ✅ |
| 3 | Regenerate the ruled target-excluded rows | `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` | ✅ |

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Build | ✅ | `corepack yarn build` |
| Type check | ✅ | `corepack yarn typecheck` |
| Lint | N/A | No lint command is configured |
| Tests | ✅ | Desktop 876 passed / 4 skipped; market 272 passed; preset 164 passed |
| Focused license check | ✅ | 7 specs; 558 production packages; 5 notice-required |
| Full gate | ✅ | `corepack yarn check` at `2fec53708167a399acc67c393d054960ab063e0a`; closure 201 nodes |
| GUI | N/A | Not launched: this is a headless release-accounting change with no product runtime path |

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `dsh-plugin-desktop/scripts/verify-licenses.mjs` | UPDATE | Derive target tuples, use codepoint sort, expose the archive-read test seam, and consolidate the missing-lock path |
| `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | UPDATE | Fence the actual matrix plus target/libc mutations, non-zero fetches, and sorting |
| `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` | UPDATE | Delete exactly eight rows unsupported by the target set |

## Tests Written

| Test File | Test Cases |
|---|---|
| `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | Actual Electron Builder matrix snapshot; explicit per-target architecture and musl selection; non-zero archive metadata fetch; codepoint notice ordering |

## Integrity Proofs

| Scenario | Result |
|---|---|
| Change `build.win.target[0].arch` from x64 to arm64 at clean committed head | Matrix snapshot failed, showing the derived tuple changed from win32/x64 to win32/arm64 |
| Run the notices verifier directly under that mutation | Exit 1 with `verify-licenses: THIRD_PARTY_NOTICES.md is out of date` and the exact regeneration command |
| Restore the target through an explicit patch | Tracked tree returned clean and `verify:licenses` returned green |
| Compare generated notices to `origin/master` | `0` additions / `8` deletions; every deleted row contains either `linuxmusl` or `win32-arm64` |

## Self-Review

The required two-axis review against `origin/master` found one Standards issue and no implementation defect: the codepoint-order spec compared substring positions instead of fencing the exact rendered structure. The spec now asserts the complete notice document. The Spec axis found only the then-pending delivery steps (final push and closing PR), which are completed after this report commit.

## Deviations from Plan

- The original inline plan carried the RM's superseded premise that only musl rows would be removed. The #81 ruling selected exact target derivation, so the plan and implementation use the ruled eight-row set: four linuxmusl plus four win32-arm64 rows.
- The first configured validation attempt found the worktree's pinned upstream submodule uninitialized and failed only on ENOENT fixture reads. `git submodule update --init --recursive` restored exact pin `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; the unchanged validation suite then passed.
- Consolidating the duplicate missing-lock branch initially checked installed required dependencies too early and exposed two false failures. The final flow preserves installed required packages while keeping one missing-lock diagnostic branch.

## Architectural Decisions Surfaced

None. The source of truth was already the Electron Builder configuration; deriving a release-accounting matrix from it is a local, reversible drift fix that does not alter the fork/upstream boundary, runtime composition, packaging architecture, or headless-safety policy.

## System Evolution Notes

The initial brief contained mutually incompatible notice-diff and target-matrix requirements. The resolver freeze/ruling protocol caught the conflict before implementation; the issue ruling now records the target set as authoritative for future architecture additions.

## Next Steps

1. Run the final full gate at the report-and-review head and open the closing PR.
2. Hold for the Repo Manager's verdict; the Repo Manager owns merge.
