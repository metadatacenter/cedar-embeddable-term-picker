# CEDAR Embeddable Term Picker (CETP)

[![Test](https://github.com/metadatacenter/cedar-embeddable-term-picker/actions/workflows/test.yml/badge.svg?branch=develop)](https://github.com/metadatacenter/cedar-embeddable-term-picker/actions/workflows/test.yml)

The CEDAR Embeddable Term Picker (CETP) puts vocabulary search and selection
inside a web application. Authors search once across ontologies, branches,
individual terms, value sets, and ontology properties, then choose the entries
their application needs.

A controlled-term field needs more than labels: it must identify which
vocabulary, branch, or set of terms provides its allowed values. CETP lets
authors discover and assemble those definitions visually, preserving the
identifiers and vocabulary versions that make metadata interpretable across
applications.

The [CEDAR Embeddable Designer
(CED)](https://github.com/metadatacenter/cedar-embeddable-designer) uses the picker
to define vocabulary constraints and choose controlled-term defaults. Other
applications can embed the picker independently. The
[CEDAR Embeddable Editor (CEE)](https://github.com/metadatacenter/cedar-embeddable-editor)
renders finished templates for metadata entry and performs its own value lookup.

CETP ships as a standard Web Component for plain HTML or a framework application.
It needs a compatible CEDAR terminology service for search; the host controls
that connection and decides how to apply and store selections.

## Documentation

The [CEDAR Embeddable Term Picker documentation](https://metadatacenter.readthedocs.io/en/latest/cedar-embeddable-term-picker/)
covers installation, service requirements, constraint sets, default terms,
properties, vocabulary versions, configuration, and appearance.

[Your First Embedded Term Picker](https://metadatacenter.readthedocs.io/en/latest/cedar-embeddable-term-picker/first-picker/)
builds a working page connected to your terminology service.
[Constraints and Selections](https://metadatacenter.readthedocs.io/en/latest/cedar-embeddable-term-picker/selections/)
explains the inputs and events a host uses.

## Installing

Stable releases are published on npm as
[`cedar-embeddable-term-picker`](https://www.npmjs.com/package/cedar-embeddable-term-picker):

```shell
npm install cedar-embeddable-term-picker
```

To check the current stable release:

```shell
npm view cedar-embeddable-term-picker version
```

The package contains `cedar-embeddable-term-picker.js`, the self-contained bundle,
and TypeScript declarations for the element and selection types. Copy the bundle
to the application's static assets and load it with a regular `<script>` tag.
It is a classic script, not an ES module. The host does not need to install Angular.

### Hosts That Already Supply CEDAR Fonts

The default bundle includes CEDAR Roboto 400 and 500. Hosts that already register
those fonts globally can instead load `cedar-embeddable-term-picker.host-fonts.js`.
Both variants register the same element and API; load only one. The host-font
variant falls back to the configured font stack when the faces are absent.

## Embedding

The example assumes your application proxies `/terminology/` to a compatible
CEDAR terminology server. Configure that proxy first, or use your deployment's
absolute service base URL:

```html
<cedar-embeddable-term-picker></cedar-embeddable-term-picker>

<script src="/assets/cedar-embeddable-term-picker.js"></script>
<script type="module">
  await customElements.whenDefined('cedar-embeddable-term-picker');
  const picker = document.querySelector('cedar-embeddable-term-picker');

  picker.terminologyBaseUrl = new URL('/terminology/', location.origin).href;
  picker.termTypes = ['ontology', 'branch', 'class', 'valueSet'];
  picker.constraintSet = { constraints: [], actions: [] };
  picker.addEventListener('constraintsSelected', (event) => {
    console.log('Selected constraints:', event.detail);
  });
  picker.addEventListener('cancelled', () => {
    console.log('Keep the host’s previous constraints.');
  });
  picker.query = 'melanoma';
</script>
```

Set properties after `customElements.whenDefined()`, with the service and
selection settings before the query. Arrays, objects, and numbers must be
JavaScript properties, rather than HTML attributes.

The picker uses the CEDAR terminology server's version-aware search API, not
BioPortal directly. An older deployment providing only metadata-entry
autocomplete is insufficient. Without `terminologyBaseUrl`, requests go to
the host page's own origin. A separate origin needs CORS support; keep upstream
credentials on the server.

## Constraints and Selections

One query updates result counts across all enabled categories. The author adds
entries to a draft table, reviews them, and presses **Done** to return the full
set. The host owns its original set until that result is applied.

| Event                 | Meaning                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `constraintsChanged`  | The in-progress draft changed; there is no completed-set payload. |
| `constraintsSelected` | **Done** returns `{ constraints, actions }`.                      |
| `cancelled`           | The host can close the picker without applying the draft.         |

Preserve both constraints and actions, including identifiers, source information,
and pinned versions. Existing exclusions and result-position actions are retained;
their authoring controls and constraint reordering are not available in this
release. Serialization belongs to the host's model library.

`termTypes` chooses among `ontology`, `branch`, `class`, `valueSet`, and `property`.
Omitting it enables all five; an empty array enables none. `maximumTerms` is an
optional positive whole-number limit on table entries. A whole ontology counts
as one entry.

For an individual default term, use a fresh picker with `selectionMode = 'term'`,
supply the field's set through `fieldConstraints`, and listen for `selected`.
Leave `termTypes` and `maximumTerms` unset, because assigning either selects the
table workflow. The search respects the field's constraints, but the host should
verify the chosen default against the current field before applying it.

Property selection uses `termTypes = ['property']`. Returned properties are
distinct from class/value constraints; the host decides where to store them.
Property lookup requires extracted property data in the terminology server's
versioned store.

See [Constraints and Selections](https://metadatacenter.readthedocs.io/en/latest/cedar-embeddable-term-picker/selections/)
for result shapes, vocabulary and version scopes, and compatibility with earlier
single-selection integrations.

## Appearance and Language

Set `language` to `en` or `hu`, as a property or attribute. English is the
default. Language can change at runtime, and multiple pickers can use different
languages and service URLs. Server-provided vocabulary labels are not translated.

The component uses Shadow DOM. Its supported CSS custom properties let a host
adjust colors, fonts, and text size without styling private component selectors:

```css
cedar-embeddable-term-picker {
  --cetp-color-primary: #0f7686;
  --cetp-font-size: 14px;
}
```

[Configuration and Appearance](https://metadatacenter.readthedocs.io/en/latest/cedar-embeddable-term-picker/configuration/)
lists all settings and style properties, explains framework integration, and
provides service troubleshooting guidance.

## TypeScript

The package exports declarations for the element and its selection data:

```typescript
import type { CedarEmbeddableTermPickerElement } from 'cedar-embeddable-term-picker';

await customElements.whenDefined('cedar-embeddable-term-picker');
const picker = document.querySelector('cedar-embeddable-term-picker') as CedarEmbeddableTermPickerElement;
picker.language = 'en';
```

These are type-only imports. Load the classic script for element registration;
it exports no runtime constructors or helpers.

## Developing the Component

For source builds, use the Node version in `.nvmrc`:

```shell
nvm use
npm ci
npm run dist
```

`npm start` runs the development host on port 4500. `npm run test:ci` runs the
main checks; `npm run test:visual` runs the visual baselines. These are contributor
commands; embedding the published package requires no component build.

[Development notes](https://github.com/metadatacenter/cedar-embeddable-term-picker/blob/develop/docs/development.md)
cover source setup, testing, and coordinated host builds. Within a CEDAR checkout,
use `cedarcli build frontends` for a local source build and deployment, or
`cedarcli test frontends` for the source build and checks. The reactor supplies
current local dependencies automatically.

The package also includes `integration.mjs` for coordinated Angular builds with
matching runtime dependencies. Ordinary embeds use the self-contained script
above.

## License

[BSD 2-Clause](https://github.com/metadatacenter/cedar-embeddable-term-picker/blob/develop/license.txt).
