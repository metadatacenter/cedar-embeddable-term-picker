# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-12

Aligns with `cedar-model-typescript-library@1.0.28`.

- Meets WCAG 2.2's 24px minimum target size, reflows the release history at 320 CSS px, and gives each result list semantics and a name button that states whether its detail is open.

### Fixed

- Every target meets WCAG 2.2's 24px minimum. A hierarchy's rows stand 24px apart, each twist is
  24px square and each term 24px tall. A release in the history and the release count on a result
  row are each 24px tall, so a row that carries a count grows from 27px to 33px. Glyphs and text
  keep their sizes.
- On a host narrower than 480px, each release in the history takes two lines: its declared version
  and tag, then its date and hash. The history no longer scrolls sideways at 320 CSS px, and its
  count no longer runs over the column headings beside it.
- The selection's source line and a value set row's line carry their whole text as a title, as the
  lines beside them do.
- The narrowing panel opens above its chip when more room is there than below, as in a short or
  zoomed window, and takes the room on the side it opens.
- Each result is a list item in a list, which holds the row and the history and detail it opens.
  The row's name is a button that opens the detail and states whether it is open, and the release
  count is a second button. A selected row's button says so after its name, in the words of the
  bar's heading. The name is the row's Tab stop, and the focus ring stays on the row. A click
  anywhere on a row opens it and moves focus to its name, a double click chooses it, and Space now
  opens it as Enter does. Nothing visible changes.

## [0.1.0] - 2026-11-09

Aligns with `cedar-model-typescript-library@1.0.27`.

- First public release of `<cedar-embeddable-term-picker>`, a Web Component for choosing what constrains a CEDAR field: an ontology, a branch of one, a class, a value set or a property.
- One search term shows how many matches each kind has, and refining the query updates every count at once. The picker reads from the CEDAR terminology server.
- A host-fonts bundle serves pages that register CEDAR Roboto 400 and 500 themselves. It is about 94 kB smaller gzipped than the standalone bundle.

### Added

- A second bundle, `cedar-embeddable-term-picker.host-fonts.js`, with its own
  `bundle-manifest.host-fonts.json`, for a host page that registers CEDAR Roboto 400 and 500
  itself. It differs from the default bundle only in its font registrar, which registers no
  faces, and it embeds no font at all. It is about 122 kB smaller raw and 94 kB smaller gzipped.
  `npm run build:production` builds both, the size gate holds each to its own ceiling, and the
  package carries both, each verified byte for byte against its manifest.
- A freshness check, `npm run check:fresh`. `npm run build:production` records a content
  fingerprint of each build's sources, configuration, dependency lock and installed CEDAR
  packages, and `npm run bundle` copies it into each bundle's manifest as `provenance`. The check
  fails when either bundle was not made from the current sources, and the browser tests, the
  visual baselines and the packaging step run it before they use the prebuilt output.

### Fixed

- The result tabs follow the ARIA tabs pattern. The shown tab is the only Tab stop, the left and
  right arrows move focus along the strip and wrap at either end, Home and End go to the first and
  last tab, and Enter or Space shows the focused tab, so moving focus fetches nothing. The result
  list is the shown tab's panel. Nothing visible changes.

## [0.1.0-dev.20260915.0ec47d9c] - 2026-09-16 (Nexus)

First Nexus development snapshot for the split CED host. Browser tests accept an isolated port.

### Added

- A distribution. `npm run dist` flattens the build into one classic script with
  esbuild, holds it to a recorded size ceiling raw and gzipped, and stages an npm
  package from those exact bytes, verified afterwards byte for byte. Which registry
  a package belongs to is derived from its version, so a development snapshot
  cannot reach npmjs by forgetting a flag.
- `terminologyBaseUrl`, which is what makes the picker embeddable off the
  terminology server's own origin. Unset, it asks its own origin for `/search`,
  which the development server's proxy answers and no host page does.
- The published type declarations, emitted from `cetp-public-api.ts` and the
  one import-free file it re-exports, so every path a host's compiler follows is
  inside the package.
- The Angular 22 project: a zoneless application registering `<cedar-embeddable-term-picker>`
  as a custom element in shadow DOM, with ESLint, Prettier, the Angular CLI's Vitest
  builder and a GitHub Actions gate.
- A placeholder component carrying the element boundary and nothing else — a `query`
  input, a `cancelled` output, a search box and the four tab names, over no search.
- CEDAR's design values, copied from the CEDAR Embeddable Editor: the type scale and
  brand palettes in `_cee-tokens.scss`, and Roboto at three weights embedded as font
  faces. A `FontRegistrar` component registers them in the document, because browsers
  ignore `@font-face` declared inside a shadow root.
- `_cedar-neutrals.scss`, the surfaces, borders and text colours CEE renders but does
  not collect into a palette, gathered here with each value's source recorded.

### Changed

- The package is publishable: `private: true` is gone, the version is a dated
  development snapshot, and the licence the repository already carried is declared.
  Nothing has been published on either channel yet.
- The compiler checks the declarations in `node_modules` rather than trusting them,
  and keeps Angular's class-field semantics — `skipLibCheck` off and
  `useDefineForClassFields: false`, both of which the CEDAR Embeddable Editor holds.
  Neither produced an error, which is the only time either is cheap to adopt.

### Fixed

- Naming the element in `HTMLElementTagNameMap` made Angular resolve that interface
  as the host element type when checking the component's own host bindings, so
  without an `HTMLElementEventMap` overload the narrowest match for `keydown` became
  the catch-all, `$event` collapsed to `Event`, and the production build failed on
  the Escape handler.
