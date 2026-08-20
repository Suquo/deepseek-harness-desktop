---
Status: accepted
Date: 2026-08-20
---

# The preset installer may seed the desktop profile selection, once, only when it is absent

Making a profile "the default" on DSH Desktop has exactly one mechanism, and it is
not the one the name suggests. `DSH_DESKTOP_DEFAULT_PROFILE` is an **output** of the
boot decision, not an input: the launcher writes it into the built-in terminal's
environment from the profile it has *already* selected, so a bare `dsh …` typed there
targets the same profile the window is showing. `desktop-cli.ts` takes it, deletes it,
and converts it into a `--profile` flag for the **upstream** DSH CLI. The desktop
launcher rejects `--profile` outright (`bin.ts` `parseDesktopCli`) and spawns Electron
with no arguments, so `beginDesktopProfileStartup(<userData>/profile-selection/state.json)`
is the sole input to which profile boots. We therefore decided that
`dsh-preset-parametria`'s installer may write that state file under an explicit
`--default`, and only when it does not already exist.

## Considered Options

**Document the environment variable instead.** Rejected as factually wrong, not merely
caveated: an exported value cannot change the booted profile, and on Windows the
launcher strips and rewrites it from the active profile every start. Shipping that
guidance would have shipped a broken instruction.

**Seed `active` directly.** Rejected. `active` asserts a profile that is already
adopted; the installer cannot know the profile will mount. Seeding `pending` — which is
byte-for-byte what a *first* tray-picker selection writes — inherits the launcher's
rollback contract instead: an unselectable pending profile falls back to `desktop` at
startup, and promotion to `lastKnownGood` still requires a healthy mount.

**Seed when the state is absent *or* exactly the pristine default.** Rejected, and this
is the real trade-off. It would let `--default` work on a machine that has merely
launched the app once, which is the common case on an existing workstation. But the
state file is rewritten on every boot, and an operator who deliberately picks `desktop`
produces a document indistinguishable from the untouched default — so that reach is
bought by silently overriding a choice the format cannot see. Absence is the only
unambiguous signal, so absence is the whole permission.

## Consequences

The installer now writes outside `$DSH_HOME` for the first time, into operator-shared
Electron `userData`. The write is opt-in (`--default`), refused before any other write,
and enforced at the syscall by `flag: 'wx'` so exclusivity does not depend on the
preceding check. `--force` is explicitly **not** a release for this claim — it releases
the installer's receipt over files it wrote under `$DSH_HOME`, and no flag in this
package should be able to move an operator's running application to a different profile.

That pre-check bounds the common case only, and the guarantee is narrower than
"all-or-nothing". The seed is written *last*, once the profile it names exists, so a
selection appearing between check and write is refused at the syscall with the profile
files already on disk; that run exits non-zero stating the profile installed and only
the default was not set. A concurrently starting app can also overwrite the seed
outright, since the launcher's `renameSync` ignores our exclusivity — the running app
winning is the safe direction, and it is not defended against.

`--default` also refuses a `--home` the launcher will never read: the launcher resolves
its home from `$DSH_HOME`, so that pair would seed a selection naming a profile the app
cannot find, rolled back at the next start after the installer reported success.

`--default` therefore refuses on any machine that has already started the app. That is
accepted: the tray picker is the authoritative surface there, its choice already
persists, and the refusal message says so.

Six values are now mirrored from `dsh-plugin-desktop/src` into an installer that
imports only node builtins and that `yarn check` runs *before* that package is built —
chiefly the `PRODUCT_NAME` passed to `app.setName`, which is what names the `userData`
directory. `tests/desktop-selection-drift.test.mjs` reads each one back from the
launcher's source, anchored to its declaration, so the duplication cannot rot silently.
It also asserts the *ordering* that makes that name load-bearing — `app.setName` before
`start()` and before the first `getPath('userData')` — which is what keeps the packaged
electron-builder `productName` irrelevant here, so it is deliberately not mirrored.
That fence is the tripwire for the pending rebrand migration: changing `app.setName`
moves `userData` wholesale, and the installer has to move with it.
