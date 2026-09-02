# Agent Note: `read_image` route fallback seam

Status: implemented (PR #79, issue #54 — pending live confirmation)

English | [中文](2026-09-02-read-image-route-fallback.zh.md)

## Problem

`@deepseek-ai/dsh-tool-fs` refuses `read_image` when the session model declares no image input. On the Parametria harness the session model is often text-only while an image-capable route (`parametria-vision`) is registered machine-wide, so every image read hard-refused unless an external description tool (modlens) happened to be healthy.

## Decision

The fork carries a root Yarn patch, `patches/dsh-tool-fs@0.1.1-rc.2.patch`, that turns the exact-modality gate in `assertImageCapableRoute` into a seam: after the calling route fails the gate, the tool emits the `fs/read-image-route` waterfall and, if a listener returns an image-capable candidate that passes the same modality check, activates it only after the image is durably admitted. With no listener the original refusal is thrown unchanged, so compatibility composition is inert.

The desktop plugin `dsh-plugin-desktop/parametria-read-image-fallback` answers that waterfall only in the Parametria preset: it nominates the same route and model as `subagent_validator` (held equal by a preset drift fence), keeps the remaining requests of the active turn on that route, projects the historical image block to stable text when the prior route is restored on the next turn, and releases its per-agent state on `agent/disposed`.

## Consequences

- The `fs/` event namespace is upstream-owned; `fs/read-image-route` is fork-invented and may collide with a future upstream event. Re-validate the patch on every pin bump (`.engineering/upstream-watch.md` RE-VALIDATE table).
- The remainder of a fallback turn is billed on the vision provider, the original provider's cache reuse is lost, and `reasoningEffort` is omitted on the fallback route. This is disclosed in the preset row comment.
- Candidate for an upstream contribution to `deepseek-harness` once the live datum confirms the behaviour (issue #54 remains open until then).
