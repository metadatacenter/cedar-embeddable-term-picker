# Developing the CEDAR Embeddable Term Picker

For installing the published component, start with the [README](../README.md) and
the [installation guide](https://metadatacenter.readthedocs.io/en/latest/cedar-embeddable-term-picker/).
This page covers work on the component source.

## Requirements

Use the Node version named by `.nvmrc`. The component build does not require Java
or a running CEDAR stack; live vocabulary search needs a terminology service.

## Running It

```shell
npm install
npm start
```

This serves a development host on port 4500 — a page standing in for the
Template Designer, which sets the element's `query` attribute and listens for
its `cancelled` event. Nothing on that page ships.

## Building and Testing

| Command                    | What it does                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run build:production` | the custom element and its host-fonts counterpart, both under `dist/`                                              |
| `npm test`                 | unit tests, through the Angular CLI's Vitest builder, then the untranslated-string guard                           |
| `npm run lint`             | ESLint over TypeScript and templates, Prettier included                                                            |
| `npm run typecheck`        | `tsc` over every file under `src/`                                                                                 |
| `npm run dist`             | the distribution: two scripts, their declarations, and a staged package                                            |
| `npm run check:fresh`      | a check that both scripts in `dist-bundle/`, and the builds they came from, match the current sources              |
| `npm run test:ci`          | the gate: lint, typecheck, tests, the production build, the browser tests and the distribution                     |
| `npm run test:visual`      | desktop and narrow CEE-style pixel baselines for both builds in pinned ARM Linux Docker (run `npm run dist` first) |
| `npm run audit:prod`       | advisories against what actually ships                                                                             |

`npm run build:production` records beside each build a fingerprint of what it was compiled
from: `src/`, `public/`, `scripts/`, the root configuration files including `package-lock.json`,
and the installed design tokens and model library. `npm run bundle` refuses a build whose inputs
have changed since, and copies the record into each script's manifest. `npm run check:fresh` fails
when either script or its record is missing, when the inputs or the build have changed since the
script was made, or when the script's bytes differ from its manifest. It compares contents, not
timestamps, so touching a file changes nothing and an edit that keeps its timestamp still fails.
Rebuild with `npm run dist`. The browser tests, the visual baselines and the packaging step run
the check before they use the prebuilt output, so none of them can test or stage a stale build. A
sibling that loads `dist-bundle/` from this checkout, as the designer's browser suite does through
`PICKER_BUNDLE`, can run `npm --prefix ../cedar-embeddable-term-picker run check:fresh` first.

Every string the picker shows is stated in `src/assets/i18n/en.json` and
`hu.json`, which must declare the same keys. The guard `npm test` ends with,
`scripts/i18n-guard.test.mjs`, fails on template text, a read attribute or a
message written outside those files. A deliberate exception goes in
`i18n-allowlist.json` with its reason, and an entry that no longer matches
anything fails too.

GitHub Actions runs the gate and visual baselines on push and pull request. The
visual runner uses Playwright 1.64.1 on ARM Linux both locally and in CI, with no
pixel difference allowance. To review an intentional visual change, run `npm run dist` first,
then run `npm run test:visual -- --update-snapshots` and inspect both images. The build is zoneless, so
change detection runs on signals rather than on `zone.js` patching the browser's
async APIs: a view updates on a microtask after a signal is set, and
`await fixture.whenStable()` is what a spec waits on.

Fuller development notes are in
[VERSIONING-RUNBOOK.md](https://github.com/metadatacenter/cedar-development/blob/develop/ops/VERSIONING-RUNBOOK.md),
which covers running, building and releasing the picker alongside the store it
reads.

### Coordinated host build

The package also includes `integration.mjs`, an AOT-compiled ES module with host fonts and external
Angular, RxJS, translation and model dependencies. It is an input to a coordinated Angular application
build, not a script to load directly in a browser. `integration-manifest.json` records its digest and
exact runtime versions (including the model content digest); the host must verify those identities
before combining components. The Template Designer demonstrates this build.

The default package entry, standalone script, host-fonts script and public element APIs are unchanged.
Standalone consumers do not need to install Angular or change their embedding code.
