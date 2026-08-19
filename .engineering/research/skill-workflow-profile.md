# Appendix — /suquo-systems-parametria workflow profile

> Research agent report, 2026-08-19. Source: `C:\Users\chidi\.agents\skills\suquo-systems-parametria\SKILL.md` (1166 lines; all line refs into that file). Scripts/references byte-identical between the two skill copies; only SKILL.md diverges. Synthesis lives in [parametria-harness-customization.md](parametria-harness-customization.md).

## 1. End-to-end workflow phases

| # | Phase | Lines | Harness must support |
|---|---|---|---|
| 0 | Backend/owner preflight — `PARAMETRIA_OWNER_ID` matches app `.env.local` | 10–26, 419–427 | env read, cross-repo file read (`suquo-systems-rust/apps/web/.env.local`) |
| 1 | Drawing analysis — dims + material classification (panel vs profile) | 733–742 | **vision** (orchestrator or Reference-Analyzer subagent, 667–682) |
| 1b | Interpretation checkpoint — ask user front-facing direction | 368 | user round-trip mid-build |
| 2 | Technique research — Grasshopper KB semantic search | 709–723, 744 | Pinecone + OpenAI embeddings over network |
| 2b | Profile-library resolution (`list-profiles`) for aluminium/T-slot builds | 287–317, 437 | Convex read |
| 3 | Spec generation — `.js`/`.mjs` generator → `C:/tmp/spec.json` | 28–77 | Write tool, `node`, writable `C:/tmp` |
| 4 | Incremental build — `build-definition` per increment, fresh definition, delete predecessor | 746, 795–825 | `node` CLI + Convex writes |
| 5 | Screenshot validation per increment — validator subagent → text verdict | 509–583, 584–663 | **subagent + vision + Playwright + live dev server** |
| 5b | Fix loop, max 3 attempts/increment, escalate to user | 655–666 | user escalation |
| 6 | Node-level isolation diagnostics (matrix definition, one image, delete) | 749, 753–765 | vision in main thread; Convex write+delete |
| 7 | Arithmetic validation — `inspect-definition` / `trace-panel` | 541, 829–866 | `node` CLI (no vision) |
| 8 | Report + one final inline screenshot | 750, 684–688 | one image in main context |
| 9 | Retrospective — edit SKILL.md itself, patch scripts, write to memory skill | 751, 767–793 | **write access to the skill's own files** |

Separate sub-workflow: fixing an existing definition — inspect → trace-panel → decompile → rebuild → validate → delete broken (827–886).

## 2. External capabilities required

**CLI/runtimes:** `node` (`scripts/convex-parametria.mjs`, 40KB ~25 commands, L428–461; vendored `scripts/node_modules` — must survive skill sync) · `node -e` inline (L48–75) · `uv run` PEP 723 → `screenshot-definition.py` (provisions playwright; L546, 1166) · `uv run python` → `query-grasshopper-kb.py` (no PEP 723 header; L714).

**Convex:** deployment `dev:kindly-avocet-785`, team `suquo`, project `suquo-systems-app`, `https://kindly-avocet-785.convex.cloud` (L14–20). Auth = **owner scoping, not credentials**: wrong owner reads as absent, never an error (L23, 1141). Config in `scripts/.env`. HTTP query API used by the screenshot script (`parametriaDefinitions:get`, L1134, 1157).

**Browser/screenshot** (`screenshot-definition.py`): Playwright headless chromium 1920×1080; browsers preinstalled `~/AppData/Local/ms-playwright`; needs **apps/web dev server live on :3000 from suquo-systems-rust** (L425, 1165); seeds `localStorage['suquo-template-owner-id']` pre-script else empty panel (L1158); navigates `/workspace/parametria`, drives Definitions search, drags the panel-resize handle (Maximize unwired, ~380px dock; L1160), calls `window.__fitToViewport()` after view switches (L561–570); coupled to DOM: `.parametria-vtb__dropdown-trigger` (2nd = display mode), `[aria-label^="Expand Definition folder "]`, theme buttons (L705, 1162).

**Vision:** mandatory phases 1, 5, 6, 8.

**Subagents** (Agent tool, `general-purpose`, L588): Validator (584–645: two `uv run` captures, reads both PNGs, fixed 8-field verdict block; must report exact error text of failed image reads, L530) · Reference analyzer (667–682: one-shot, structured text reused by later validators).

**Paths (hardcoded, Windows):** `C:/tmp/spec.json`, `C:/tmp/gen-*.js`, `C:/tmp/parametria-verify*.png` (L34, 42, 620–629, 688). Script paths written `~/.claude/skills/...` in 13 places while the loaded skill lives in `~/.agents/skills/...` (W21). `query-grasshopper-kb.py` reads `OPENAI_API_KEY` from other skills' `.env`s; **Pinecone API key hardcoded in source**.

**OS:** Windows + POSIX-ish shell snippets, writable `C:/tmp`, HMR-capable pnpm dev server.

## 3. Harness weaknesses the skill compensates for (W1–W22)

| # | Line(s) | Pain point | Structural fix |
|---|---|---|---|
| W1 | 521–532 | Vision prerequisite: subagents inherit session model; text-only model fails every image read while captures succeed → "PASS" that saw nothing | Per-subagent model pinning; capability assertion pre-spawn |
| W2 | 532–541 | Fallback ladder when session model text-only (orchestrator reads 1–2 decisive views; ~1 image/increment; lean on inspect-definition) | First-class vision-free validation path |
| W3 | 513–519 | Image context accumulation (100–500KB base64; 15–40 images/build) — the orchestrator/validator pattern exists only to route images out of context | Out-of-band image handling |
| W4 | 30, 372, 731 | "DO NOT read node-catalog.md (72KB)" — socket table duplicated inline | Retrieval over catalog |
| W5 | 115–119 vs 298 | **Contradiction**: L115 forbids `transform.rotate` + gives catalog grep; L298 says catalog stale, trust the bullet, don't grep | Live node-schema introspection |
| W6 | 296 | Stale hardcoded profile fileId; must use `list-profiles` | Live library query |
| W7 | 36, 48, 806 | Windows shell escaping (quotes, minus, `\n`, heredocs) → Write-then-execute detour | Structured tool args |
| W8 | 439 | `build-definition` inline JSON hits argv limit ~150+ nodes → `@C:/tmp/spec.json` file form | File/stream payloads |
| W9 | 707, 1166 | `uv run script.py` vs `uv run python script.py` breaks PEP 723 provisioning | Per-script runner metadata |
| W10 | 1165, 700, 702 | Dev server must pre-run; empty viewport indistinguishable from geometry failure; check `[computeStore] OCCT geometry worker ready` | Managed dev-server lifecycle + readiness probe |
| W11 | 570 | Stale HMR — verify dev server picked up latest `ParametriaViewport.tsx` | Same |
| W12 | 1160, 705, 706, 1162 | Screenshot script coupled to app DOM/UX defects (380px dock, Maximize unwired, search filters only uncategorized, ordinal dropdown) | Programmatic capture endpoint in-app |
| W13 | 1158 | Owner identity must be seeded into browser localStorage pre-script | Owner-aware launch profile |
| W14 | 23, 1141 | Silent owner drift: mismatch ⇒ empty reads + invisible writes, no error | Startup invariant check |
| W15 | 121–131, 694 | Silent kernel failure: degenerate cutter deletes its panel; only tell is console `[worker] op=boolean-cut shapeId=none` | Console capture piped into validation |
| W16 | 100–113, 400–402 | `surface.extrude` collapses to flat disc off-Z, no warning | Error surfacing |
| W17 | 795–801, 748 | Incremental discipline exists because spatial errors are invisible in code, obvious in images | Cheap visual feedback loop |
| W18 | 662, 664–666 | Manual fix-loop budgets (3 attempts, LOW → user) | Harness-enforced retry budget |
| W19 | 767–793 | Self-modification: skill edits its own SKILL.md/scripts, re-runs failing case, mirrors to memory | Write access + versioning for skill files |
| W20 | 458–461 | CLI table internally inconsistent (dataset commands both broken and working; `rename-dataset` twice) | Doc lint |
| W21 | (fs) | **Two divergent copies**: `~/.agents/skills` (82,109 B, Aug 19) vs `~/.claude/skills` (79,819 B, Aug 17); scripts identical, SKILL.md diverges; commands inside invoke `~/.claude/...` so the loaded copy executes the OTHER copy's scripts; self-edits land in whichever was loaded | Single canonical skill root; paths relative to loaded skill |
| W22 | 289, 298, 315 | Date-stamped empirical facts in prose — skill as its own regression DB | Real regression suite (`parametria-kernel-eval`) |

Secondary hazard: hardcoded Pinecone API key in `query-grasshopper-kb.py` + `OPENAI_API_KEY` sourced from two other skills' `.env` files.

## 4. Operator/session pre-arrangements

1. Vision-capable session model (hardest prerequisite; L521–532). 2. apps/web dev server on `PARAMETRIA_APP_URL` :3000 from suquo-systems-rust (NOT the standalone app; L1165). 3. `PARAMETRIA_OWNER_ID` == `NEXT_PUBLIC_TEMPLATE_OWNER_ID` (L23, 424). 4. `uv` + Playwright chromium present; `node` + vendored `scripts/node_modules`. 5. Writable `C:/tmp`. 6. Write + Agent + Bash + image Read tools. 7. Network: Convex, Pinecone, OpenAI. 8. Interactive user mid-build (L368, 662, 664). 9. Write access to the skill's own files for the retrospective (L767–793) + a canonical-root decision (W21).

## 5. Reference bundle

| File | Size | Load policy |
|---|---|---|
| `references/node-catalog.md` | 47KB, 153 nodes | Forbidden by default (L30, 372); grep-only — and L298 warns greps return stale data |
| `references/assembly-patterns.md` | 32KB | 3 chain walkthroughs + pitfalls (Pitfall #10 cited L1092) |
| `references/techniques.md` | 12KB | 7 Grasshopper→Parametria families + not-available list |
| `references/definition-examples.md` | 9KB | 8 worked specs |
| `references/schema.md` | 4KB | Convex tables, node/connection format (v1-era; superseded by L1155–1160) |
