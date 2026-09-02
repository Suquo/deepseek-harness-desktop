# Implementation Report: Electron Install Integrity Fence

**Plan**: `.engineering/plans/completed/electron-install-integrity.plan.md` (`Source: inline-capture`)
**Branch**: `claude/issue-64-worktree-install-integrity`
**Status**: ✅ COMPLETE
**Tracker ref**: #64

## Summary

Electron 43.4.0 has no lifecycle install script, and this repository disables dependency lifecycle scripts through `.yarnrc.yml` in any case. Instead, `electron/index.js` lazily invokes `install.js` on first import; an immutable install does not import Electron, so a fresh worktree keeps package sources without `path.txt` or `dist` until a later Electron-importing target runs. The root gate now invokes that same download-only installer before verifying `path.txt` and its referenced executable, and emits `ElectronInstallIntegrityError` with the appropriate dependency or binary-install remedy only if Electron remains unusable.

## Tasks Completed

| # | Task | File | Status |
|---|---|---|---|
| 1 | Add a cross-platform Electron ensure-then-verify check | `scripts/verify-electron-install.mjs` | ✅ |
| 2 | Cover installed, ensured, absent-package, missing, and escaping paths | `scripts/verify-electron-install.spec.mjs` | ✅ |
| 3 | Run the check from the root gate | `package.json` | ✅ |
| 4 | Fence root-gate membership without constraining order | `scripts/verify-layout.mjs` | ✅ |

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Build | ✅ | `corepack yarn build` |
| Type check | ✅ | `corepack yarn typecheck` |
| Lint | N/A | No lint command is configured |
| Tests | ✅ | Desktop 847 passed / 4 skipped; market 272 passed; preset 159 passed; verifier 9 passed |
| CLI E2E | ✅ | With both `path.txt` and `dist` absent, `check:electron` invoked `install.js`, restored the binary without launching it, and passed verification |
| Full gate | ✅ | `corepack yarn check`; closure 200 nodes, licenses 543 packages |
| GUI | N/A | Not launched: the change is a headless environment-integrity preflight with no product UI/runtime behavior |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `scripts/verify-electron-install.mjs` | CREATE | ensure, verify, and named dependency/binary failures |
| `scripts/verify-electron-install.spec.mjs` | CREATE | nine focused cases |
| `scripts/verify-layout.mjs` | UPDATE | declaration-anchored gate-membership fence |
| `package.json` | UPDATE | `check:electron` and root-check wiring |

## Tests Written

| Test File | Test Cases |
|---|---|
| `scripts/verify-electron-install.spec.mjs` | Linux, Windows, and macOS binary paths; workspace ensure success/failure; absent package; missing `path.txt`; missing referenced binary; path escaping `dist` |

## Integrity Proofs

| Scenario | Result |
|---|---|
| Move both `electron/path.txt` and `electron/dist` out of the worktree | `check:electron` invoked `install.js`, recreated both, verified the executable, and exited 0 |
| Installer returns nonzero and leaves no binary | Focused test emits `ElectronInstallIntegrityError` with the explicit `install-electron` remedy |
| `electron/package.json` cannot be resolved | Focused test emits `ElectronInstallIntegrityError` with `corepack yarn install --immutable` |

## Self-Review

The pre-PR review missed that the local machine had already run Electron's installer. RM-dispatched CI exposed that all fresh runners failed before reaching the lazy import that previously downloaded Electron. The requested-change cycle corrects the check to ensure then verify, removes the unnecessary ordering coupling, and adds direct coverage for the workspace entry and absent package.

## Deviations from Plan

- The prepared worktree lacked its upstream submodule checkout. The pinned commit was cloned locally without editing upstream source so `check:layout` and the full gate could run.
- The initial plan specified verify-only behavior and an exact-order layout fence. CI and RM source review proved both wrong for fresh runners, so the implementation now self-heals through Electron's own installer and fences membership only.

## Architectural Decisions Surfaced

None. The ensure-then-verify check is a small, reversible prerequisite fence around Electron's existing lazy-install contract; it does not change the fork/upstream relationship, packaging architecture, plugin composition, or headless-safety policy, so it does not meet the three-part ADR threshold.

## System Evolution Notes

The original diagnosis stopped at Electron 43.4.0's missing lifecycle script. The complete contract spans both manifest and entry point: `index.js` owns lazy acquisition through `install.js`, while `.yarnrc.yml` independently suppresses lifecycle scripts. Future Electron bumps must review both package metadata and entry-point behavior alongside runtime and packaging compatibility.

## Next Steps

1. Push the requested-change fix with the final gate tail and integrity proofs.
2. Hold for the Repo Manager's re-dispatch and next verdict; the Repo Manager owns merge.
