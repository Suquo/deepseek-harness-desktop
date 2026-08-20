# Agent Roadblock Relief Plan — harness adjustments grounded in session-run evidence

**Date:** 2026-08-20 (evening)
**Inputs:** `parametria-definitions/LEARNINGS.md` + `LOGS.md` + `AGENTS.md`; **42 decompressed session runs**
from `~/.dsh/sessions/` (both workspaces, including 23 subagent runs); the operator's export at
`Downloads/121` (= session-94f632ea, wall cabinet); live config state (`~/.dsh/settings.yaml`,
`~/.dsh/profiles/*/cordis.patch.yml`, `%APPDATA%\DSH Desktop\profile-selection\state.json`);
`.engineering/handoffs/BOARD.md` + open issue queue.
**Method for reading runs:** see Appendix A (the session store is directly readable; no export needed).

---

## 0. Quantified failure census (all 42 sessions, pattern counts × sessions affected)

| # | Failure class | Hits | Sessions | Status tonight |
|---|---------------|-----:|---------:|----------------|
| 1 | `NO_ADAPTER` — validator spawns with provider `parametria-vision`, no adapter registered | 36 | 18 | **Fix merged (PR #50) but NOT INSTALLED — still failing at 22:27 tonight** |
| 2 | Opaque `Error: subagent run failed` (parent-side laundering of child errors) | 44 | 8 | #40 open, claimable |
| 3 | Text-only model image refusal (`deepseek-v4-flash does not declare image input`) | 65 | 13 | Partially mitigated by modlens — which itself flaps |
| 4 | modlens vision-provider failures (agy unauth / codex spawn EINVAL / claude-cli exit 1) | 28 | 6 | Operator-side items on board |
| 5 | OpenRouter 400 `Reasoning is mandatory ... cannot be disabled` — killed 2 validator children | 26 | 5 | **Not yet an issue — new finding** |
| 6 | Playwright confined-spawn `PermissionError` → per-capture danger-full-access escalation | 28 | 28 | #24 open (command-level policy) |
| 7 | Sandbox `EPERM` on `C:\tmp` / `%TEMP%` writes (skill example paths) | 6 | 5 | Mitigated by `.parametria-evidence/` (PR #25) + SK-4 pending |
| 8 | Convex `name-conflict` on rebuild loops | 44 | 5 | Skill-workflow item (SK batch) |
| 9 | `fitToViewport returned false` (empty scene — preview-flag bug) | 38 | 6 | Skill/generator item (LEARNINGS 2026-08-20) |
| 10 | pnpm devEngines mismatch (shim 11.7.0 vs repo pin 11.17.0; `clear-env.mjs` wipes bypass) | — | 3 | **No issue filed — new candidate** |
| 11 | `subagent depth 1 exceeds maxDepth 0` | 3 | 3 | FIXED (PR #19) — appears only in pre-fix sessions |
| 12 | Screenshot script UI drift ("search box not found" fallback) | 10 | 2 | Skill script item |

Roadblock #1 + #2 together are the defining failure of the last four runs: **16 of 23 subagent
spawns died instantly at `NO_ADAPTER`**, the parent saw only "subagent run failed", and the agent
then spent large fractions of each run inventing fallback validation (console dumps, `read_image`
retry chains, arithmetic-only verdicts) — exactly the workarounds LEARNINGS.md now documents as
standard practice. The relief plan's goal is to make those workarounds unnecessary.

---

## Phase 0 — Deploy what is already merged (operator, ~5 minutes, tonight)

Nothing in this phase needs code. The single biggest roadblock is **already fixed on master and
not deployed**:

- `~/.dsh/cordis.patch.yml` **does not exist** on this machine (verified tonight). PR #50's
  machine-wide `parametria-vision` route therefore never mounts, and profile selection is still
  `desktop` (`state.json`), so the profile-local copy of the route never mounts either.
- Consequence, verified in the freshest evidence available: the operator's own export
  (`Downloads/121`), subagent `f1101e38` spawned at **22:27 tonight**, still died
  `no adapter registered for provider "parametria-vision"`.

**Actions (in order):**
1. `corepack yarn install:profile` from the repo root (PR #50's ownership-guarded installer writes
   the managed block into `$DSH_HOME/cordis.patch.yml`). No profile switch needed — that is the
   whole point of the machine-wide route.
2. Restart DSH Desktop (patch layers load at boot; `watchUserPatches` may hot-load, but a restart
   removes doubt).
3. Re-auth the modlens providers that flap: `agy` sign-in (status ERROR persists — re-verify with
   `npx @liustack/modlens doctor`), and note claude-cli's vision calls die under a SessionEnd hook
   cancellation (operator's Claude plugin config).
4. Run one Parametria build that invokes `subagent_validator`. Success criterion: a validator child
   session under `~/.dsh/sessions/` whose `request/context` reads `parametria-vision` /
   `google/gemini-3.6-flash` **and** whose `turn/end` has no error. That closes **#1**.

**Harness follow-up (small, new issue candidate):** the gap between "merged" and "installed" was
invisible for a full day of runs. Add a boot-time preflight to the desktop plugin: for every
`dsh-tool-subagent` row whose `agentOptions` pins a provider, resolve the provider against the live
`llm` registry at session start; if unresolved, emit a loud session banner ("validator route
`parametria-vision` is not registered — validators WILL fail; run install:profile") instead of
letting every spawn fail at depth. Fail-loud-at-boot beats fail-opaque-at-use.

## Phase 1 — Kill the error laundering (#40) — highest-leverage code change

**Evidence:** 44 occurrences of the literal string `Error: subagent run failed` returned to
agents; the child sessions' `turn/end` records carried the real cause every time
(`NO_ADAPTER`, or the OpenRouter 400 below). Agents cannot adapt to what they cannot see: in
session-9f919afe the agent retried the validator 3× verbatim (same result), then built a
five-step fallback chain. LEARNINGS.md's two longest entries (2026-08-20 "Validator + modlens can
both be down" and "read_image fallback") exist **only because the error was opaque**.

**Change:** in the subagent tool's parent-side result path, when the child run terminates with a
turn-level error, return the child's `{code, message}` (e.g.
`subagent run failed: NO_ADAPTER — no adapter registered for provider "parametria-vision"`), plus
the child session id so a harvest can find it. Same for the background path (#40 already records a
background-path variant: a spawn that "settles as failed with no output").

**Landing surface:** post-rc.8 patch surface (BOARD notes reportDelivery was reshaped by the pin
bump — re-ground before patching). Prefer an upstream-shaped patch + report to anywhere-labs
(owner ruling batched on the board).

**Acceptance:** a deliberately mis-routed validator spawn returns the provider name and error code
in the parent's tool result; the existing fences still pass.

## Phase 2 — Retire the escalation treadmill (#24 + evidence surface #23)

**Evidence:** 11 `approval/asked` events, 8 of them "escalate sandbox to danger-full-access:
Playwright must spawn a browser driver with piped stdio". 28 sessions contain the Playwright
confined-spawn `PermissionError`. Worse: in delegated sessions approvals are **auto-rejected**
("Approval prompts are disabled in this session"), so any validator child that needs a capture is
structurally unable to get one — the per-capture-escalation persona rule (PR #21) only works for
the top-level agent with a human present.

**Changes, in order of preference:**
1. **#24 as designed** — `tools/pre-execute` interception granting a narrow command-level policy:
   `uv run` with workspace-local `UV_CACHE_DIR`, the skill's `screenshot-definition.py`
   invocation shape, and node/pnpm inside the workspace. Grants keyed on command shape + cwd,
   not on blanket sandbox mode. This removes the #1 source of approval interrupts AND makes
   validator-side capture possible in approval-less child sessions.
2. **#23** — move evidence-path governance (`.parametria-evidence/<run-id>/`) from persona
   convention into a structural surface (desktop plugin), so path discipline stops consuming
   agent attention and the `C:\tmp` EPERM class (row 7) can't recur even when a skill example
   suggests it.

**Acceptance:** a full build-validate run in `workspace-write` mode completes with **zero**
`approval/asked` events and zero sandbox escalations; a validator child can produce a capture.

## Phase 3 — Make vision resilient instead of lucky

Three related adjustments, all new issue candidates:

**3a. Reasoning-mandatory 400 hardening.** 2 validator children died with OpenRouter 400
`"Reasoning is mandatory for this endpoint and cannot be disabled"` (gemini-3.6-flash and
grok-4.5, both via the operator's bare `openrouter` route from `settings.yaml`, which declares no
`models[]`/`reasoningEfforts`). The pi-ai adapter evidently sent an explicit reasoning-off for a
model that mandates reasoning. The machine-wide `parametria-vision` route already dodges this by
design (`off:` valueless = send nothing) — but any validator or subagent routed through a bare
route re-hits it. Fix in the route layer: **never send an explicit reasoning-disable unless the
model entry declares an `off` wire spelling**; absent `reasoningEfforts`, omit the field. Ground
against pi-ai's dialect guessing first (`compat.thinkingFormat`).

**3b. Orchestrator-blindness fallback.** 65 `read_image` refusals across 13 sessions happen when
the *session* model is text-only (deepseek-v4-flash). Today the only relief is modlens, which
failed 28 times across 6 sessions (three independent provider bugs, all operator-side). Once the
machine-wide vision route exists (Phase 0), `read_image` on a text-only session model could
fall back to a registered image-capable route (the `assertImageCapableRoute` gate already knows
route modalities) instead of hard-refusing. One route lookup replaces a three-provider external
CLI chain. Keep modlens as the description-style alternative; stop depending on it.

**3c. modlens into the parametria profile** (existing owner item): if 3b is rejected, at minimum
ship modlens in the parametria profile manifest so the fallback exists under every profile, and
report the codex `spawn EINVAL` Windows bug to @liustack.

**Acceptance:** with the session model set text-only, a build-validate run produces at least one
successful decisive image read without any modlens provider being healthy.

## Phase 4 — Runtime-commands pnpm shim (new issue candidate)

**Evidence:** LEARNINGS 2026-08-20 (pnpm devEngines gate) — 4 failed dev-server boots in
session-962102bc before the corepack workaround; the DSH-provided shim
(`%APPDATA%\DSH Desktop\runtime-commands\bin\pnpm.cmd`) is pinned at 11.7.0 while target repos pin
newer; the shim's `clear-env.mjs` deliberately wipes `npm_config_*`, which also kills the
documented bypass. Every agent that touches suquo-systems-rust re-pays this cost until it finds
the LEARNINGS entry.

**Change:** make the shim corepack-transparent — either delegate to
`corepack pnpm` (respecting the target repo's `packageManager` pin) or bump the shipped pnpm and
add a fence that compares the shim version against known workspace pins. Keep `clear-env.mjs`
behavior for env hygiene but exempt `COREPACK_*`.

**Acceptance:** `pnpm run dev:web` in suquo-systems-rust boots clean from a fresh DSH session with
no PATH surgery and no corepack incantation in the agent transcript.

## Phase 5 — Skill-side batch (outside this repo; needs the owner's landing-surface ruling)

Not harness code, but the census says these burn real turns; the SK batch (SK-1..SK-4, plus below)
should land wherever the owner rules skills live (#7):

- **name-conflict loop (44 hits):** document delete-then-rebuild as the rebuild primitive; better,
  have the CLI accept `--replace` so a rebuild is one call.
- **preview-flag empty scene (38 hits):** generator helpers must force `preview: true` on
  `display.preview` nodes + sliders; fix the misleading skill sentence (LEARNINGS marks the
  contradiction).
- **screenshot script drift (10 hits):** the definitions-panel search box selector went stale; also
  decouple capture from "definition must be uncategorized to be searchable".
- **paths:** finish SK-4 (workspace-relative spec paths + spec freshness check — the stale-spec
  phantom-definition incident).

## Sequencing and ownership

| Order | Item | Owner / lane | Blocked by |
|-------|------|--------------|-----------|
| 0 | `install:profile` + restart + agy re-auth + one live run (closes #1) | **Operator** | nothing |
| 0b | Route-preflight loud banner (new issue) | Lane B | none (parallel) |
| 1 | #40 error surfacing | Lane B (post-rc.8 re-ground) | Phase 0 helps verify |
| 2 | #24 command-level policy; then #23 evidence surface | Lane B/A | #40 not required |
| 3a | Reasoning-400 hardening (new issue) | Lane B | grounding vs pi-ai dialect code |
| 3b | read_image vision-route fallback (new issue) | Lane B | Phase 0 (route must exist) |
| 3c | modlens in parametria profile | Owner ruling | — |
| 4 | pnpm shim corepack-transparency (new issue) | Lane A | none |
| 5 | SK batch | Owner ruling (#7 landing surface) | — |

New issues to file: route-preflight banner (0b), reasoning-mandatory hardening (3a), read_image
route fallback (3b), pnpm shim (4). Everything else maps to an already-open issue (#40, #24,
#23, #30 untouched, #6 gains the census as more datum).

**The single measure of success:** a Parametria run on a text-only session model, in
`workspace-write`, with zero approval interrupts, where every validator child answers through a
registered vision route and any failure that does occur names its cause in the parent's tool
result. Every phase above removes one documented way that run fails today.

---

## Appendix A — How to read session runs directly (no export needed)

- Store: `~/.dsh/sessions/<workspace-slug>/<session-id>/session.jsonl.zstd`. Top-level agent
  sessions are `session-<uuid>`; bare-`<uuid>` directories are **subagent** runs (parent id is in
  the first record's `parentSession`).
- The files are **concatenated zstd frames** (one frame per append). Node's
  `zlib.zstdDecompressSync` and single-shot stream decode stop after the first frame (~216 bytes).
  Use Python `zstandard` with `stream_reader(..., read_across_frames=True)` — recipe kept at
  `scratchpad decomp.py` pattern; ~`uv run --with zstandard`.
- High-value record types for harvesting: `tool/call`+`tool/result` (join on
  `data.message.source.callId`), `turn/end` (`reason.error` carries the real child failure),
  `request/context` (provider/model actually used — the ground truth that refuted the run-4
  harvest), `approval/asked`, `sandbox/mode`, `agent/inbox/spliced` (delegate prompts),
  `assistant/message.usage` (tokens for #6/#30).
- The operator's `Downloads/121`-style exports are the same `session.jsonl` plus `media/` and
  `subagents/` — useful for sharing, but the store above is already complete and current.
