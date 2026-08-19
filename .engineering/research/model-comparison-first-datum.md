# First model-comparison datum — two Parametria runs, hand-aggregated

**Date:** 2026-08-19 · **Author:** RM · **Method:** `assistant/message.usage` summed from the session exports the operator dropped in Downloads. This is the manual prototype of what issues #5/#6 automate.

## The two runs

| | Run 1 — APW workbench | Run 2 — 36" wall cabinet |
|---|---|---|
| Orchestrator | `anthropic/claude-opus-5-fast` (openrouter) | `google/gemini-3.6-flash` (openrouter) |
| Subagents | 3 × `deepseek-v4-flash` | 1 spawned → **failed opaquely** |
| Build | 94 nodes, imported T-slot profiles (Pattern E), incremental w/ per-increment validation | 119 nodes, all `brep.box`, **single-shot build then end validation** |
| Wall clock | ~20.4 min main (+ ~8 min sub work inside) | **9.9 min** |
| Steps / assistant msgs | 47 + 21 (subs) | 34 |
| Output tokens | 24,281 main + 11,683 subs = 35,964 | 38,531 |
| Uncached input | 3,469 main + 69,626 subs = 73,095 | **524,035** |
| Cache read | 3.81M main + 0.52M subs | 2.25M |
| Cache write | 100,300 | **0** |
| Vision | Orchestrator vision-capable; subs text-only (W1 incident) | **Orchestrator vision-capable; self-validated with 4 in-context image reads** |
| Outcome | Delivered + verified (arithmetic + orchestrator-read images) | Delivered + verified (arithmetic + orchestrator-read images); minor drift: report says 119 nodes, inspect says 118 |

## Findings

1. **Gemini-flash run was ~2× faster wall-clock and skipped the incremental discipline** (skill mandates per-increment validation; it built everything then validated once). Cheaper/faster, but the safety net that catches spatial errors early never engaged — quality risk scales with build complexity. A/B protocol (#6) must score *skill compliance* alongside cost/speed, or fast runs win by cutting the discipline.
2. **Cross-provider cache accounting is incomparable raw:** gemini run shows 2.25M cacheRead with **zero** cacheWrite (implicit caching, no write events recorded); claude run shows explicit 100k cacheWrite. Confirms the research caveat: compare **uncached input + output**, and even then per-provider semantics differ (gemini's 524k uncached input likely includes re-sent image bytes). Price table (#5) must price buckets per provider, not generically.
3. **NEW HARNESS FINDING — opaque subagent spawn failure.** The gemini run's `subagent` call returned exactly `Error: subagent run failed` (isError, no reason); the child transcript is empty (0 messages). No diagnostics: was it provider auth, model routing, composition? The orchestrator recovered unprompted (read images itself + `inspect-definition`) — good instinct, invisible cost. The Parametria preset work (#1) must make spawn failures diagnosable; possibly an upstream gap worth a yarn patch or upstream issue if `dsh-tool-subagent` genuinely swallows the cause.
4. **`google/gemini-3.6-flash` is a strong validator-pin candidate** (#1's open ruling): proven vision-capable in-fleet, cheap tier, fast. RM recommendation: pin validators to it via a pi-ai route with `input: [text, image]` declared, pending owner pricing input.
5. Both runs delivered. The interesting cost driver difference: Run 1 spent tokens on subagent isolation (input re-establishment per child, 69.6k uncached) to protect orchestrator context; Run 2 spent 524k uncached input absorbing images in-context. **Neither pattern is obviously cheaper — the A/B harness should measure the two validation architectures explicitly** (subagent-isolated vs in-context vision) as a first experiment.

## Caveats

Different builds (complexity not equivalent), different discipline paths, n=1 each, providers meter differently. Directional only — the point of #5/#6 is to make this comparison rigorous and cheap to produce.
