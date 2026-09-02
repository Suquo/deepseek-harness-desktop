# Implementation Report: Notices Matrix From Electron Builder Targets

**Plan**: `.engineering/plans/completed/notices-matrix-from-targets.plan.md` (`Source: inline-capture`)
**Branch**: `claude/issue-81-notices-matrix-from-targets`
**Status**: ✅ COMPLETE
**Tracker ref**: #81

## Summary

The package manifest now owns an explicit fork distribution declaration: Darwin x64/arm64 (the packaging scripts build universal), Windows x64 (the Electron Builder target declares it), and Linux glibc x64/arm64 development builds. The license verifier consumes only that declaration and cross-fences it against platform-target presence plus every explicit Electron Builder target architecture, so arch-less host defaults are never mistaken for a release matrix.

The regenerated notices remove exactly the four linuxmusl and four win32-arm64 packages outside that declaration. Missing or unknown build shapes and declaration/build mismatches fail through the named `ReleaseMatrixConfigurationError` instead of shrinking notices cleanly.

The same change replaces locale-sensitive notice ordering with codepoint comparison, directly covers a non-zero Yarn archive-metadata fetch, and consolidates the duplicated missing-lock diagnostic without rejecting installed required dependencies.

## Tasks Completed

| # | Task | File | Status |
|---|---|---|---|
| 1 | Declare and cross-fence the release platform matrix | `dsh-plugin-desktop/package.json`, `dsh-plugin-desktop/scripts/verify-licenses.mjs` | ✅ |
| 2 | Cover every target shape, fail-closed mismatch, sorting, and archive-fetch failure | `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | ✅ |
| 3 | Regenerate the ruled target-excluded rows | `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` | ✅ |

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Build | ✅ | `corepack yarn build` |
| Type check | ✅ | `corepack yarn typecheck` |
| Lint | N/A | No lint command is configured |
| Tests | ✅ | Desktop 876 passed / 4 skipped; market 272 passed; preset 164 passed |
| Focused license check | ✅ | 21 specs; 558 production packages; 5 notice-required |
| Full gate | ✅ | `corepack yarn check`; exact requested-change HEAD and gate tail recorded in PR #85 |
| GUI | N/A | Not launched: this is a headless release-accounting change with no product runtime path |

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `dsh-plugin-desktop/package.json` | UPDATE | Declare the fork distribution set and its macOS/Windows/Linux provenance without changing `build` |
| `dsh-plugin-desktop/scripts/verify-licenses.mjs` | UPDATE | Resolve declared tuples, cross-fence build shapes/architectures, use codepoint sort, expose the archive-read test seam, and consolidate the missing-lock path |
| `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | UPDATE | Fence the actual declaration, every documented target shape, fail-closed mismatch paths, non-zero fetches, and sorting |
| `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` | UPDATE | Delete exactly eight rows unsupported by the target set |

## Tests Written

| Test File | Test Cases |
|---|---|
| `dsh-plugin-desktop/scripts/verify-licenses.spec.mjs` | Actual fork declaration; string, array, object, arch, and suffix target forms; absent build/section/target; undeclared or malformed build platform; invalid/empty target; explicit-arch mismatch; non-zero archive metadata fetch; codepoint notice ordering |

## Integrity Proofs

| Scenario | Result |
|---|---|
| Change `build.win.target[0].arch` from x64 to arm64 | Named configuration failure: the explicit target arch no longer equals the fork declaration |
| Change the declaration and explicit build arch together from x64 to arm64 | Configuration fence passes, then the notices byte comparison fails with the exact regeneration remedy |
| Restore both mutations through explicit patches | Tracked tree returns clean and `verify:licenses` returns green |
| Compare generated notices to `origin/master` | `0` additions / `8` deletions; every deleted row contains either `linuxmusl` or `win32-arm64` |

## Self-Review

The initial two-axis review found one Standards issue: the codepoint-order spec compared substring positions instead of fencing the exact rendered structure. That spec now asserts the complete notice document. The RM review then found the substantive B1 assumption: arch-less targets use `process.arch`, so they cannot define a host-independent release matrix. The requested-change implementation replaces that assumption with the explicit fork declaration and adds the B2/B3 fail-closed shape/mismatch coverage.

## Deviations from Plan

- The original inline plan carried the RM's superseded premise that only musl rows would be removed. The #81 ruling made the exact distribution set authoritative, so the plan and implementation use the ruled eight-row set: four linuxmusl plus four win32-arm64 rows.
- RM review proved that arch-less Electron Builder targets select the host architecture and that no musl target exists. The revised implementation declares the fork distribution set explicitly and uses Electron Builder configuration only as a two-direction platform/explicit-arch fence.
- The first configured validation attempt found the worktree's pinned upstream submodule uninitialized and failed only on ENOENT fixture reads. `git submodule update --init --recursive` restored exact pin `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; the unchanged validation suite then passed.
- Consolidating the duplicate missing-lock branch initially checked installed required dependencies too early and exposed two false failures. The final flow preserves installed required packages while keeping one missing-lock diagnostic branch.

## Architectural Decisions Surfaced

[ADR H-0005](../adrs/H-0005-fork-owned-release-matrix-for-notices.md) records the fork-owned notice matrix. It passes the ADR gate: reversing the new authoritative contract requires coordinated manifest, verifier, notices, tests, and packaging-policy changes; custom package metadata is surprising without the Electron Builder host-architecture context; and the explicit declaration was chosen over changing `build` or inferring from unequal packaging mechanisms.

## System Evolution Notes

The initial brief contained mutually incompatible notice-diff and target-matrix requirements. The resolver freeze/ruling protocol caught the conflict before implementation; the issue ruling now records the target set as authoritative for future architecture additions.

## Next Steps

1. Hold for the Repo Manager's verdict on PR #85; the Repo Manager owns merge.
