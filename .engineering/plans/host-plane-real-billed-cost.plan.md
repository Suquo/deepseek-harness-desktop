# Plan: Host-plane real billed cost reconciliation

## Summary

Implement issue #30 as the RM-ruled **Road B**: a desktop-owned Cordis Host plugin discovers
OpenRouter generation ids from the durable session surface, resolves `OPENROUTER_API_KEY` through
the Host credential service for one explicit reconciliation pass, and queries OpenRouter's fixed
generation endpoint behind a same-origin loopback route. The browser keeps its current live-list-rate
estimate immediately, then overlays a fifth `billed` cost state only for generation ids whose real
`total_cost` has arrived. Successful billed results are cached per generation id; absent, late, or
invalid results remain estimates and are eligible for the next user-requested pass. This does not
patch `dsh-llm`/`dsh-llm-pi-ai`, put credentials in the renderer, or replace an upstream slot,
service, or behavior.

## User Story

As a Parametria operator
I want to reconcile the per-generation list-rate estimates in the existing desktop cost badge with
OpenRouter's billed generation costs
So that I can distinguish invoice-backed spend from estimates without exposing my API key to the
renderer or coupling the desktop fork to upstream adapter patches.

## Metadata

| Field | Value |
|---|---|
| Type | ENHANCEMENT |
| Complexity | HIGH |
| Source | file-first |
| Systems Affected | desktop Host Cordis composition, loopback HTTP, credential access, session query, client cost surface, offline/client parity fences |
| Tracker | GitHub |
| Issue | #30 |
| Source PRD | N/A |
| Branch | `claude/issue-30-real-billed-cost` |
| Frozen base | `e4bdf47277dfec310d81dbd380f1963da770a2df` (`origin/master`, post-#85) |

---

## Constraints and Decisions

- Follow repository `AGENTS.md`: Node/Yarn pins, root Corepack commands, a fully headless gate, and
  no edits under `deepseek-harness/`.
- Follow accepted ADR [H-0001](../adrs/H-0001-fork-strategy-parametria-harness-overlay.md): the
  upstream checkout remains pinned and unmodified; this capability belongs in a desktop overlay.
- Road A (the coupled `dsh-llm` + `dsh-llm-pi-ai` Yarn-patch pair) is explicitly out of scope.
- The desktop patch is inserted immediately after `@deepseek-ai/dsh-web-app` for every selected Web
  profile by `prepareDesktopProfile()` (`dsh-plugin-desktop/src/profile.ts:437-445`). Mount the Host
  plugin in `dsh-plugin-desktop/cordis.patch.yml`, not the Parametria selected-profile patch. That is
  the additive desktop-owned composition point for compatibility and advanced mode alike.
- Keep the existing `conversation.chat.assistant-actions` contributor. The reconcile control may
  update only desktop-owned external-store state and call the desktop loopback route; it may not
  replace an upstream slot/service, dispatch an upstream event, or inspect upstream DOM structure.
- No gate or smoke may make a real OpenRouter request. Every outbound transport test injects a fake
  `fetch`; boot/profile smokes prove zero outbound requests.
- Post-stream OpenRouter availability is an unmeasured datum. A missing generation response is not
  failure and is never negatively cached. The PR must say that a real billed datum is pending-live,
  use `Refs #30`, and leave #30 open until that datum lands.

## Root Cause / Current Gap

The durable Host `assistant/message` event carries
`message.source.replayState.response.responseId`, and the offline Parametria join already extracts it
(`dsh-preset-parametria/scripts/session-cost.mjs:116-130`). The browser's projected
`AssistantMessageNode`, however, intentionally carries usage/provenance/timing but not adapter replay
state. Consequently the cost badge can calculate live-list-rate estimates but cannot safely discover
the OpenRouter join key. Passing the key through an upstream client projection would be Road A and
would couple this branch to upstream-wire patches. The Host can instead query the folded durable
surface and return only `(step, billed USD)` to the already-authorized renderer.

## Patterns to Follow

### Cordis mount and loopback ownership

```ts
// SOURCE: dsh-plugin-desktop/src/profile.ts:437-445
const desktopPatches = loadOverlayPatches(BIN_NAME, DESKTOP_PATCH_PATH)
for (const layer of activeDesktopProfileLayers(profile, disabledBundles)) {
  bundlePatches.push(...layer.patches)
  if (layer.packageName !== '@deepseek-ai/dsh-web-app') continue
  bundlePatches.push(...desktopPatches)
}
```

The new row therefore belongs beside the other desktop Host operations in
`dsh-plugin-desktop/cordis.patch.yml`. The plugin injects `desktopRuntime`, `webServer`, `credentials`,
and `sessionQuery`, requires the runtime to exist, and refuses a Web server host other than
`127.0.0.1` before registering its exact route.

### Route validation and effect cleanup

```ts
// SOURCE: dsh-plugin-desktop/src/directory-picker-route.ts:61-81
if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
if (req.headers.origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
  return finishJson(res, 415, { error: 'content type must be application/json' })
}
```

Use the same exact-origin, bounded-JSON, stable-status pattern and `ctx.effect(() =>
ctx.webServer.register(...), label)` lifecycle used by the desktop shell
(`dsh-plugin-desktop/src/index.ts:157-169`). The route and outbound readers each impose their own
byte ceiling.

### Fail-open fixed-endpoint transport

```ts
// SOURCE: dsh-plugin-desktop/src/update-checker.ts:98-123
const init: RequestInit = {
  method: 'GET',
  headers: { Accept: 'application/json' },
  cache: 'no-store',
  redirect: 'error',
  ...(options.signal === undefined ? {} : { signal: options.signal }),
}
```

Mirror the update checker's injected request adapter, fixed endpoint, redirect refusal, cancellation,
bounded body, `unknown` JSON parsing, and `null`/nonterminal result for transport or payload failures.
Add the bearer header only inside the Host request function; never include it in a response or log.

### Explicit cost-state exhaustiveness

```ts
// SOURCE: dsh-plugin-desktop/src/client/cost-model.ts:72-100
export type CostLine =
  | { readonly status: 'priced'; readonly usd: number }
  | { readonly status: 'free'; readonly usd: 0 }
  | { readonly status: 'unpriced'; readonly reason: string }
  | { readonly status: 'untokenized'; readonly reason: string }

export const COST_STATUSES = ['priced', 'free', 'unpriced', 'untokenized'] as const
```

Preserve the four-arm estimate as `EstimatedCostLine`, then define `CostLine` as that union plus
`{ status: 'billed'; usd; estimate }`. A `withBilledCost(estimate, usd)` helper creates the new arm,
so the list-rate value/reason never disappears. Mirror the status and overlay helper in the offline
implementation; `priceTokens`/`priceStep` themselves remain estimate-only and perform no network I/O.

### Shared generation-owned browser state

`installCostSurface()` currently creates one `RateSource` and injects it into every badge
(`dsh-plugin-desktop/src/client/cost-surface.ts:123-140`). Create one `BilledCostSource` in the same
generation-owned scope. Multiple badges for the same turn share one snapshot, one in-flight pass, and
one cache; subscribe/render does not start reconciliation. Dispose it with the slot, stylesheet, and
rate source.

---

## Route Contract

### Endpoint and admission

- Exact path: `POST /_dsh/desktop/openrouter-billing/reconcile`.
- Admit only when the Host plugin is running under `desktopRuntime`, `webServer.host` is exactly
  `127.0.0.1`, and `Origin` is exactly `http://127.0.0.1:<actual-port>`.
- Require `Content-Type: application/json`; limit request body to 16 KiB.
- Body: `{ "sessionId": "session-…", "turn": <positive safe integer> }`. Apply conservative string
  length/shape bounds. Do not accept renderer-supplied generation ids or arbitrary upstream URLs.
- Stable admission responses: `405` method, `403` origin, `415` content type, `400` malformed/invalid
  body, `404` unreadable/missing session. Admission failures happen before credential resolution or
  outbound transport.

### Host discovery

1. Call `ctx.sessionQuery.readSurface(sessionId)` once for the request. A live session wins over
   persistence, and the folded current surface matches the browser's visible trajectory window.
2. Select finalized `assistant/message` events for the requested turn.
3. Read the adapter-private inner response, not the outer route label. Accept only pi-ai replay v2
   whose response identifies OpenRouter and whose `responseId` matches a bounded `gen-…` shape.
4. Correlate each accepted id to its numeric `step`, deduplicate by generation id, and return no
   generation id to the renderer.

### One reconciliation pass

- Resolve `credentialRef('OPENROUTER_API_KEY')` once at the beginning of the accepted pass. Never
  cache the credential. Missing credentials yield an ordinary `200` estimated response and no fetch.
- For each uncached id, call only
  `GET https://openrouter.ai/api/v1/generation?id=<URLSearchParams encoded id>` with
  `Authorization: Bearer <resolved value>`, `Accept: application/json`, `cache: 'no-store'`, and
  `redirect: 'error'`.
- Bound a pass to at most 64 discovered ids, at most 4 concurrent outbound calls, 5 seconds per call,
  and 64 KiB per response. Entries beyond the cap remain estimated. Share an in-flight promise per
  generation id so overlapping passes cannot duplicate a request.
- Parse the response as `unknown`; accept only a finite, nonnegative numeric `data.total_cost`.
  Zero is valid billed cost and is distinct from the list-rate `free` estimate.
- Cache successful billed USD only, keyed by generation id for the current Cordis generation.
  `404`/not-yet-available, any other non-200, timeout, abort, transport failure, oversized body, and
  malformed payload are nonterminal and are not cached. They remain retryable on the next explicit
  pass.
- Plugin disposal unregisters the route, aborts current fetches, clears the success and in-flight
  maps, and makes late completions inert.

### Response

An admitted pass returns `200` even when OpenRouter or credentials are unavailable:

```json
{
  "results": [
    { "step": 1, "status": "billed", "usd": 0.001234 },
    { "step": 2, "status": "estimated" }
  ],
  "availability": "partial"
}
```

- `availability` is one of `complete`, `partial`, or `unavailable`; it is UI guidance, not a terminal
  cache state.
- Results are unique by step and contain no API key, Authorization value, provider body, upstream
  error text, or generation id.
- Unexpected accepted-request failures are reported with a stable generic `500`; logs carry only a
  sanitized category/count, never request headers, URLs containing ids, raw provider bodies, or
  credentials.

---

## Cost State Machine

| Current state | Reconcile observation | Next state | Retry? |
|---|---|---|---|
| `priced` / `free` / `unpriced` / `untokenized` | no click yet | same immediate estimate | yes |
| any estimate arm | valid finite `data.total_cost` (including `0`) | `billed { usd, estimate }` | no; Host/client success caches serve it |
| any estimate arm | no credential | same estimate; pass says unavailable | yes, next explicit click |
| any estimate arm | id absent, 404/not ready, non-200, timeout, network error, malformed/oversized response | same estimate | yes, next explicit click |
| `billed` | later pass or renderer rerender | same billed value | no outbound call |
| any state | client/plugin disposal before completion | prior snapshot; late result ignored | next generation may retry |

The per-turn fold keeps billed and estimated money separate:

- all numeric generations billed: `$X billed`;
- mixed numeric generations: `$X billed + ~$Y est.`;
- no billed values: retain the current list-rate estimate headline and floor semantics;
- unpriced/untokenized generations remain explicitly unknown and retain the `≥`/coverage warning.

Rows label actual values as billed and retain the original estimate in accessible title/detail text.
The provenance copy says exactly how many generations are billed and continues to timestamp the live
list rates used by the unresolved estimates. A click on **Reconcile billed cost** posts once for the
whole `(sessionId, turn)`; mounting, rendering, expanding, and subscribing issue no reconciliation
request. Loading/error feedback is desktop-owned and does not suppress the immediate estimate.

---

## Files to Change

| File | Action | Purpose |
|---|---|---|
| `.engineering/plans/host-plane-real-billed-cost.plan.md` | CREATE | Durable reviewed implementation handoff and freeze artifact. |
| `dsh-plugin-desktop/src/openrouter-billing-contract.ts` | CREATE | Shared path, request/response/result types and strict browser/Host validators. |
| `dsh-plugin-desktop/src/openrouter-billing.ts` | CREATE | Cordis Host plugin, durable-id discovery, bounded reconciler/cache, and exact loopback route. |
| `dsh-plugin-desktop/src/client/billed-costs.ts` | CREATE | Explicit-demand external store and same-origin route client; no eager I/O. |
| `dsh-plugin-desktop/tests/openrouter-billing.spec.ts` | CREATE | Host route, extraction, credential, transport, throttle, retry, cache, and teardown tests with fake fetch only. |
| `dsh-plugin-desktop/tests/client-billed-costs.spec.ts` | CREATE | Browser contract/store validation, coalescing, retry, cache, and disposal tests. |
| `dsh-plugin-desktop/cordis.patch.yml` | UPDATE | Add the desktop Host billing row after the shell, without replacing upstream rows/services. |
| `dsh-plugin-desktop/package.json` | UPDATE | Export `./openrouter-billing`. |
| `dsh-plugin-desktop/tsdown.config.ts` | UPDATE | Build the new Host plugin entry. |
| `dsh-plugin-desktop/tsconfig.tests.json` | UPDATE | Keep browser-only billed source out of the Host test compilation where required. |
| `dsh-plugin-desktop/tsconfig.tests.client.json` | UPDATE | Include the new browser source/test in client compilation. |
| `dsh-plugin-desktop/src/client/cost-model.ts` | UPDATE | Add `EstimatedCostLine`, exhaustive `billed` arm, overlay helper, and formatting. |
| `dsh-plugin-desktop/src/client/turn-cost.ts` | UPDATE | Apply billed values by turn/step and compute honest billed/estimated/unknown aggregates. |
| `dsh-plugin-desktop/src/client/TurnCostBadge.tsx` | UPDATE | Subscribe to billed state, render actual-vs-estimated labels, and add one explicit per-turn reconcile control. |
| `dsh-plugin-desktop/src/client/cost-surface.ts` | UPDATE | Create/inject/dispose one shared `BilledCostSource`; add minimal control/status styles. |
| `dsh-plugin-desktop/tests/client-cost-model.spec.ts` | UPDATE | Cover billed formatting, billed zero, retained estimate, and exhaustiveness. |
| `dsh-plugin-desktop/tests/client-turn-cost.spec.ts` | UPDATE | Cover all-billed, mixed, unknown, floor, and initial-estimate folding. |
| `dsh-plugin-desktop/tests/client-cost-parity.spec.ts` | UPDATE | Keep all five statuses and the billed overlay constructor symmetric with offline code. |
| `dsh-plugin-desktop/tests/cost-surface-gating.spec.ts` | UPDATE | Permit only the declared reconcile control while retaining compatibility/additive ownership fences. |
| `dsh-plugin-desktop/tests/profile.spec.ts` | UPDATE | Pin the Host row in default and arbitrary selected Web/Parametria composition. |
| `dsh-plugin-desktop/tests/package.spec.ts` | UPDATE | Pin export, tsdown entry, Cordis row, and packaging/runtime closure. |
| `dsh-plugin-desktop/scripts/verify-loader-boot.mjs` | UPDATE | Exercise plugin registration/teardown with zero outbound requests during the smoke. |
| `dsh-preset-parametria/scripts/session-cost.mjs` | UPDATE | Mirror the fifth status/overlay helper only; keep CLI pricing offline and estimate-only. |
| `dsh-preset-parametria/tests/session-cost.test.mjs` | UPDATE | Cover the mirrored billed state and prove the CLI performs no reconciliation I/O. |

No file under `deepseek-harness/` is in scope.

---

## Tasks

### Task 1: Define and fence the five-state cost seam

- **Files**: client/offline cost models and their model/parity tests.
- **Implement**: split the existing four estimate arms from `CostLine`; add `billed` with a retained
  estimate and a pure `withBilledCost` helper on both sides. Extend exhaustive runtime witnesses.
  Update the parity reachability test to exercise the overlay helper, while preserving all existing
  rate arithmetic vectors through `priceTokens` and `priceStep`.
- **Validate**:
  `corepack yarn workspace dsh-plugin-desktop exec vitest run tests/client-cost-model.spec.ts tests/client-cost-parity.spec.ts ../dsh-preset-parametria/tests/session-cost.test.mjs`

### Task 2: Build the Host reconciler and route

- **Files**: new contract/plugin/Host test plus export, build entry, and desktop patch row.
- **Implement**: inject desktop runtime, Web server, credentials, and session query; read one folded
  surface per request; validate inner replay provenance; resolve the key once; execute the bounded
  fixed-endpoint pass with success-only and in-flight caches; return only per-step results.
- **Mirror**: directory-picker route admission/registration and update-checker transport/body bounds.
- **Validate**:
  `corepack yarn workspace dsh-plugin-desktop exec vitest run tests/openrouter-billing.spec.ts tests/profile.spec.ts tests/package.spec.ts`

### Task 3: Build the explicit-demand browser source

- **Files**: shared contract, new `client/billed-costs.ts`, client tsconfig, and its test.
- **Implement**: relative same-origin POST, strict unknown-response validation, stable snapshots keyed
  by session/turn/step, same-turn in-flight coalescing, success retention, unresolved retry, and
  generation-safe disposal. Construct/subscribe/getSnapshot must be pure with respect to fetch.
- **Mirror**: `client/directory-picker.ts` response validation and `client/cost-rates.ts`
  generation-owned external-store lifecycle.
- **Validate**:
  `corepack yarn workspace dsh-plugin-desktop exec vitest run tests/client-billed-costs.spec.ts`

### Task 4: Integrate billed data without sacrificing immediate estimates

- **Files**: turn fold, badge, surface installer/styles, and client cost tests.
- **Implement**: overlay billed data by `(sessionId, turn, step)`, keep actual and estimated subtotals
  distinct, render truthful all-billed/mixed/unknown headlines and provenance, and add the explicit
  whole-turn reconcile button with loading/retry feedback.
- **Validate**:
  `corepack yarn workspace dsh-plugin-desktop exec vitest run tests/client-turn-cost.spec.ts tests/client-cost-model.spec.ts tests/client-billed-costs.spec.ts`

### Task 5: Strengthen composition, compatibility, and headless fences

- **Files**: gating/profile/package tests and Loader smoke.
- **Implement**: pin the new row to the desktop overlay across selected profiles; update exhaustive
  module/export/build lists; replace the blanket no-handler assertion only with a narrow declaration-
  anchored allowance for the billing button. Retain bans on upstream dispatch, service replacement,
  upstream DOM queries, or eager reconciliation. Ensure Loader boot records no outbound request.
- **Mutation proof**: demonstrate red tests for at least: removed origin guard, removed success cache,
  accidental negative cache, changed fixed endpoint/header, render-side fetch, omitted billed parity
  witness, and moving the row into only the Parametria profile.
- **Validate**:
  `corepack yarn workspace dsh-plugin-desktop exec vitest run tests/cost-surface-gating.spec.ts tests/client-cost-surface-mode.spec.ts tests/profile.spec.ts tests/package.spec.ts`

### Task 6: Complete repository validation and live-compatible observation

- Run build, typecheck, unit suites, Loader/profile smokes, and the complete headless gate.
- Start the GUI only as an explicit manual step with lane-A port `3400+` and isolated persistent
  scratch under `~/.dsh-lane-scratch/issue-30` (never `/tmp`). In compatibility mode, confirm the
  existing upstream action row remains intact, the desktop badge shows an estimate before any click,
  one click makes one loopback pass, and unavailable/pending data leaves the estimate retryable.
- No credential is available to this lane or the RM, so do not claim live billed success. Record the
  pending-live datum in the PR body and leave the issue open. Advanced-mode behavior is covered by
  shared desktop-layer composition tests and the Windows gate; Linux cannot launch advanced mode.

---

## Fence List

### Security and authority

- Loopback host assertion plus exact Origin, method, media type, body-size, and body-shape guards.
- Renderer supplies session/turn only; Host owns generation discovery and fixed upstream URL.
- Credential resolved Host-side once per accepted pass, never cached/serialized/logged.
- No response or log contains Authorization, raw provider data/error, or a generation id.
- Accepted `total_cost` is finite and nonnegative; billed zero is accepted.

### Demand, batching, and lifecycle

- No fetch on module import, source construction, subscribe, snapshot read, badge render, or details
  expansion.
- Exactly one loopback POST per explicit whole-turn reconcile action; duplicate concurrent clicks
  coalesce.
- Surface read once per pass; ids deduplicated; 64-id cap; maximum outbound concurrency four.
- Successful billed values cache per generation id; misses/errors do not cache and retry next pass.
- In-flight ids deduplicate across overlapping passes; teardown aborts and ignores late completion.

### Compatibility and composition

- Existing upstream slot contributor remains registered additively; no slot/service replacement.
- Only the named desktop reconcile control gets an event handler; no upstream dispatch or DOM query.
- Desktop Host row appears after Web in default, Parametria, and arbitrary selected Web profiles.
- Host plugin requires desktop runtime and refuses non-loopback server binding.
- `deepseek-harness/` remains byte-for-byte untouched.

### Truthfulness and parity

- Existing estimate appears immediately and remains nested in every billed line.
- Billed, estimated, and unknown money are not collapsed into an unlabeled total.
- `priced/free/unpriced/untokenized/billed` is exhaustive in browser and offline witnesses.
- Parity exercises all five states; offline CLI stays network-free.
- Not-yet-available billed records remain estimates and are retryable.

### Headless safety

- All OpenRouter calls in tests use an injected fake transport.
- Loader/profile/package/check smokes assert zero outbound billing calls and never open a browser.
- `corepack yarn check` remains fully headless on Linux and Windows.

---

## End-to-End Verification

1. With fake Host dependencies, reconcile a turn containing multiple durable OpenRouter response
   ids and verify one route request returns step-correlated billed and estimated rows while the key
   and ids stay Host-only.
2. Reconcile again and verify successful ids are cache hits while pending ids alone are retried.
3. Exercise missing credential, 404/not-ready, malformed payload, oversized response, timeout, and
   teardown; each leaves estimates visible and retryable.
4. In the client harness, mount multiple badges for one turn. Verify no request until a user click,
   one shared POST on concurrent clicks, and mixed billed/estimated/unknown labels after resolution.
5. Run compatibility/profile fences and Loader boot with a transport that fails the test if invoked.
6. Explicitly launch compatibility mode on port 3400+ with isolated lane scratch and observe that the
   upstream UI is unchanged apart from the additive desktop badge/control. Record pending-live rather
   than inventing a billed result.

## Validation

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

There is no lint script and no separate e2e command in `.engineering/config.yml`; Loader/profile and
release smokes are included in `corepack yarn check`. Capture the final `git rev-parse HEAD` beside
the gate tail as required by the resolver charter.

## Acceptance Criteria

- [ ] A desktop-owned Host plugin reconciles durable OpenRouter `gen-…` ids only on explicit demand.
- [ ] The API key is resolved through `ctx.credentials` and never reaches renderer state or logs.
- [ ] One whole-turn pass is bounded, throttled, deduplicated, success-cached, and retry-safe.
- [ ] The client shows list-rate estimates immediately and truthful billed/estimated mixed state.
- [ ] All five cost states remain exhaustive and client/offline parity is green.
- [ ] Compatibility mode remains an additive slot contribution with no upstream replacement.
- [ ] Every test and smoke is loopback-only/fake-transport and the complete gate is headless.
- [ ] No file under `deepseek-harness/` changes.
- [ ] Manual compatibility observation is recorded without claiming an unavailable live billed datum.
- [ ] PR body uses `Refs #30`, states pending-live timing/credential evidence, and leaves #30 open.
- [ ] `corepack yarn check` passes at the pushed implementation head.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Browser projection has no replay state | Renderer sends only session/turn; Host reads the durable folded surface. |
| OpenRouter record is not available immediately after stream | Cache successes only; retain estimate and retry misses next explicit pass. |
| Many-step Parametria turns burst the provider API | Whole-turn action, dedupe, 64-id cap, four-request concurrency ceiling, per-call timeout. |
| Actual and list-rate values are accidentally summed as one fact | Preserve the estimate inside `billed`; maintain separate billed/estimated aggregates and labels. |
| Secret or generation id leaks across the loopback boundary | Fixed request contract, Host-owned discovery, step-only response, sanitized logging tests. |
| Capability accidentally becomes Parametria-profile-only | Mount in desktop overlay and pin default/arbitrary/Parametria profile composition. |
| Compatibility interaction fence becomes too broad | Allow one declaration-anchored desktop control while retaining all upstream ownership bans. |
| New Cordis entry is omitted from packaging | Exhaustive package/tsdown/export/runtime-closure tests plus Loader boot. |

## Architectural Decisions Surfaced

No new ADR is proposed at plan freeze. The landing decision is an application of accepted H-0001:
desktop-owned reconciliation stays in the overlay and the pinned upstream remains unmodified. During
implementation, reassess the repository's ADR gate; if an unforeseen hard-to-reverse or surprising
trade-off appears, record it before declaring the run complete.
