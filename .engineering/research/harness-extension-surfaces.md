# Appendix — DSH Harness extension-surface map (upstream 0.1.0-rc.7, desktop-fork consumption)

> Research agent report, 2026-08-19 (read-only sweep of `deepseek-harness/docs`, `packages/*`, and desktop docs). Line refs are into the pinned upstream checkout. Verbatim findings; synthesis lives in [parametria-harness-customization.md](parametria-harness-customization.md).

## 0. Composition model

| Layer | What it is | File / doc |
|---|---|---|
| **Bundle** | npm pkg with `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Patch = top-level YAML array of `PatchOptions` (id-targeted config replace, `insert` lists, `!!js` allowed). | `packages/bundle/README.md`; `packages/boot/app-boot/README.md:16,38` |
| **Profile** | `$DSH_HOME/profiles/<name>/` holding `package.json` (out-of-tree plugin `dependencies` + `dsh.profile.bundles` ordered layer list) + user `cordis.patch.yml`. Layer order: each bundle patch in `dsh.profile.bundles` order → `profiles/<name>/cordis.patch.yml` → home-level `cordis.patch.yml` (outranks per-profile). | `packages/boot/app-boot/README.md:38,43`; `apps/cli/README.md:35-39`; `docs/user/develop/basic/publish.md:83-116` |
| **Host plane vs Agent plane** | Host composition = process singletons (registries, sandbox, approval, persistence, model route, subagent provider registry). Agent plane = agent preset `agent.cordis.yml`, mounted per-agent scope. | `packages/preset/README.md`; `apps/cli/config/agent-presets/standard/agent.cordis.yml:1-20,159-170` |
| **Desktop fork's own layer** | `dsh-plugin-desktop/cordis.patch.yml` (27 lines) — inserts desktop plugins then id-patches `web-runtime` config. Pure patch layer; no upstream source edits. | `dsh-plugin-desktop/cordis.patch.yml` |
| **Patch semantics gotcha** | An id-targeted patch **replaces the whole `config`** — no deep merge. Restate every field you keep. A patch naming a missing id = stderr warning only. Empty/comment-only patch file throws; use `[]` to disable. | `packages/boot/app-boot/README.md:43,60` |
| **Live reload** | `watchUserPatches` keeps `cordis.patch.yml` hot; failed recompose keeps last good tree + `hmr/config-update-failed`. | `packages/boot/app-boot/README.md:19,45` |

**Reachability verdict:** everything marked ✅ below is reachable by (a) a bundle/patch row, (b) an agent preset directory, or (c) a desktop-side plugin — no upstream fork. Yarn patches only needed for the 5 already-patched packages (`package.json` `resolutions`).

## 1. Skills — `packages/skill/*` ✅

- Owner: `dsh-skill` (registry, `ctx.skills`), `dsh-skill-filesystem` (local provider), `dsh-skill-badge` (ships disabled), `dsh-tool-skill` (model-facing tool + catalog injection).
- Registry is host + per-scope layered; a plugin mounted by an **agent preset's composition registers into that preset's layer**. Nearest layer wins duplicates outright; rank breaks ties within one layer. `docs/subsystems/skills.md:13,249`
- Discovery rank (local provider): 100 `<root>/.dsh/skills` · 200 `<root>/.agents/skills` · 300 `Config.customSkillDirs` · 400 `<dshHome>/skills` · 500 user-agents · 600 bundled. Project root = nearest `.git` ancestor. `skills.md:64-81`
- Identity: kebab-case; `<name>/SKILL.md` or flat `<name>.md`. **No nested recursive discovery.** `skills.md:85`
- Frontmatter: `disable-model-invocation`, `user-invocable` (default true). `skills.md:126`
- Runtime injection: `ctx.skills.register()` / `registerProvider()` — sync during `apply()`, effect-disposed. `skills.md:263-274`
- Catalog delivery: durable user-role system-reminder at first `agent/pre-step`; digest-compared; name+description only. `skills.md:231-235`
- **(a) Per-profile skill injection: YES** — (1) preset-scoped skill root: `apps/cli/config/agent-presets/cordis/agent.cordis.yml:255-262` mounts `dsh-skill-filesystem` inside the preset with `customSkillDirs: !!js fileURLToPath(new URL('skills/', baseUrl))` — skills travel with the preset, land in the preset's layer only; (2) runtime provider/registration from any plugin.

## 2. Agent presets — `packages/preset/agent-presets` (`ctx.agentPresets`) ✅

- **(c)** A preset = a directory with one `agent.cordis.yml` (YAML list of plugin rows: `id`, `name`, `config`, `disabled`, `group: true` + `isolate:`) + optional `preset.yml` (display text ONLY: name/description).
- Mounted once per process under a standing scope; sessions parent their agent scope to it. Views resolve `agent → preset → global`.
- **Hard rule:** a service row in a preset MUST sit inside a group with an `isolate` realm; otherwise rejected at mount (`code/agent.cordis.yml` header).
- Service API: `defaultId`, `list()`, `resolve()`, `mount()`, `composeFrom()`, `composedPreset()`, `recompose()`, `standingKeyFor()`, `roots`, `authorable`, `read()`, `copy()`, `remove()`. Authoring is **copy-only**.
- Name resolution inside a preset: bare `@deepseek-ai/dsh-*` from host composition; **relative paths from the preset dir** (lets `skills/` travel); absolute → `file:` URLs.
- Switching: `recompose()` only while the agent produced nothing (ApiProxy `agent-preset-locked`); switch appends `agent-preset/selected` session event + cordis event (`packages/preset/agent-presets/src/types.ts:13`).
- **Subagent children join via `composeFrom()`, never `mount()`** — a child that joins nothing reaches the model with **no tools at all**.
- Shipped roster: `code`, `cordis`, `minimal`, `standard`. Sibling: `dsh-persona` (`config.text`, `{{model}}`/`{{cwd}}`).

## 3. Subagents — `packages/subagent/*` ✅

- Registry `ctx.subagents` is host-plane. Providers: `spawn`, `fork`, `acp`, `codex`, `claude-code`, `dsh-sdk`. `docs/subsystems/subagent.md:5-7`
- Agent-plane tools: `dsh-tool-subagent` (one instance = one provider + one toolName), `dsh-tool-subagent-control` (`send_message`, `interrupt_agent`, `/list-agents`), `dsh-tool-subagent-report` (**host-plane** — one copy; second mounted preset throws).
- **`dsh-tool-subagent` config** (`packages/subagent/tool-subagent/README.md`; `src/index.ts:28-98`): `provider` (required) · `toolName` (default `subagent`) · `enableRunInBackground` (default true) · `backgroundMode` (`one-shot`|`continuable`) · **`agentOptions: { provider, model, maxTokens }`** (explicit values override inherited parent options) · `persona` · `toolFilter` · `maxDepth` (default 3; capability-gated).
- Capability gating is fail-loud (`SubagentError('UNSUPPORTED_CAPABILITY')`). Continuable descriptors snapshot resolved child provider/model for cold resume (`subagent.md:283`). Events: `subagent/start|end`, provider add/remove; reads: `listChildren`, `listDescendants`.
- **(b) Subagent model selection: per-INSTANCE yes, per-call NO.** Pin lives in the preset row's `agentOptions`; *"Child policy is fixed per instance — another model, persona, tool filter, or depth cap requires another distinctly named tool"* (Known Limitations). `dsh-agent-default-model` is NOT involved for children.
- **Vision-validator pattern:** second `dsh-tool-subagent` row (`toolName: subagent_validator`, `agentOptions: {provider: <vision route>, model: <vision model>}`) — mirrors `standard/agent.cordis.yml:186-219`.
- **Silent image failure root cause addressed only in `dsh-llm-pi-ai`:** per-model `input` modalities (default `[text]`); under-claiming = loud pre-attach refusal naming the model; over-claiming = provider rejects mid-turn after the message is durable. `packages/llm/llm-pi-ai/README.md:94-96,199`. **`dsh-llm-deepseek` exposes no modality config.**

## 4. Tools / hooks / permissions ✅

Typed interception waterfalls (`packages/hooks/README.md`; `docs/cookbook/extension-cookbook.md:95-129`): `ctx.tools.register()` · scoped `ctx.tools.restrict()` · listeners on `agent/session-start`, `agent/pre-step`, `agent/request`, `tools/pre-execute` (return `ask` → `ctx.approval`), `tools/execute` (dispatch wrap: deadline/retry/metrics), `tools/post-execute`, `tools/result`, `agent/turn-stopping` · `ToolExecution.concludeTurn()` · `ctx.systemPrompt.section()` · sandbox via `ctx.sandbox`/`dsh-bash-sandbox` · external bridges `dsh-hooks-claude-code`/`-codex` · MCP via `dsh-mcp-client` (config: transport stdio|streamable-http, serverName, command/args/env/cwd or url/headers, toolCallTimeoutMs 60000, failOnStartupError false, reconnect; tools appear as `mcp__<server>__<raw>`; HMR hot-swaps).

## 5. Settings, workspace, extensions, host, client

- **Settings**: `dsh-settings` + `dsh-settings-file` — namespace registration, layered resolution, hot commits; LLM adapters self-register namespaces (`llm-deepseek`, `llm-pi-ai` at `providers.<provider>`).
- **Workspace**: `dsh-workspace` (`ctx.workspaceRegistry`).
- **Dynamic extensions**: `dsh-cordis-host-runner` etc. — model-authored versioned packages, approval-gated (`docs/subsystems/extensions.md`).
- **Host**: `apiproxy` (enforces `agent-preset-locked`; owns `/export` ZIP), `webserver`, `frontend-static`, `plugin-inventory`, directory pickers.
- **Client UI slots**: ~30 `packages/client/ui-*` incl. `ui-agent-preset`, `ui-model-selection`, `ui-skill`, `ui-subagent`, `ui-slots`. Renderer talks Host over loopback only.

## 6. LLM provider layer

- `ctx.llm` seam; adapters register named routes; request selects `GenerateOptions.provider` + `.model`. Duplicate route → `LlmError('DUPLICATE_ADAPTER')`.
- **`dsh-llm-deepseek`**: one route `deepseek-official`. Config: `apiKeyEnv` (via `ctx.credentials`), `baseURL`, `thinking`, `reasoningEffort` (`off|low|high|max`, default high), `maxTokens` (256000), `streamIdleTimeoutMs`, `retryPolicy`, `defaultContextWindow` (1000000), `models[]` (advisory; unlisted ids pass through). **No modality/vision field.** Live `llm-deepseek` settings namespace.
- **`dsh-llm-pi-ai`**: dict of provider profiles keyed by route — **the real multi-model surface**. Per route: `apiKeyEnv`, `baseURL`, `api`, `displayName`, `reasoning`, `retryPolicy`, `streamIdleTimeoutMs`, `defaultContextWindow` (262144), `defaultMaxTokens` (32768), **`defaultInput` modalities (default [text])**, `models[]` (id/name/contextWindow/maxTokens/reasoningEfforts/compat/`input`), `modelOverrides.<id>`, `compat`. Can mount dormant and gain routes from settings.
- **`dsh-llm-retry`**: provider-scoped, listens `agent/request-error`, durable-step boundaries.
- **(f) Per-role model config: NO role concept.** Selection is per-Agent (`AgentOptions`), per-step via `agent/request` waterfall (returns `LlmCallConfig`, `docs/subsystems/core.md:909`), per-subagent-tool-instance via `agentOptions`. `dsh-agent-default-model` = one process-wide default `{provider, model}`; per-session selection is the entry point's job (`packages/core/agent-default-model/README.md:5-25`).

## 7. Telemetry, usage, cost, timing

| Package | ctx key | Config | Reachable |
|---|---|---|---|
| `dsh-token-meter` | `ctx.tokenMeter` + 3 projection units | **none — any key rejected** | ✅ host row |
| `dsh-session-stats` | `sessionStats` projection unit | none | ✅ — **currently mounted only in web-app bundle** |
| `dsh-session-telemetry` | `sessionTelemetry` + `sessionTelemetry/record` waterfall | capture `live`\|`on-demand` | ✅ |
| `dsh-session-telemetry-otel` | deployment entry | `mode FULL|FEEDBACK_ONLY|DISABLED` (default DISABLED), `exporter{url,headers}` OTLP/HTTP, `processor{}` | ✅ |
| `dsh-session-query` (+`-sqlite`, tool, log-export) | `ctx.sessionQuery` | `readWindowMax` 50, `persistedInspectConcurrency` 4 | ✅ |

- **(g) Per-step usage/model/latency: YES, in the durable session log.** Tokens: `assistant/message.usage` (`TokenUsage {inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?}`; disjoint buckets; reasoning inside output — never add twice) (`docs/subsystems/session.md:61-64`; `llm-streaming.md:267-287`). Model/provider: stored with assembled assistant content (`llm-streaming.md:291`); `request/header` (EpochHeader) + `request/context` appended **only when provider/model/capacity changes** (`session.md:154-180`). Latency: derived by `sessionStats` fold — `llmMs`, `ttftMs`/`ttftSteps`, `decodeMs`/`decodeTokens`, `toolMs` (by callId), `steps`/`turns` (`packages/session/session-stats/README.md`). Persistence: session log (jsonl/sqlite) via `ctx.sessionQuery` (listEvents, readSurface, filterEvents, traceSession, FTS).
- **(h) Subscribe/export: YES, four routes.** (1) Projection units: `tokenUsage` (last-sample-replacing per (turn,step) — retries not double-counted), `contextPressure`, `contextBreakdown`, `sessionStats` — snapshot, change feed, history tail, `session/projection` push frames, session list rows. (2) Live bus: `session/event`, `subagent/start|end`. (3) `SessionTelemetrySink` (`emit/flush?/shutdown`) + `sessionTelemetry/record` redact waterfall (ships zero rules). (4) `ctx.tokenMeter.measure()` / `estimateMessage()`. Desktop report plugin feasible: host-side reads sessionQuery+projections, renders via web routes/slots (renderer cannot read Host services; no IPC bridge). Export precedent: `/export` ZIP via ApiProxy `GET /api/session.export`.
- **(i) Cost accounting: NO — raw tokens only.** Zero monetary hits repo-wide; pi-ai catalog pricing has *"no harness consumer"*; token-meter occupancy is *"not a billing record"*. **Price table is ours to build** — all four disjoint buckets recorded.
- **(j) Mid-session model switching: YES with provenance.** `session.selectModel` RPC (`/model` command; `packages/client/ui-model-selection/README.md`) — snapshots at next prompt-assembly boundary; durable when `request/header` consumes it. Per-step override: `agent/request` waterfall. Model id recorded per message + `request/context` on change. **A/B caveats:** route switches can invalidate provider-side cache (compare uncached input + output, not billed totals); occupancy pairs fresh capacity with previous route's sample until next usage report — call `measure()` at your own boundary.

## 8. Desktop-side surfaces

Public contracts (exactly two): `ctx.desktopProfiles` (`current {name,dir}` immutable per generation; `list()`; `select()` = restart) and `ctx.desktopPnpm` (`run()` low-level; **`runPlugin()` = packaged `dsh plugin --profile <active>`**, the only path preserving profile init + `dsh.profile.bundles` reconciliation; one op per generation; consumer owns deadlines). Cross-environment pattern: `ctx.get('desktopProfiles')` then `ctx.inject(['desktopPnpm'], …)`; ordinary-DSH path stays authoritative (`docs/plugin-development.en.md:56-78`; `plugin-services.md:62-124`).

## 9. Explicitly NOT supported

Nested `**/SKILL.md` discovery · per-call subagent model selection · preset.yml writing id/trust · preset authoring by text (copy-only) · `recompose()` on non-blank agent · un-isolated service rows in presets · second agent-plane `tool-subagent-report` · deep-merging profile patches · `desktopRuntime`/bootstrap/Electron internals as contracts · renderer reading Host services (no preload/IPC bridge) · `dsh-community-fabric` (RFC draft) · monetary cost accounting · pi-ai per-model pricing/modality consumers beyond documented · `reasoningEffort` in agent-default-model plugin config · per-session default model in agent-default-model · durable telemetry outbox (best-effort only) · built-in telemetry redaction (none — records leave as captured incl. credentials) · token-meter config (any key rejected) · `sessionStats` outside web-app bundle (fall back = window-scoped counting) · draft-phase/addressed-subagent model selection · `/export <path>` (browser download only).

## 10. Direct hits for the Parametria profile

| Requirement | Surface | Where |
|---|---|---|
| Large SKILL.md per profile | Preset-local `skills/` + preset-scoped `dsh-skill-filesystem` | `cordis/agent.cordis.yml:255-262` |
| Vision validator subagents | Extra `dsh-tool-subagent` row, distinct toolName, `agentOptions{provider,model}` | `tool-subagent/README.md`; `standard/agent.cordis.yml:186-219` |
| Loud image refusal | pi-ai `input` modalities | `llm-pi-ai/README.md:94-96` |
| Playwright/Convex CLI | `dsh-tool-bash` + sandbox; deny at `tools/pre-execute` | `extension-cookbook.md:117-118` |
| Long build sessions | `backgroundMode: continuable` + `tool-subagent-control`; compaction seam | `subagent.md:114-160` |
| Cost/speed A/B | `tokenUsage` + `sessionStats` joined on `request/context`; own price table | §7 |

**Landmines for a validator preset:** (1) child joining nothing = zero tools; `composeFrom()` binds child to parent preset — scope with `toolFilter`; (2) `tool-subagent-report` must stay host-plane.
