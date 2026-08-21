/**
 * The Parametria run-evidence surface (issue #23).
 *
 * ## What this module is for
 *
 * A Parametria run produces artifacts — screenshots, dumped or generated spec
 * JSON, and the generator scripts the model writes to get past a long command
 * line. Where those land was, until this module, a PERSONA CONVENTION: the
 * preset's prose told the agent to derive `.parametria-evidence/<session id>/`
 * for itself, in whichever of two shell dialects it happened to be using, to
 * create it, and to notice when the session-id segment expanded to nothing. That
 * instructs; it does not govern. Every clause of it is attention the run spends
 * on filing rather than on millwork, and every clause is a place a run can go
 * wrong quietly — the observed failures were an unignored `spec.json` loose in
 * the user's repository and `C:\tmp` writes refused by the sandbox because a
 * skill example named them.
 *
 * This module makes the run directory a FACT OF THE HOST instead. The
 * derivation lives here once; {@link apply} publishes it to every shell call as
 * `DSH_PARAMETRIA_EVIDENCE_DIR`, already absolute, already run-scoped, and
 * already created; and `parametria-capture` computes the very same path from the
 * very same functions, so the tool's output and the shell's variable cannot
 * drift apart.
 *
 * ## Why a `shellEnv` contributor, at this pin
 *
 * `ctx.shellEnv` is a plugin-facing registry whose `resolve(execution)` runs per
 * shell call (`deepseek-harness/packages/shell/shell-env/src/index.ts:110`,
 * `:152`); `DSH_SESSION_JSONL` in that same file is upstream's own instance of
 * the pattern. `collect()` is called by the shell TOOLS
 * (`packages/shell/tool-pwsh/src/index.ts:363`,
 * `packages/shell/tool-bash/src/index.ts:341`), and the sandbox executor is a
 * SUBCLASS of the local one (`packages/shell/pwsh-sandbox/src/index.ts:52`), so
 * the single merge at `packages/shell/pwsh-local/src/index.ts:240` serves
 * confined, escalated, and unconfined calls alike. Ambient `DSH_*` is discarded
 * before that merge, which is what makes a registered contributor the only way
 * this value can exist at all.
 *
 * The alternatives were weighed and are weaker rather than different: a
 * `systemPrompt` section or a shaped tool result still hands the agent prose to
 * follow, and a fence that REFUSES a write outside the root is not expressible
 * at this pin — `PreToolDecision` is `allow | deny | ask` with input rewriting
 * excluded (`packages/core/tools/src/index.ts:588`, `:585`) and
 * `SandboxExecutionPolicy` carries no extra writable roots
 * (`packages/sandbox/sandbox/src/index.ts:39-52`). What bites at gate time is a
 * fence over this module's DERIVATION, which the preset suite carries.
 *
 * @module dsh-plugin-desktop/parametria-evidence
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-shell-env'

/** Stable Cordis plugin name. */
export const name = 'parametria-evidence'

/**
 * The registry is a host service; a preset row consuming it is ordinary — both
 * shell tools do the same from the same file.
 */
export const inject = ['shellEnv']

/**
 * The run-artifact root, relative to the session workspace.
 *
 * THE one declaration. `parametria-capture` re-exports this rather than
 * spelling it again, the persona's copy is fenced against it, and the root
 * `.gitignore` entry is derived from the persona — so the string exists once and
 * every other appearance is checked against it.
 */
export const EVIDENCE_ROOT_SEGMENT = '.parametria-evidence'

/** The shell variable carrying the resolved run directory. */
export const EVIDENCE_DIR_ENV = 'DSH_PARAMETRIA_EVIDENCE_DIR'

/**
 * The self-ignoring marker written into the evidence ROOT the first time a run
 * directory is created under it.
 *
 * PR #25 gitignored `.parametria-evidence/` in THIS repository, which helps
 * exactly when the run's workspace happens to be this repository. The censused
 * runs worked in others. A `*` rule inside the directory ignores the directory's
 * whole contents and itself, so the hygiene travels to whatever repository the
 * run opens instead of being a property of one checkout.
 */
export const EVIDENCE_IGNORE_MARKER = [
  '# Written by the Suquo Systems Parametria harness (dsh-plugin-desktop).',
  '#',
  '# Run evidence is disposable output, never source. This directory ignores',
  '# itself so a run cannot dirty whichever repository it is working in — the',
  '# harness that created it is the only thing that should care that it exists.',
  '*',
  '',
].join('\n')

/** Where a run's evidence is anchored: the calling session's workspace and identity. */
export interface EvidenceSite {
  /** The session's working directory — the evidence root's parent. */
  cwd: string
  /** The session id — the run-scoping segment under the evidence root. */
  sessionId: string
}

/**
 * Why a site cannot anchor a run evidence directory, or `undefined` when it can.
 *
 * Total and synchronous, and deliberately separate from {@link evidenceDirFor}:
 * the capture tool turns a problem into a typed refusal the model can read,
 * while the shell contributor turns it into an absent variable. One rule, two
 * renderings, no second copy of the rule.
 *
 * @param site - the calling session's workspace and identity.
 * @returns the reason the site is unusable, or undefined.
 */
export function evidenceSiteProblem(site: EvidenceSite): string | undefined {
  if (site.cwd.trim().length === 0 || !isAbsolute(site.cwd)) {
    return 'the calling session has no absolute working directory, so the run evidence directory '
      + 'cannot be resolved. This requires an agent session.'
  }
  if (site.sessionId.trim().length === 0
    || /[\\/]/.test(site.sessionId)
    || site.sessionId.includes('..')) {
    return 'the calling session has no usable id for the run-scoped evidence directory.'
  }
  return undefined
}

/**
 * The run-scoped evidence directory for a site.
 *
 * Call only on a site {@link evidenceSiteProblem} accepts; the split keeps this
 * function total and keeps the rule in one place.
 *
 * @param site - the calling session's workspace and identity.
 * @returns the absolute run evidence directory.
 */
export function evidenceDirFor(site: EvidenceSite): string {
  return join(resolve(site.cwd), EVIDENCE_ROOT_SEGMENT, site.sessionId)
}

/**
 * Create one run evidence directory and make the root self-ignoring.
 *
 * Idempotent and best-effort BY DESIGN: it is called from a shell-call resolver
 * that must not throw — a throw inside `collect()` would take down the shell
 * tool itself, turning a filing convenience into an outage. A failure therefore
 * leaves the caller to decide, and the caller still publishes the path (the run
 * then fails loudly on its own first write, which is recoverable, instead of
 * silently losing the variable and falling back to bare filenames — the exact
 * failure this module exists to remove).
 *
 * @param dir - the absolute run evidence directory to create.
 * @returns undefined on success, or the error that prevented it.
 */
export function prepareEvidenceDir(dir: string): unknown {
  try {
    mkdirSync(dir, { recursive: true })
    // The marker belongs to the ROOT, not to one run: `join(dir, '..')` is the
    // root by construction of `evidenceDirFor`. Written only when absent, so an
    // operator who edits it keeps their edit.
    const marker = join(dir, '..', '.gitignore')
    if (!existsSync(marker)) writeFileSync(marker, EVIDENCE_IGNORE_MARKER, { flag: 'wx' })
    return undefined
  } catch (error: unknown) {
    // `wx` loses a benign race with a concurrent session; anything else is the
    // caller's to weigh.
    if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') return undefined
    return error
  }
}

/** Plugin config. */
export interface Config {
  /**
   * Create the run directory (and seed the root's self-ignore marker) the first
   * time a session resolves the variable.
   *
   * On by default: NAMING a directory that does not exist is most of the
   * original problem, because a script writing into a missing parent fails and
   * the model's recovery is a bare filename in the workspace root. Turning this
   * off keeps the variable and drops only the side effect on the user's tree.
   */
  createOnResolve?: boolean
}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({
  createOnResolve: z.boolean().default(true),
})

/**
 * The variable's model-visible description, published through the registry's
 * declaration surface.
 */
const VARIABLE_DESCRIPTION =
  'Absolute, run-scoped directory for this Parametria run\'s artifacts — screenshots, spec JSON, '
  + 'and any script the run writes. Already created. Write every artifact under it and nothing beside it.'

/**
 * Register the evidence-directory contributor.
 * @param ctx - the mounting context.
 * @param config - the resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  /**
   * Run directories this GENERATION has already prepared.
   *
   * Owned by this closure, so it dies with the generation rather than outliving
   * a profile switch (standard 15). A fresh generation re-prepares, which is
   * free: `prepareEvidenceDir` is idempotent.
   */
  const prepared = new Set<string>()
  ctx.shellEnv.register({
    name,
    variables: { [EVIDENCE_DIR_ENV]: { description: VARIABLE_DESCRIPTION } },
    resolve(execution) {
      const agent = execution.agent
      // A direct (non-agent) shell call has no workspace or run identity to
      // anchor to; publishing a guess would be worse than publishing nothing.
      if (agent === undefined) return {}
      const site: EvidenceSite = {
        cwd: agent.session.header.cwd ?? '',
        sessionId: agent.session.header.id,
      }
      if (evidenceSiteProblem(site) !== undefined) return {}
      const dir = evidenceDirFor(site)
      if ((config.createOnResolve ?? true) && !prepared.has(dir)) {
        // Recorded whether or not it succeeded: a retry on every subsequent
        // shell call of a session whose workspace is read-only would be a
        // per-call syscall storm for a condition that will not change.
        prepared.add(dir)
        const failure = prepareEvidenceDir(dir)
        if (failure !== undefined) {
          ctx.logger.warn(
            `${name}: could not prepare ${dir} `
            + `(${failure instanceof Error ? failure.message : String(failure)}); `
            + 'publishing the path anyway',
          )
        }
      }
      return { [EVIDENCE_DIR_ENV]: dir }
    },
  })
}

export default apply
