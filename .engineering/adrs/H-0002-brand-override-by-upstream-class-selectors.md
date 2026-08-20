---
Status: accepted
Date: 2026-08-20
---

# Brand presentation overrides upstream client marks by class selector, because no composition seam exists

The desktop product renders Parametria branding in place of the three DeepSeek marks the upstream
client draws (sidebar brand lockup, collapsed sidebar rail, empty-state hero) and replaces the hero
headline. None of those surfaces has a slot, service, or locale seam a plugin can occupy, so the
desktop client plugin styles them by their emitted CSS-module class names from its own advanced-shell
stylesheet.

## Considered Options

- **Occupy an upstream slot.** There is none. `dsh-client-ui-sidebar` renders `BrandWordmark` and
  `FishLogo` inline (`SidebarRoot.tsx:140,152`), and `dsh-client-ui-conversation` renders `FishLogo`
  plus the headline inline (`EmptyHero.tsx:122,124`). The desktop overlay owns the `root` slot and
  re-renders upstream's `sidebar` / `conversation` slots whole; replacing either to reach one row
  would mean reimplementing an upstream surface, which is the fork behaviour H-0001 exists to avoid.
- **Register a locale override for the headline.** Closed. `LocaleRuntime.register` is
  single-occupant and throws on a duplicate `(namespace, locale)` pair, so the conversation package's
  namespace cannot be re-registered by another plugin.
- **Patch the upstream packages through yarn `patches/`.** Available, but it makes every pin bump a
  patch-rebase and puts presentation into the dependency layer. Rejected for a purely visual change.
- **Selector override from the desktop stylesheet.** Chosen.

## Consequences

- The emitted class names (`hHd-Xa_*`, `pXSMma_*`) are content-derived per-module prefixes. They are
  stable for a pinned upstream version and **change when the submodule pin moves**.
- `dsh-plugin-desktop/tests/client-brand.spec.ts` carries the resulting obligation: it asserts each
  overridden class against the bundle's own module export mapping, asserts the headline grid shape
  the replacement is placed into, and asserts the superseded `hero.headline` entry in both locales.
  A pin bump that changes any of them fails a named test rather than silently un-branding the app.
- **Lane C inherits this at every pin bump**: re-run that spec and re-derive the class table before
  accepting a new pin.
- ~~The override reaches advanced mode only.~~ **Superseded 2026-08-20 (owner "brand everywhere"
  ruling, issue #26):** AGENTS.md now permits visual branding overrides (and, per the later ruling on
  issue #36, additive desktop-owned UI) in compatibility mode; PR #29 landed a compat-mode brand
  sheet, so a default install shows Parametria branding in both shell modes. Behavior overrides in
  compatibility mode remain forbidden. (Bullet corrected by the RM after PR #37 flagged it stale —
  both its review axes caught the drift independently.)
- A stylesheet cannot read the active locale, so the replacement headline is one string in every
  locale; under `zh` it supersedes upstream's `探索未至之境` with English.
