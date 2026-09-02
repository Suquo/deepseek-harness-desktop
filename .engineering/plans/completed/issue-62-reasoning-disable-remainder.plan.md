# Plan: Fence undeclared reasoning disables in remaining pi-ai dialects

## Summary

Extend the pinned `@earendil-works/pi-ai@0.82.1` Yarn patch so DeepSeek-format requests obey explicit declaration → documented allowlist → omit precedence, while Azure OpenAI Responses sends an Off value only when the model declares a string spelling. Preserve the real loopback seam established by PR #61, add a catalog census that makes future pin drift loud, and add the allowlist to Lane C's revalidation surface.

## User Story

As a bare pi-ai route operator
I want unsupported reasoning-disable fields omitted while supported DeepSeek toggles keep working
So that provider requests do not fail with avoidable 400 responses.

## Metadata

| Field | Value |
|---|---|
| Type | BUG_FIX |
| Complexity | MEDIUM |
| Source | inline-capture |
| Systems Affected | pi-ai Yarn patch, desktop wire integration fence, upstream pin-bump protocol |
| Tracker | github |
| Issue | #62 |
| Source PRD | N/A |

---

## Constraints

- ADR H-0001: keep `deepseek-harness/` unmodified; express the fix as a minimal Yarn patch over the pinned package.
- ADR H-0005: exercise the real mounted provider route through the machine-wide llm service seam rather than a private implementation helper.
- RM ruling: the allowlist is a named exported data table with per-entry source citations; DeepSeek precedence is explicit declaration (`null` omit, string verbatim) → allowlist fixed `disabled` → omit; Azure is string-only; add red/green pairs and an exhaustive census; record Lane C revalidation; PR says `Refs #62`.
- Provider-wire changes remain unresolved by static tests alone, so issue #62 stays open pending a live provider datum.

## Patterns to Follow

### Patch structure

```diff
// SOURCE: patches/pi-ai@0.82.1.patch:1-42
+const offValue = model.thinkingLevelMap?.off;
+if (typeof offValue === "string") {
+    ...
+}
```

### Tests

```ts
// SOURCE: dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts:151-258
// Mount the real llm runtime and pi-ai adapter against a bound loopback server,
// capture exactly one request body, and assert only observable wire behavior.
```

### Pin-bump revalidation

```md
<!-- SOURCE: .engineering/upstream-watch.md:270-283 -->
| Patch | Target | Behavior to re-test | Hazard |
```

---

## Files to Change

| File | Action | Purpose |
|---|---|---|
| `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts` | UPDATE | Add per-dialect loopback red/green controls and exhaustive catalog census. |
| `patches/pi-ai@0.82.1.patch` | UPDATE | Export the cited DeepSeek allowlist and fence DeepSeek/Azure disable emission. |
| `.engineering/upstream-watch.md` | UPDATE | Make the allowlist/census a required pi-ai pin-bump revalidation item. |
| `yarn.lock` | UPDATE | Refresh the Yarn patch locator hash after patch contents change. |

---

## Tasks

### Task 1: Add failing behavior and census fences

- **File**: `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts`
- **Action**: UPDATE
- **Implement**: Generalize the existing loopback driver across provider/model/API seams; add DeepSeek thinking-only omission plus allowlisted preservation, Azure absent omission plus declared-string preservation, and an exhaustive catalog census against the exported allowlist and documented deny set.
- **Mirror**: `dsh-plugin-desktop/tests/pi-ai-bare-route-reasoning.spec.ts:151-440`.
- **Validate**: `corepack yarn workspace dsh-plugin-desktop vitest run tests/pi-ai-bare-route-reasoning.spec.ts` must fail for the two current inventions before the patch is extended.

### Task 2: Implement the RM-ruled wire precedence

- **File**: `patches/pi-ai@0.82.1.patch`
- **Action**: UPDATE
- **Implement**: Add an exported model-ID/source data table; DeepSeek uses explicit string, explicit null omission, allowlisted fixed list fixed literal, otherwise omission; Azure uses declared strings only.
- **Mirror**: Existing declaration guards in `patches/pi-ai@0.82.1.patch:1-42`.
- **Validate**: Reinstall the patch to refresh `node_modules`/`yarn.lock`, then rerun the focused spec to green.

### Task 3: Record the Lane C revalidation obligation

- **File**: `.engineering/upstream-watch.md`
- **Action**: UPDATE
- **Implement**: Expand the pi-ai row to require re-grounding every cited allowlist and deny entry plus rerunning the census/wire pairs at each pin bump.
- **Mirror**: `.engineering/upstream-watch.md:270-283`.
- **Validate**: focused spec and `corepack yarn check`.

## End-to-End Verification

1. Run the focused Vitest file, which binds only `127.0.0.1`, mounts the real llm runtime and pi-ai adapter, and captures the outgoing request bodies.
2. Verify the unsupported Kimi thinking route carries no `thinking`, while a documented toggle-capable DeepSeek route carries the fixed disable.
3. Verify an undeclared Azure o-series route carries no `reasoning`, while a synthetic declared string is transmitted verbatim.
4. Verify the catalog census exactly covers every absent-Off DeepSeek route with either the exported allowlist or the documented deny set.
5. Run the complete headless gate with the tested commit SHA printed beside its tail.

## Validation

```bash
corepack yarn workspace dsh-plugin-desktop vitest run tests/pi-ai-bare-route-reasoning.spec.ts
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

## Acceptance Criteria

- [ ] All tasks completed
- [ ] Focused red was observed before production patch changes
- [ ] Full validation and headless gate pass
- [ ] No file under `deepseek-harness/` or `.agents/` changes
- [ ] Issue receives implementation evidence and stays open
- [ ] PR uses `Refs #62`

