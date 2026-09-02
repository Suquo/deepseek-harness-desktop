# Implementation Report: Fence undeclared reasoning disables in remaining pi-ai dialects

**Plan**: `.engineering/plans/completed/issue-62-reasoning-disable-remainder.plan.md` (`Source: inline-capture`)
**Branch**: `pm/issue-62-reasoning-disable-remainder`
**Status**: ✅ COMPLETE
**Tracker ref**: #62

## Summary

The pinned pi-ai patch now prevents unsupported reasoning-disable fields in its DeepSeek and Azure Responses dialects. DeepSeek dispatch honors explicit catalog values first, falls back to a provider-documented exported model table, and otherwise omits; Azure sends only a declared string. The real adapter/loopback fence covers both dialects and exhaustively classifies the pinned DeepSeek catalog.

## Tasks Completed

| # | Task | File | Status |
|---|---|---|---|
| 1 | Add per-dialect wire pairs and catalog census | `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts` | ✅ |
| 2 | Add exported allowlist and DeepSeek/Azure guards | `patches/pi-ai@0.82.1.patch` | ✅ |
| 3 | Refresh the installed patch locator | `yarn.lock` | ✅ |
| 4 | Add Lane C revalidation obligation | `.engineering/upstream-watch.md` | ✅ |

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Build | ✅ | `corepack yarn build` |
| Type check | ✅ | `corepack yarn typecheck` |
| Lint | N/A | No lint command configured |
| Tests | ✅ | Desktop: 83 files, 884 passed/4 skipped; market: 19 files, 272 passed; preset: 164 passed |
| E2E | ✅ | Real llm runtime + pi-ai adapter sent nine test scenarios only to a bound `127.0.0.1` endpoint |

## Files Changed

| File | Action |
|---|---|
| `patches/pi-ai@0.82.1.patch` | UPDATE |
| `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts` | UPDATE |
| `.engineering/upstream-watch.md` | UPDATE |
| `yarn.lock` | UPDATE |
| `.engineering/plans/completed/issue-62-reasoning-disable-remainder.plan.md` | CREATE |
| `.engineering/reports/issue-62-reasoning-disable-remainder-report.md` | CREATE |

## Tests Written

| Test File | Test Cases |
|---|---|
| `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts` | DeepSeek thinking-only omission + allowlisted fallback + string/null precedence; Azure undeclared omission + string preservation; exhaustive 33-route absent-Off census |

## TDD Evidence

- Red: the focused file ran 9 tests with exactly 3 failures—the DeepSeek invention, Azure invention, and missing exported allowlist census—while all six existing PR #61 cases passed.
- Green: the same focused file ran 9/9 after the patch was generated and installed through Yarn.

## Deviations from Plan

- The first configured validation run found the pinned submodule uninitialized. `git submodule update --init --recursive` restored the required checkout without changing its pin; the complete validation then passed.
- A profile-level valueless `off:` is deliberately materialized as map-key absence, so it cannot represent the RM's explicit catalog-null precedence case. The fence uses the installed `moonshotai/kimi-k2.7-code` entry, which genuinely carries `off:null`.

## Architectural Decisions Surfaced

No new ADR. H-0001 governed the minimal Yarn-patch approach and prohibited submodule edits. The RM's exported allowlist choice is a localized, deliberately reversible pin workaround whose citations and membership must be re-grounded on every pi-ai bump; the durable revalidation obligation is recorded in `.engineering/upstream-watch.md`.

## System Evolution Notes

The configured validation runner assumes the pinned submodule is initialized; the prerequisite is already explicit in AGENTS.md and the complete gate's layout step.

## Next Steps

1. Run `corepack yarn check` against the committed head and preserve its tail beside `git rev-parse HEAD`.
2. Push the branch and open a PR with `Refs #62`; leave the issue open pending a live provider datum.

