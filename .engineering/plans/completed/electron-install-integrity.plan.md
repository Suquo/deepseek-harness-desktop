# Plan: Electron Install Integrity Fence

## Summary

Add a headless, gate-adjacent verifier that resolves the Electron dependency from the desktop workspace, reads Electron's installed `path.txt`, and asserts the referenced binary exists before the product gate reaches desktop targets. The failure will use a named error and prescribe the root Yarn command that explicitly runs Electron 42+'s `install-electron` binary.

## User Story

As a desktop contributor
I want the full gate to fail immediately when Electron's binary was not installed
So that a successful immutable dependency install cannot leave a confusing or stale runtime environment

## Metadata

| Field | Value |
|---|---|
| Type | BUG_FIX |
| Complexity | LOW |
| Source | inline-capture |
| Systems Affected | Root headless gate, desktop native-runtime prerequisites |
| Tracker | github |
| Issue | #64 |
| Source PRD | N/A |

---

## Root-Cause Analysis

Electron 42+ intentionally removed its npm `postinstall` download. Electron 43.4.0 exposes `install-electron` as a bin but declares no lifecycle script, so `corepack yarn install --immutable` correctly exits zero after installing package sources while `dsh-plugin-desktop/node_modules/electron/dist` remains absent. The shared Yarn cache contains the complete npm archive, no `ELECTRON_SKIP_BINARY_DOWNLOAD` variable is set, and neither cache state nor Yarn's build-script policy can schedule a lifecycle script the package no longer declares.

## Patterns to Follow

### Naming and Error Handling

```js
// SOURCE: scripts/verify-layout.mjs:5-12
const root = resolve(import.meta.dirname, '..')
const fail = message => { throw new Error(`verify-layout: ${message}`) }
```

Use one verifier-specific error class so the failure is machine- and human-identifiable, and keep the remediation in the thrown message.

### Gate Wiring

```json
// SOURCE: package.json:65-66
"check:layout": "node scripts/verify-layout.mjs",
"check": "yarn check:layout && ..."
```

Wire the verifier immediately after layout validation and before workspace gates. Keep the check headless.

### Tests

```js
// SOURCE: dsh-plugin-desktop/scripts/runtime-closure.spec.mjs:1-4
import assert from 'node:assert/strict'
import test from 'node:test'
```

Use Node's built-in test runner for the root script and temporary fixture directories for present/missing installations.

---

## Files to Change

| File | Action | Purpose |
|---|---|---|
| `scripts/verify-electron-install.mjs` | CREATE | Resolve and verify Electron's installed binary with a named remedial error |
| `scripts/verify-electron-install.spec.mjs` | CREATE | Cover valid, missing-metadata, and missing-binary states |
| `scripts/verify-layout.mjs` | UPDATE | Declaration-anchor the new check and its membership in the root gate |
| `package.json` | UPDATE | Add `check:electron` and run it before workspace checks |

---

## Tasks

### Task 1: Add the Electron installation verifier and focused tests

- **Files**: `scripts/verify-electron-install.mjs`, `scripts/verify-electron-install.spec.mjs`
- **Action**: CREATE
- **Implement**: Resolve Electron relative to `dsh-plugin-desktop`, verify `path.txt` and the referenced file under `dist`, and throw `ElectronInstallIntegrityError` with the exact explicit-install remedy on either absence.
- **Mirror**: `dsh-plugin-desktop/scripts/runtime-closure.spec.mjs:1-4` — use Node's built-in test runner and strict assertions.
- **Validate**: `node --test scripts/verify-electron-install.spec.mjs`

### Task 2: Wire and fence the verifier in the root gate

- **Files**: `package.json`, `scripts/verify-layout.mjs`
- **Action**: UPDATE
- **Implement**: Add the exact `check:electron` command, place `yarn check:electron` immediately after `yarn check:layout`, and assert both declarations using exact chain segments.
- **Mirror**: `scripts/verify-layout.mjs:39-56` — use `chainRuns` rather than substring matching.
- **Validate**: `corepack yarn check:layout`; before installing Electron, `corepack yarn check:electron` must fail with the named remedy.

---

## End-to-End Verification

1. In the reproducing worktree, run `corepack yarn check:electron` and verify it fails with `ElectronInstallIntegrityError` plus `corepack yarn workspace dsh-plugin-desktop exec install-electron`.
2. Run that remedy explicitly; do not launch Electron.
3. Re-run the original `existsSync` reproduction and `corepack yarn check:electron`; verify both pass.
4. From a committed clean tree, temporarily rename `dsh-plugin-desktop/node_modules/electron/dist`, run `corepack yarn check:electron`, verify the same named failure, and restore the directory.
5. Run the full headless gate: `corepack yarn check`.

---

## Validation

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

There is no lint script or GUI E2E suite. This environment-integrity change is validated through its CLI failure/pass path and must not launch a GUI.

---

## Acceptance Criteria

- [ ] Missing Electron install metadata and binaries fail with a named error and exact remedy
- [ ] Present platform binary passes without launching Electron
- [ ] The root full gate runs the integrity check before desktop workspace targets
- [ ] Declaration-anchored layout assertions prevent the check from silently leaving the gate
- [ ] Focused tests and the full headless gate pass
- [ ] Mutation proof demonstrates the committed fence bites
- [ ] Issue #64 is updated on completion
