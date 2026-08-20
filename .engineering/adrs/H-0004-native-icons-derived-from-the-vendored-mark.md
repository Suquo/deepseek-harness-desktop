---
Status: accepted
Date: 2026-08-20
---

# Both native icon sources are derived from the one vendored mark, and the application icon stays a committed raster

The fork's app, tray and Dock icons were DeepSeek's vendored artwork. They are now derived from
`dsh-plugin-desktop/assets/parametria-logo-icon.svg` — the same file the client mark module vendors
— by `scripts/brand-icon-sources.ts`, so no icon in the package is hand-authored artwork that could
drift from the mark the application paints. The application icon (`build/app-icon.png`) and the tray
source (`build/tray-icon.svg`) remain **committed** files that `yarn build` consumes, rather than
build products: a PNG re-encoded on every machine could carry no digest pin, and the digest pin is
what says the bytes in the tree are the reviewed ones.

## Consequences

- `scripts/generate-brand-icons.ts` is run by hand after the mark changes. The drift guards in
  `tests/package.spec.ts` fail until it is: the tray source is re-derived and compared exactly, and
  the application icon carries a digest pin plus a low-resolution render comparison, because a digest
  says the bytes did not change and says nothing about what they depict.
- The tray source can only be the mark's solid elements flattened to a single colour. That is forced
  by the platform, not chosen: a macOS template image carries alpha and nothing else, and the
  template variants are produced by replacing the one brand colour with black, which the mark's two
  blues and its `#fff` construction hairlines cannot survive.
- The application icon paints the mark on an opaque plate. The hairlines are white, so on
  transparency or over a light ground the artwork does not render as drawn. Plate colour, corner
  ratio and artwork ratio are three named constants; changing the ground is a one-line edit plus a
  regenerate.
- No `.ico` or `.icns` is authored in the repository. Electron Builder derives both from the PNGs.

## Supersedes two inherited statements of icon identity

Four inherited notes under `.agents/notes/implemented/architecture/` describe the icon as the
"iOS Default" artwork, and the macOS derivation as preserving "16-bit Display P3" colour data:

- `2026-08-15-macos-app-icon-inset.md` (and `.zh.md`) — Problem and Decision sections.
- `2026-08-15-desktop-compatibility-mode.md` (and `.zh.md`) — the platform-icon paragraph.

Both statements are now wrong: the source is the Parametria mark, and it carries an sRGB profile.
The mechanism those notes record is unchanged and still accurate — `generate-mac-app-icon.mjs`
validates a 1024×1024 RGBA16 source with an ICC profile, insets the artwork to 824×824, and
preserves the source's profile, whatever that profile is. Only the artwork identity moved.

Those files are **not edited here**, because AGENTS.md reserves `.agents/notes/` for the fork
parent's own decision notes and directs fork-level decisions to this ledger. This ADR is therefore
where the correction lives, and it is the authority where the two disagree. If the maintainer would
rather correct the inherited notes in place, that is four files plus their two `i18n.yaml`
blob-hash records, and this section names the exact sentences.
