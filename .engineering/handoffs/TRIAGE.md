# Daily Triage

- Refreshed: 2026-09-14 08:08:57 +02:00
- Charter: triage-charter v1.1-pearl (user impact first; merged-PR verification addendum)
- Open issues: 18 | Active ranked: 18 | Likely fixed candidates: 0

## Top 10

| Rank | Issue | Title | Band | Rationale | In flight |
|---:|---:|---|:---:|---|:---:|
| 1 | #68 | 0.1.1 unified Files-API image pipeline vs desktop attachment surfaces (unvalidated; sharp segfaults under Electron on Linux) | S0 | User-impact triage: 0.1.1 unified Files-API image pipeline vs desktop attachment surfaces (unvalidated; sharp segfaults under Electron on Linux). | no |
| 2 | #88 | Tool runner closes a command's stdout early: Biome aborts with BrokenPipe (core dump per run) | S0 | User-impact triage: Tool runner closes a command's stdout early: Biome aborts with BrokenPipe (core dump per run). | no |
| 3 | #54 | read_image fallback: text-only session models should fall back to a registered image-capable route instead of hard-refusing | S1 | Held-live gate: verify the named production/owner acceptance gate before closure. | yes |
| 4 | #89 | Sandboxed dev servers outlive their task: accumulate, hold host ports, grow memory | S2 | User-impact triage: Sandboxed dev servers outlive their task: accumulate, hold host ports, grow memory. | no |
| 5 | #62 | Fabricated reasoning-disable remainder: pi-ai deepseek branch (33 models, fixed literal) + azure-openai-responses (7 models) | S2 | Held-live gate: verify the named production/owner acceptance gate before closure. | yes |
| 6 | #60 | Bare-route reasoning-disable: pi-ai openrouter dialect sends effort "none" for catalog models with no thinkingLevelMap (patch + upstream report) | S2 | User-impact triage: Bare-route reasoning-disable: pi-ai openrouter dialect sends effort "none" for catalog models with no thinkingLevelMap (patch + upstream report). | no |
| 7 | #69 | dsh-llm-deepseek wire patch: pending live confirmation at 0.1.1-rc.2 (hunk relocated 321 -> 1063) | S2 | Held-live gate: verify the named production/owner acceptance gate before closure. | yes |
| 8 | #30 | Host-plane real billed cost: OpenRouter usage.cost patch pair, or generation-id reconciliation | S2 | Held-live gate: verify the named production/owner acceptance gate before closure. | yes |
| 9 | #87 | Node version surfaces disagree: engines admits >=24 while CI builds 22.23.2 and lanes run 26.8.1 (plus lockfile provenance) | S2 | User-impact triage: Node version surfaces disagree: engines admits >=24 while CI builds 22.23.2 and lanes run 26.8.1 (plus lockfile provenance). | no |
| 10 | #7 | Consolidate skill roots: preset-local skill becomes canonical (W21) | S3 | User-impact triage: Consolidate skill roots: preset-local skill becomes canonical (W21). | no |

## Likely fixed by a merged PR: verify and close

- None identified in the current open issue set.

## Full ordered list

| Rank | Issue | Band | Title | Owner action / dependency |
|---:|---:|:---:|---|---|
| 1 | #88 | S0 | Tool runner closes a command's stdout early: Biome aborts with BrokenPipe (core dump per run) | owner verification and regression test |
| 2 | #68 | S0 | 0.1.1 unified Files-API image pipeline vs desktop attachment surfaces (unvalidated; sharp segfaults under Electron on Linux) | owner verification and regression test |
| 3 | #54 | S1 | read_image fallback: text-only session models should fall back to a registered image-capable route instead of hard-refusing | held-live acceptance gate |
| 4 | #89 | S2 | Sandboxed dev servers outlive their task: accumulate, hold host ports, grow memory | owner verification and regression test |
| 5 | #62 | S2 | Fabricated reasoning-disable remainder: pi-ai deepseek branch (33 models, fixed literal) + azure-openai-responses (7 models) | held-live acceptance gate |
| 6 | #87 | S2 | Node version surfaces disagree: engines admits >=24 while CI builds 22.23.2 and lanes run 26.8.1 (plus lockfile provenance) | owner verification and regression test |
| 7 | #30 | S2 | Host-plane real billed cost: OpenRouter usage.cost patch pair, or generation-id reconciliation | held-live acceptance gate |
| 8 | #69 | S2 | dsh-llm-deepseek wire patch: pending live confirmation at 0.1.1-rc.2 (hunk relocated 321 -> 1063) | held-live acceptance gate |
| 9 | #60 | S2 | Bare-route reasoning-disable: pi-ai openrouter dialect sends effort "none" for catalog models with no thinkingLevelMap (patch + upstream report) | owner verification and regression test |
| 10 | #7 | S3 | Consolidate skill roots: preset-local skill becomes canonical (W21) | owner verification and regression test |
| 11 | #83 | S4 | Bilingual fence gaps after #82: .en.md convention pairs have no records; working-tree walk does not prune build output dirs | owner verification and regression test |
| 12 | #24 | S4 | Command-level policy for node/uv/playwright (tools/pre-execute interception) | owner verification and regression test |
| 13 | #6 | S4 | Model A/B comparison protocol for definition builds | owner verification and regression test |
| 14 | #48 | S4 | Migrate branding to rc.8's official brand slots — retire ADR H-0002's hashed-class coupling | owner verification and regression test |
| 15 | #46 | S4 | Version drift outside the manifests is unfenced: ~220 literals in 17 files ride on discipline | owner verification and regression test |
| 16 | #45 | S4 | Trim-path amortization in lifecycle-events (now the dominant append cost — product call) | owner verification and regression test |
| 17 | #26 | S4 | Rebrand: Suquo Systems logo + wordmark at every in-app DeepSeek logo site | owner verification and regression test |
| 18 | #3 | S4 | Stand up CI: corepack yarn check on PRs | owner verification and regression test |

## Changes since last triage

- New active issues: none
- Significant rank moves (absolute delta >=3): #87 (9→6), #60 (6→9), #83 (14→11), #26 (13→17)
- No longer open: none
- Fixed candidates are excluded from the active rank and remain listed above for verification/closure.
