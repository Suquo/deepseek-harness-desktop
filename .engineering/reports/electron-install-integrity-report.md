# Implementation Report: Electron Install Integrity Fence

**Plan**: `.engineering/plans/completed/electron-install-integrity.plan.md` (`Source: inline-capture`)
**Branch**: `claude/issue-64-worktree-install-integrity`
**Status**: ✅ COMPLETE
**Tracker ref**: #64

## Summary

Electron 42+ deliberately stopped downloading its binary from an npm lifecycle script, so Yarn 4 correctly installed Electron 43.4.0's package sources without creating `dist`. The root gate now resolves Electron from the desktop workspace and fails before any workspace target when `path.txt` or its referenced executable is missing, naming `ElectronInstallIntegrityError` and the explicit `corepack yarn workspace dsh-plugin-desktop exec install-electron` remedy.

## Tasks Completed

| # | Task | File | Status |
|---|---|---|---|
| 1 | Add a cross-platform Electron binary verifier | `scripts/verify-electron-install.mjs` | ✅ |
| 2 | Cover installed, missing, and escaping paths | `scripts/verify-electron-install.spec.mjs` | ✅ |
| 3 | Run the verifier before workspace gates | `package.json` | ✅ |
| 4 | Fence the check declaration and exact ordering | `scripts/verify-layout.mjs` | ✅ |

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Build | ✅ | `corepack yarn build` |
| Type check | ✅ | `corepack yarn typecheck` |
| Lint | N/A | No lint command is configured |
| Tests | ✅ | Desktop 847 passed / 4 skipped; market 272 passed; preset 159 passed; verifier 6 passed |
| CLI E2E | ✅ | Missing install failed with the named remedy; explicit install changed the original reproduction and verifier to green |
| Full gate | ✅ | `corepack yarn check`; closure 200 nodes, licenses 543 packages |
| GUI | N/A | Not launched: the change is a headless environment-integrity preflight with no product UI/runtime behavior |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `scripts/verify-electron-install.mjs` | CREATE | +70 |
| `scripts/verify-electron-install.spec.mjs` | CREATE | +79 |
| `scripts/verify-layout.mjs` | UPDATE | gate membership/order fence |
| `package.json` | UPDATE | `check:electron` and root-check wiring |

## Tests Written

| Test File | Test Cases |
|---|---|
| `scripts/verify-electron-install.spec.mjs` | Linux, Windows, and macOS binary paths; missing `path.txt`; missing referenced binary; path escaping `dist` |

## Mutation Proofs

Both mutations started from a committed clean tree and were restored before validation continued.

| Mutation | Expected red signal | Result after restore |
|---|---|---|
| Rename `dsh-plugin-desktop/node_modules/electron/dist` | `ElectronInstallIntegrityError` naming the missing executable and exact install remedy | `check:electron` green |
| Delete `yarn check:layout` from the root `check` chain | `verify-layout: the root check script must run yarn check:electron immediately after yarn check:layout` | `check:layout` green |

## Self-Review

The Spec axis found no omissions, scope creep, or apparently incorrect behavior. The Standards axis found that the first adjacency expression could accidentally pass when `yarn check:layout` was absent (`0 === -1 + 1`) and noted duplicated chain parsing; commit `fb12e5c21d` explicitly rejects a missing layout segment and centralizes parsing. The requested deletion mutation then produced the named red signal above.

## Deviations from Plan

- The prepared worktree lacked its upstream submodule checkout. The pinned commit was cloned locally without editing upstream source so `check:layout` and the full gate could run.
- The self-review correction added one implementation increment before final validation; scope and intended behavior did not change.

## Architectural Decisions Surfaced

None. The verifier is a small, reversible prerequisite fence around Electron's documented install contract; it does not change the fork/upstream relationship, packaging architecture, plugin composition, or headless-safety policy, so it does not meet the three-part ADR threshold.

## System Evolution Notes

The original issue framed the symptom as a possible Yarn cache or skipped-postinstall problem. Electron 43.4.0's manifest and current upstream documentation establish a new explicit-install contract instead; future Electron major bumps should check install-contract changes alongside runtime and packaging compatibility.

## Next Steps

1. Open a PR with `Closes #64`, the final gate tail, and both mutation proofs.
2. Hold for the Repo Manager's verdict; the Repo Manager owns merge.
