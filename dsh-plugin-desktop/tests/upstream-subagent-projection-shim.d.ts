/**
 * Upstream packaging gap in `@deepseek-ai/dsh-subagent@0.1.5-rc.2`.
 *
 * Its public type entry augments `SessionProjectionMap` with `subagent` and
 * `subagentTiming` (`lib/types/projection-types.d.ts`), but the matching
 * `SessionProjectionStateMap` augmentation lives in `lib/types/projection.d.ts`,
 * which no exported type entry reaches: the source imports `projection.ts` only
 * for runtime values, so the emitted declarations drop the edge. A program that
 * imports the package then fails inside `dsh-session-projection`'s own
 * `register<K, S extends SessionProjectionStateMap[K]>` signature (TS2536/TS2344).
 *
 * This restates only the two KEYS, typed `unknown`; nothing in this repository
 * registers those projections (the package does at runtime). When upstream
 * publishes the real augmentation the property types conflict (TS2717) — that
 * error is the signal to delete this file.
 */
import type {} from '@deepseek-ai/dsh-subagent'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagent: unknown
    subagentTiming: unknown
  }
}
