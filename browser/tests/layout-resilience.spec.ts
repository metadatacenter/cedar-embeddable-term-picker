import { Page, expect, test } from '@playwright/test';
import { VIEWPORTS, check, type Exception, type InPlaceScroller } from './layout-resilience.generated.mjs';
import { branchHit, classHit, ontologyHit, results, search, source, stubHierarchy, stubSearch } from './support';

/**
 * Whether the picker's content survives a narrow host, a zoomed window and wider text, and whether
 * its placeholders, field boundaries, icons, focus indicators and selection marks can be seen.
 *
 * The checks are the shared ones the token package generates into `layout-resilience.generated.mjs`,
 * which say what WCAG asks and how each is measured. This spec reaches each of the picker's main
 * states from a fresh page and records what the picker excuses. A finding fails the test unless it
 * is listed below with the visible change it needs, and a listed finding that no longer occurs fails
 * too, so the list cannot outlive what it describes.
 */

/**
 * Two-dimensional data, which 1.4.10 allows to scroll inside its own box at 320 CSS px. Its rows
 * are read across as well as down, and wrapping them would take the columns apart.
 */
const SCROLLS_IN_PLACE: readonly InPlaceScroller[] = [
  {
    selector: '.constraint-set',
    why:
      'The constraint table, a table of terms with their sources and releases. At 320 CSS px it is wider ' +
      'than the picker and scrolls inside its own section.',
  },
];

/** Findings that wait on a visible change. None waits now. */
const EXCEPTIONS: readonly Exception[] = [];

/**
 * Selected items the picker marks by class rather than by an ARIA state: a picked term, a shown
 * release and the selected result row.
 */
const PICKER_SELECTED = ['.picked > .term', '.on', '.pick.marked'];

const VERSIONS = [
  { id: 'hash-c-0123456789abcdef', effectiveDate: '2026-07-01T00:00:00.000-07:00', declaredVersion: '26.07d' },
  { id: 'hash-b-0123456789abcdef', effectiveDate: '2026-06-03T00:00:00.000-07:00', declaredVersion: '26.06e' },
  { id: 'hash-a-0123456789abcdef', effectiveDate: '2026-05-06T00:00:00.000-07:00' },
];

/** An answer with something on every tab, long names included, and a source that was not searched. */
const ANSWER = {
  sources: [
    source('NCIT', {
      name: 'National Cancer Institute Thesaurus',
      versionCount: 3,
      declaredVersion: '26.07d',
      versions: VERSIONS,
    }),
    source('DOID', { name: 'Human Disease Ontology', versionCount: 15, declaredVersion: '2026-06-30' }),
    source('MELO', { name: 'Melanoma Ontology' }),
    source('GONE', { served: 'unavailable', reason: 'sourceUnknown' }),
  ],
  results: {
    class: results(
      [
        classHit('NCIT', 'Melanoma', {
          descendantCount: 321,
          under: 'Melanocytic Neoplasm',
          names: [{ label: 'Cutaneous melanoma' }, { label: 'mélanome', language: 'fr' }],
        }),
        classHit('DOID', 'melanoma', {
          descendantCount: 31,
          definition:
            'A cell type cancer that has_material_basis_in abnormally proliferating cells derived from melanocytes.',
        }),
      ],
      { totalCount: 2, distinctLabelCount: 1 },
    ),
    branch: results([branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321)], {
      totalCount: 1,
      distinctLabelCount: 1,
    }),
    ontology: results([ontologyHit('MELO', 38, true), ontologyHit('NCIT', 950, false)]),
    valueSet: results([
      {
        type: 'valueSet',
        sourceSystem: 'bioportal',
        sourceAcronym: 'NCIT',
        termBaseIri: 'http://ncit/C-melanoma-stage',
        termBaseLabel: 'Melanoma Clinical Stage Value Set',
        termCount: 12,
        matchedTerms: [{ termIri: 'http://ncit/C-stage-1', termLabel: 'Stage I Cutaneous Melanoma' }],
      },
    ]),
  },
};

const PROPERTY = { iri: 'urn:part', kind: 'object', label: 'part of', obsolete: false, parents: ['urn:related'] };

/** An acronym of 24 characters without a space, longer than a row at 320 CSS px can show whole. */
const LONG_ACRONYM = 'OBOEXTENDEDANATOMYSUBSET';
/** A release of 20 characters, the longest a row shows whole rather than shortened in the middle. */
const LONG_RELEASE = '2026-06-30.build.417';

/**
 * A source with that acronym, that release and a release count of two digits answers on every tab,
 * beside a source of ordinary length.
 */
const LONG_ANSWER = {
  sources: [
    source(LONG_ACRONYM, {
      name: 'National Cancer Institute Thesaurus',
      versionCount: 15,
      declaredVersion: LONG_RELEASE,
    }),
    source('DOID', { name: 'Human Disease Ontology', versionCount: 15, declaredVersion: '2026-06-30' }),
  ],
  results: {
    class: results(
      [
        classHit(LONG_ACRONYM, 'Melanoma', { descendantCount: 321, under: 'Melanocytic Neoplasm' }),
        classHit('DOID', 'melanoma', { descendantCount: 31 }),
      ],
      { totalCount: 2, distinctLabelCount: 1 },
    ),
    branch: results(
      [
        branchHit(LONG_ACRONYM, 'Melanoma', 'Melanocytic Neoplasm', 321),
        branchHit('DOID', 'Melanoma', 'cell type cancer', 31),
      ],
      { totalCount: 2, distinctLabelCount: 1 },
    ),
    ontology: results([ontologyHit(LONG_ACRONYM, 950, false), ontologyHit('DOID', 0, false)]),
    valueSet: results([
      {
        type: 'valueSet',
        sourceSystem: 'bioportal',
        sourceAcronym: LONG_ACRONYM,
        termBaseIri: 'http://long/C-melanoma-stage',
        termBaseLabel: 'Melanoma Clinical Stage Value Set',
        termCount: 12,
      },
    ]),
  },
};

/**
 * Two of a group's rows come from RH-MESH and are told apart only by their parents, whose names
 * begin differently. The source has a release and a release count, so every column of those rows
 * holds something.
 */
const TWIN_ANSWER = {
  sources: [
    source('RH-MESH', { versionCount: 12, declaredVersion: '2014-03-11' }),
    source('NCIT', { name: 'National Cancer Institute Thesaurus', versionCount: 3, declaredVersion: '26.07d' }),
  ],
  results: {
    class: results(
      [
        classHit('RH-MESH', 'Melanoma', { descendantCount: 13, under: 'Neuroendocrine Tumors' }),
        classHit('RH-MESH', 'melanoma', { descendantCount: 13, under: 'Skin Neoplasms' }),
        classHit('NCIT', 'Melanoma', { descendantCount: 321, under: 'Melanocytic Neoplasm' }),
      ],
      { totalCount: 3, distinctLabelCount: 1 },
    ),
    branch: results(
      [
        branchHit('RH-MESH', 'Melanoma', 'Neuroendocrine Tumors', 13),
        branchHit('RH-MESH', 'Melanoma', 'Skin Neoplasms', 13),
        branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321),
      ],
      { totalCount: 3, distinctLabelCount: 1 },
    ),
    ontology: results([ontologyHit('NCIT', 950, false)]),
    valueSet: results([]),
  },
};

/** What tells the two RH-MESH rows apart. */
const TWIN_PARENTS = ['under Neuroendocrine Tumors', 'under Skin Neoplasms'];

interface Answer {
  readonly sources: readonly object[];
  readonly results: Readonly<Record<string, object>>;
}

/**
 * Answers the search, the first source's release history, a tree for any term, and the property
 * endpoints, which find a property in the source named.
 */
async function stubAll(page: Page, answer: Answer = ANSWER, propertySource = 'RO'): Promise<void> {
  await stubSearch(page, (body) =>
    body.includeVersions
      ? { sources: [answer.sources[0]], results: { ontology: results([]) } }
      : {
          ...answer,
          results: Object.fromEntries(
            Object.entries(answer.results).filter(([kind]) => !body.types || body.types.includes(kind)),
          ),
        },
  );
  await stubHierarchy(page, (query) => ({
    sourceAcronym: query.get('sourceAcronym'),
    termIri: query.get('termIri'),
    termLabel: 'Melanoma',
    path: [
      { termIri: 'http://ncit/Neoplasm', termLabel: 'Neoplasm by Morphology' },
      { termIri: 'http://ncit/Melanocytic', termLabel: 'Melanocytic Neoplasm' },
    ],
    children: [
      { termIri: 'http://ncit/Acral', termLabel: 'Acral Lentiginous Melanoma', hasChildren: true, descendantCount: 3 },
      { termIri: 'http://ncit/Nodular', termLabel: 'Nodular Melanoma', hasChildren: false, descendantCount: 0 },
    ],
    childCount: 40,
    descendantCount: 321,
  }));
  // Registered after the search stub, so these answer first.
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          (route.request().postDataJSON().offset ?? 0) > 0
            ? []
            : [
                {
                  sourceAcronym: propertySource,
                  versionId: 'ro-v2',
                  property: { ...PROPERTY, literals: [], hasChildren: true },
                },
              ],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) =>
    route.fulfill({
      json: [
        { id: 'ro-v2-0123456789abcdef', declaredVersion: '2026-02-17', propertiesAvailable: true },
        { id: 'ro-v1-0123456789abcdef', declaredVersion: '2025-06-01', propertiesAvailable: true },
      ],
    }),
  );
  await page.route('**/properties/hierarchy?*', (route) =>
    route.fulfill({
      json: {
        selected: {
          sourceAcronym: propertySource,
          versionId: 'ro-v2',
          property: {
            ...PROPERTY,
            literals: [
              {
                predicate: 'http://www.w3.org/2000/01/rdf-schema#comment',
                lang: 'en',
                value: 'a core relation that holds between a part and its whole',
              },
            ],
          },
        },
        ancestors: [{ ...PROPERTY, iri: 'urn:related', label: 'overlaps', parents: [], literals: [] }],
        children: [{ ...PROPERTY, iri: 'urn:sub', label: 'has component', parents: ['urn:part'], hasChildren: true }],
        offset: 0,
      },
    }),
  );
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

async function open(page: Page, mode: string): Promise<void> {
  await stubAll(page);
  await page.goto(`/?mode=${mode}`);
  await picker(page).locator('.picker').waitFor();
}

async function answered(page: Page, mode = 'constraints'): Promise<void> {
  await open(page, mode);
  await search(page, 'melanoma');
}

/** A tab by its position: Terms, Branches, Ontologies, Value sets, Properties. */
async function showTab(page: Page, index: number): Promise<void> {
  await picker(page).locator('.tab').nth(index).click();
  await expect(picker(page).locator('.tab').nth(index)).toHaveAttribute('aria-selected', 'true');
}

/**
 * The five kinds, set before the query is typed. Setting them after a search starts a second one, and
 * a reply that arrives late replaces the results a test has already opened.
 */
async function withProperties(page: Page): Promise<void> {
  await open(page, 'constraints');
  await picker(page).evaluate((element) =>
    Object.assign(element, { termTypes: ['class', 'branch', 'ontology', 'valueSet', 'property'] }),
  );
  await search(page, 'melanoma');
  await expect(picker(page).locator('.tab')).toHaveCount(5);
}

/** The states, each reached from a fresh page. */
const STATES: Readonly<Record<string, (page: Page) => Promise<void>>> = {
  opened: (page) => open(page, 'constraint'),
  'the terms tab': async (page) => {
    await answered(page);
    await picker(page).locator('.rowhead').first().click();
  },
  'the branches tab': async (page) => {
    await answered(page);
    await showTab(page, 1);
    await picker(page).locator('.rowhead').first().click();
  },
  'the ontologies tab': async (page) => {
    await answered(page);
    await showTab(page, 2);
  },
  'the value sets tab': async (page) => {
    await answered(page);
    await showTab(page, 3);
  },
  'the properties tab': async (page) => {
    await withProperties(page);
    await showTab(page, 4);
    await picker(page).locator('.rowhead').first().click();
  },
  'a marked and opened row': async (page) => {
    await answered(page, 'constraint');
    await showTab(page, 2);
    await picker(page).locator('.row.pick').first().click();
    await expect(picker(page).locator('.detail')).toBeVisible();
  },
  'the tree': async (page) => {
    await answered(page, 'constraint');
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child').first().click();
    await expect(picker(page).locator('.tree .node')).toHaveCount(5);
    await picker(page).locator('.tree button.twist').first().click();
  },
  'the release history': async (page) => {
    await answered(page);
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child').first().locator('button.of').click();
    await expect(picker(page).locator('.history button.release')).toHaveCount(3);
  },
  "a property's detail": async (page) => {
    await withProperties(page);
    await showTab(page, 4);
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child.pick').first().click();
    await expect(picker(page).locator('cetp-property-detail .tree')).toBeVisible();
    await picker(page).locator('.release-toggle').click();
  },
  'the narrowing panel': async (page) => {
    await answered(page);
    await picker(page).locator('.filter-chip > button').first().click();
    await expect(picker(page).locator('.candidate input')).toHaveCount(2);
  },
  'a set constraint': async (page) => {
    await open(page, 'constraints');
    await picker(page).evaluate((node) =>
      Object.assign(node, {
        constraintSet: {
          constraints: [
            {
              sourceType: 'ontology',
              ontologyId: 'DOID',
              ontologyName: 'Human Disease Ontology',
              uri: 'http://purl.obolibrary.org/obo/doid.owl',
              version: { id: 'sha256:0123456789abcdef0123456789abcdef', declaredVersion: '2026-06-30' },
            },
            {
              sourceType: 'ontology-branch',
              ontologyId: 'NCIT',
              uri: 'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl#C3224',
              label: 'Melanoma',
              searchDepth: 2,
            },
          ],
          actions: [
            {
              action: 'move',
              termUri: 'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl#C3224',
              sourceUri: 'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl',
              type: 'OntologyClass',
              to: 2,
            },
          ],
        },
      }),
    );
    for (const summary of await picker(page).locator('cetp-constraint-table summary').all()) await summary.click();
    await search(page, 'melanoma');
  },
};

/** The pointer rests off the picker, so no hover state is measured as the picker's own. */
const park = (page: Page): Promise<void> => page.mouse.move(0, 0);

for (const [state, reach] of Object.entries(STATES)) {
  test(`reflow at 320 CSS px: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.reflow);
    // The host page's own gutter would leave the picker narrower than the viewport.
    await page.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        document.body.style.margin = '0';
        document.body.style.padding = '0';
      }),
    );
    await reach(page);
    expect((await picker(page).boundingBox())?.width).toBe(320);
    await park(page);
    await check(page, expect, { check: 'reflow', state, exceptions: EXCEPTIONS, scrollsInPlace: SCROLLS_IN_PLACE });
  });

  test(`resize to 640 by 400: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.resize);
    await reach(page);
    await park(page);
    await check(page, expect, { check: 'resize', state, exceptions: EXCEPTIONS });
  });

  test(`text spacing at 1280 CSS px: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.spacing);
    await reach(page);
    await park(page);
    await check(page, expect, { check: 'spacing', state, exceptions: EXCEPTIONS });
  });
}

/** Searches with every kind of result asked for, from a source whose acronym and release are long. */
async function answeredLong(page: Page): Promise<void> {
  await stubAll(page, LONG_ANSWER, LONG_ACRONYM);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await picker(page).evaluate((element) =>
    Object.assign(element, { termTypes: ['class', 'branch', 'ontology', 'valueSet', 'property'] }),
  );
  await search(page, 'melanoma');
  await expect(picker(page).locator('.tab')).toHaveCount(5);
}

/**
 * Each kind of result row, with a group's rows unfolded under its heading, and what its release does
 * at 320 CSS px: give way to the row's other parts, show whole, or not appear.
 */
const LONG_STATES: Readonly<
  Record<string, { reach: (page: Page) => Promise<void>; release: 'cut' | 'whole' | 'absent' }>
> = {
  'the terms tab': { reach: (page) => picker(page).locator('.rowhead').first().click(), release: 'cut' },
  'the branches tab': {
    reach: async (page) => {
      await showTab(page, 1);
      await picker(page).locator('.rowhead').first().click();
    },
    release: 'cut',
  },
  'the ontologies tab': { reach: (page) => showTab(page, 2), release: 'cut' },
  'the value sets tab': { reach: (page) => showTab(page, 3), release: 'whole' },
  'the properties tab': {
    reach: async (page) => {
      await showTab(page, 4);
      await picker(page).locator('.rowhead').first().click();
    },
    release: 'absent',
  },
};

/**
 * How the long source's row shows its acronym and its release: whether each is cut short, and its
 * title. A group's row sets the acronym apart, and a list row runs it into its name, where the row's
 * title holds it. It also says whether every row's cells lie within the row.
 */
async function longRow(page: Page) {
  return picker(page).evaluate((element, acronym) => {
    const root = element.shadowRoot!;
    const rows = [...root.querySelectorAll('.row.pick, .child')];
    const within = rows.every((row) => {
      const box = row.getBoundingClientRect();
      return [...row.children].every((cell) => {
        const { left, right, width } = cell.getBoundingClientRect();
        return width === 0 || (left >= box.left - 1 && right <= box.right + 1);
      });
    });
    const row = rows.find((candidate) => candidate.textContent!.includes(acronym))!;
    const shown = (node: Element | null) =>
      node && { cut: node.scrollWidth > node.clientWidth + 1, title: node.getAttribute('title') ?? '' };
    const who = row.querySelector('.who')!;
    return {
      within,
      acronym: shown(who.closest('.child') ? who : row.querySelector('.opens')),
      release: shown(row.querySelector(':scope > .version')),
    };
  }, LONG_ACRONYM);
}

/**
 * Every kind of result row fits at 320 CSS px however long its source's acronym and release. Each
 * gives way to an ellipsis and keeps its whole text in a title, as the rest of the row's cut text
 * does. Where the row has room, the two show whole.
 */
for (const [state, { reach, release }] of Object.entries(LONG_STATES)) {
  test(`reflow at 320 CSS px with a long acronym and release: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.reflow);
    // The host page's own gutter would leave the picker narrower than the viewport.
    await page.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        document.body.style.margin = '0';
        document.body.style.padding = '0';
      }),
    );
    await answeredLong(page);
    await reach(page);
    expect((await picker(page).boundingBox())?.width).toBe(320);
    await park(page);
    await check(page, expect, {
      check: 'reflow',
      state: `${state}, with a long acronym`,
      exceptions: EXCEPTIONS,
      scrollsInPlace: SCROLLS_IN_PLACE,
    });

    const narrow = await longRow(page);
    expect(narrow.within, 'every cell within its row').toBe(true);
    expect(narrow.acronym?.cut, 'the acronym is cut short').toBe(true);
    expect(narrow.acronym?.title).toContain(LONG_ACRONYM);
    if (release === 'absent') {
      expect(narrow.release).toBeNull();
    } else {
      expect(narrow.release?.cut, 'the release is cut short').toBe(release === 'cut');
      expect(narrow.release?.title).toBe(`Version ${LONG_RELEASE}`);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => (await longRow(page)).acronym?.cut, 'the acronym shows whole').toBe(false);
    if (release !== 'absent') expect((await longRow(page)).release?.cut, 'the release shows whole').toBe(false);
  });
}

/** The terms and branches tabs, each with the group that holds the two RH-MESH rows unfolded. */
const TWIN_STATES: Readonly<Record<string, (page: Page) => Promise<void>>> = {
  'the terms tab': (page) => picker(page).locator('.rowhead').first().click(),
  'the branches tab': async (page) => {
    await showTab(page, 1);
    await picker(page).locator('.rowhead').first().click();
  },
};

/**
 * Each row's distinguisher: whether it is cut short, its title, and the text it shows. The text
 * shown is every character drawn wholly before the ellipsis, leaving out text hidden in a box
 * clipped to a pixel.
 */
async function distinguishers(page: Page) {
  return picker(page).evaluate((element) =>
    [...element.shadowRoot!.querySelectorAll('.child .under')].map((node) => {
      const cut = node.scrollWidth > node.clientWidth + 1;
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = getComputedStyle(node).font;
      const end = node.getBoundingClientRect().right - (cut ? context.measureText('…').width : 0);
      const range = document.createRange();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let shown = '';
      for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
        if (text.parentElement!.getBoundingClientRect().width <= 1) continue;
        for (let at = 0; at < text.data.length; at++) {
          range.setStart(text, at);
          range.setEnd(text, at + 1);
          const { width, right } = range.getBoundingClientRect();
          if (width > 0 && right <= end + 0.5) shown += text.data[at];
        }
      }
      return { cut, title: node.getAttribute('title') ?? '', shown: shown.replace(/\s+/g, ' ').trim() };
    }),
  );
}

/**
 * Two rows of one source keep what tells them apart at 320 CSS px. Squeezed to no width, the
 * parent showed nothing and the rows read identically. It now gives way to an ellipsis and keeps
 * its whole text in a title, and where the row has room it shows whole.
 */
for (const [state, reach] of Object.entries(TWIN_STATES)) {
  test(`reflow at 320 CSS px with two rows of one source: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.reflow);
    // The host page's own gutter would leave the picker narrower than the viewport.
    await page.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        document.body.style.margin = '0';
        document.body.style.padding = '0';
      }),
    );
    await stubAll(page, TWIN_ANSWER);
    await page.goto('/?mode=constraints');
    await picker(page).locator('.picker').waitFor();
    await search(page, 'melanoma');
    await reach(page);
    expect((await picker(page).boundingBox())?.width).toBe(320);
    await park(page);
    await check(page, expect, {
      check: 'reflow',
      state: `${state}, with two rows of one source`,
      exceptions: EXCEPTIONS,
      scrollsInPlace: SCROLLS_IN_PLACE,
    });

    // The check measured the narrow rows it exists for: both parents are present and cut short.
    const narrow = await distinguishers(page);
    expect(narrow.map(({ title }) => title)).toEqual(TWIN_PARENTS);
    expect(narrow.every(({ cut }) => cut), 'each parent is cut short').toBe(true);

    // Twins share the word before the parent, so a narrow row shows the parent's name first, and
    // the two rows show different text.
    await page.setViewportSize({ width: 375, height: 640 });
    await expect
      .poll(async () => new Set((await distinguishers(page)).map(({ shown }) => shown)).size, 'two different starts')
      .toBe(TWIN_PARENTS.length);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(async () => (await distinguishers(page)).some(({ cut }) => cut), 'each parent shows whole')
      .toBe(false);
  });
}

for (const state of ['opened', 'the narrowing panel']) {
  test(`placeholder contrast: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.placeholder);
    await STATES[state](page);
    if (state === 'opened') await picker(page).locator('.search input').fill('');
    await park(page);
    const { measured } = await check(page, expect, { check: 'placeholder', state, exceptions: EXCEPTIONS });
    expect(measured.placeholder, 'inputs showing a placeholder').toBeGreaterThan(0);
  });
}

for (const [state, reach] of Object.entries(STATES)) {
  test(`field boundaries at 1280 CSS px: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.boundary);
    await reach(page);
    await park(page);
    const { measured } = await check(page, expect, { check: 'boundary', state, exceptions: EXCEPTIONS });
    // A selector that stops matching would let the check pass by measuring nothing.
    if (state === 'opened') expect(measured.boundary, 'controls that draw a boundary').toBeGreaterThan(0);
  });
}

for (const [state, reach] of Object.entries(STATES)) {
  test(`icons, focus indicators and selection marks at 1280 CSS px: ${state}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.indicators);
    await reach(page);
    await park(page);
    const { measured } = await check(page, expect, {
      check: 'indicators',
      state,
      scope: 'cedar-embeddable-term-picker',
      selected: PICKER_SELECTED,
      exceptions: EXCEPTIONS,
    });
    // A selector that stops matching would let the check pass by measuring nothing.
    if (state === 'opened') {
      expect(measured.icon, 'icons').toBeGreaterThan(0);
      expect(measured.focus, 'focus indicators').toBeGreaterThan(0);
    }
  });
}
