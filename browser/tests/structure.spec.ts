import { Locator, Page, expect, test } from '@playwright/test';
import { classHit, ontologyHit, results, search, source, stubHierarchy, stubSearch } from './support';

/**
 * The structure the picker draws, stated where a reader who cannot see it can find it.
 *
 * A tree's depth is drawn as an indent, a section's caption as a heading and a column's name above
 * the column. Each is also exposed as a level, a heading or a name, without a new role that would
 * change how the keyboard moves.
 */

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

/** Each entry's level, its place among its siblings and how many siblings it has. */
async function places(entries: Locator): Promise<string[]> {
  return entries.evaluateAll((items) =>
    items.map((item) =>
      ['aria-level', 'aria-posinset', 'aria-setsize'].map((name) => item.getAttribute(name) ?? '-').join(' '),
    ),
  );
}

/** A term's own subtree, keyed by the IRI asked about, so opening a node draws different children. */
const SUBTREES: Readonly<Record<string, object>> = {
  'http://ncit/Melanoma': {
    termLabel: 'Melanoma',
    path: [
      { termIri: 'http://ncit/Neoplasm', termLabel: 'Neoplasm' },
      { termIri: 'http://ncit/Melanocytic', termLabel: 'Melanocytic Neoplasm' },
    ],
    children: [
      { termIri: 'http://ncit/Acral', termLabel: 'Acral Melanoma', hasChildren: true, descendantCount: 3 },
      { termIri: 'http://ncit/Nodular', termLabel: 'Nodular Melanoma', hasChildren: false, descendantCount: 0 },
      { termIri: 'http://ncit/Ocular', termLabel: 'Ocular Melanoma', hasChildren: false, descendantCount: 0 },
    ],
    childCount: 3,
  },
  // Two of the node's five children, so the set is the five it reports rather than the two drawn.
  'http://ncit/Acral': {
    termLabel: 'Acral Melanoma',
    path: [],
    children: [
      { termIri: 'http://ncit/AcralA', termLabel: 'Acral A', hasChildren: false, descendantCount: 0 },
      { termIri: 'http://ncit/AcralB', termLabel: 'Acral B', hasChildren: false, descendantCount: 0 },
    ],
    childCount: 5,
  },
};

async function openTree(page: Page): Promise<void> {
  await stubSearch(page, () => ({
    sources: [source('NCIT', { name: 'National Cancer Institute Thesaurus' })],
    results: { class: results([classHit('NCIT', 'Melanoma', { descendantCount: 5 })], { distinctLabelCount: 1 }) },
  }));
  await stubHierarchy(page, (query) => {
    const iri = query.get('termIri')!;
    return { sourceAcronym: 'NCIT', termIri: iri, descendantCount: 5, ...SUBTREES[iri] };
  });
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await picker(page).locator('.rowhead').first().click();
  await picker(page).locator('.child').first().click();
  await expect(picker(page).locator('.tree .node')).toHaveCount(6);
}

test("a term's tree states each entry's level, its place among its siblings and their number", async ({ page }) => {
  await openTree(page);
  const tree = picker(page).getByRole('list', { name: 'Hierarchy', exact: true });
  const entries = tree.locator('.node');
  await expect(entries).toHaveText(
    ['Neoplasm', 'Melanocytic Neoplasm', 'Melanoma', 'Acral Melanoma', 'Nodular Melanoma', 'Ocular Melanoma'].map(
      (label) => new RegExp(label),
    ),
  );
  // The path is one entry a level, and the term's three children are the fourth level.
  expect(await places(entries)).toEqual(['1 1 1', '2 1 1', '3 1 1', '4 1 3', '4 2 3', '4 3 3']);
  // The levels are the accessible ones, not only attributes.
  await expect(tree.getByRole('listitem', { level: 4 })).toHaveCount(3);
  await expect(tree.getByRole('listitem', { level: 3 })).toHaveText(/Melanoma/);

  // An opened node's children are a level further down. It shows two of the five it reports.
  await picker(page).getByRole('button', { name: 'Expand Acral Melanoma' }).click();
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(4)).toHaveText(/Acral A/);
  await expect(entries.nth(3)).toContainText('2 of 5');
  expect(await places(entries)).toEqual(['1 1 1', '2 1 1', '3 1 1', '4 1 3', '5 1 5', '5 2 5', '4 2 3', '4 3 3']);
});

test("a property's tree states its parents, the property and its children at their levels", async ({ page }) => {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  const property = (iri: string, label: string, parents: string[] = []) => ({
    iri,
    kind: 'object',
    label,
    obsolete: false,
    parents,
    literals: [],
  });
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
                  sourceAcronym: 'RO',
                  versionId: 'ro-v1',
                  property: { ...property('urn:part', 'part of'), hasChildren: true },
                },
              ],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) => route.fulfill({ json: [] }));
  // Fifty children, a page, so whether there are more is not known until the next is read.
  const children = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      ...property(`urn:sub${from + index}`, `sub part ${from + index}`, ['urn:part']),
      hasChildren: false,
    }));
  await page.route('**/properties/hierarchy?*', (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    return route.fulfill({
      json: {
        selected: {
          sourceAcronym: 'RO',
          versionId: 'ro-v1',
          property: property('urn:part', 'part of', ['urn:related', 'urn:overlaps']),
        },
        ancestors: [property('urn:related', 'related to'), property('urn:overlaps', 'overlaps')],
        children: offset ? children(50, 2) : children(0, 50),
        offset,
      },
    });
  });
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await picker(page).evaluate((element) => Object.assign(element, { termTypes: ['property'] }));
  await picker(page).locator('input[type=search]').fill('part');
  await picker(page)
    .getByRole('button', { name: /part of.*in 1 ontology/ })
    .click();
  await picker(page)
    .getByRole('option', { name: /^part of in RO/ })
    .click();
  const tree = picker(page).getByRole('list', { name: 'Property hierarchy', exact: true });
  const entries = tree.locator('.node');
  await expect(entries).toHaveCount(53);
  const drawn = await places(entries);
  // Two parents, then the property under them, then its children, whose number is not yet known.
  expect(drawn.slice(0, 4)).toEqual(['1 1 2', '1 2 2', '2 1 1', '3 1 -1']);
  expect(drawn.at(-1)).toEqual('3 50 -1');

  // The next page is short, so the set ends with it.
  await picker(page).getByRole('button', { name: 'More children', exact: true }).click();
  await expect(entries).toHaveCount(55);
  const read = await places(entries);
  expect(read.slice(3, 4)).toEqual(['3 1 52']);
  expect(read.at(-1)).toEqual('3 52 52');
  await expect(tree.getByRole('listitem', { level: 3 })).toHaveCount(52);
});

test("the bar's two captions are headings, and the search's still names its field", async ({ page }) => {
  await stubSearch(page, () => ({
    sources: [source('NCIT', { name: 'National Cancer Institute Thesaurus' })],
    results: { class: results([classHit('NCIT', 'Melanoma')], { distinctLabelCount: 1 }) },
  }));
  await stubHierarchy(page, () => null);
  await page.goto('/?mode=constraint');
  await picker(page).locator('.picker').waitFor();
  const headings = picker(page).getByRole('heading', { level: 2 });
  // Nothing is selected yet, so the selection's heading is not there to be found.
  await expect(headings).toHaveText(['Find terms']);
  await expect(picker(page).getByRole('searchbox', { name: 'Find terms', exact: true })).toBeVisible();

  await search(page, 'melanoma');
  await picker(page).locator('.rowhead').first().click();
  await expect(headings).toHaveText(['Find terms', 'Selected term']);

  // In the table mode the table's heading is the same level as the bar's.
  await picker(page).evaluate((element) => element.setAttribute('selection-mode', 'constraints'));
  await expect(headings).toHaveText(['Selected terms', 'Find terms', 'Selected term']);
  await expect(headings.first()).toHaveJSProperty('tagName', 'H2');

  await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(picker(page).getByRole('searchbox', { name: 'Fogalmak keresése', exact: true })).toBeVisible();
  await expect(headings.nth(1)).toHaveText('Fogalmak keresése');
});

test("the history's head names its list, and each release's date and hash", async ({ page }) => {
  await stubSearch(page, () => ({
    sources: [
      source('NCIT', {
        name: 'National Cancer Institute Thesaurus',
        versionCount: 2,
        declaredVersion: '26.07d',
        versions: [
          { id: 'hash-c-0123456789abcdef', effectiveDate: '2026-07-01T00:00:00.000-07:00', declaredVersion: '26.07d' },
          { id: 'hash-b-0123456789abcdef', declaredVersion: '26.06e' },
        ] as never,
      }),
    ],
    results: { class: results([classHit('NCIT', 'Melanoma')], { distinctLabelCount: 1 }) },
  }));
  await stubHierarchy(page, () => null);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await picker(page).locator('.rowhead').first().click();
  await picker(page).locator('button.of').first().click();
  const releases = picker(page).getByRole('list', { name: '2 releases, newest first', exact: true });
  await expect(releases.getByRole('button')).toHaveCount(2);
  const [latest, earlier] = [releases.getByRole('button').first(), releases.getByRole('button').nth(1)];
  await expect(latest).toHaveAccessibleDescription('effective date 2026-07-01, content hash hash-c-01234');
  // A release with no date is described by its hash alone.
  await expect(earlier).toHaveAccessibleDescription('content hash hash-b-01234');
  // The name is still the text the button shows.
  await expect(latest).toHaveAccessibleName(/^26\.07d\s*2026-07-01\s*hash-c-01234\s*latest$/);

  await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
  const inHungarian = picker(page).getByRole('list', { name: '2 kiadás, a legújabb elöl', exact: true });
  await expect(inHungarian.getByRole('button').first()).toHaveAccessibleDescription(
    'hatálybalépés dátuma 2026-07-01, tartalmi hash hash-c-01234',
  );
});

test("the narrowing panel's head names its group of boxes, and its column each box's count", async ({ page }) => {
  await stubSearch(page, () => ({
    sources: [
      source('NCIT', { name: 'National Cancer Institute Thesaurus' }),
      source('MELO', { name: 'Melanoma Ontology' }),
    ],
    results: {
      class: results([classHit('NCIT', 'Melanoma')], { distinctLabelCount: 1 }),
      ontology: results([ontologyHit('MELO', 38, true), ontologyHit('NCIT', 950, false)]),
    },
  }));
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await picker(page).locator('.filter-chip > button').first().click();
  const group = picker(page).getByRole('group', { name: '2 ontologies', exact: true });
  await expect(group.getByRole('checkbox')).toHaveCount(2);
  await expect(group.getByRole('checkbox').first()).toHaveAccessibleName('MELO Melanoma Ontology 38 matching terms');
  await expect(group.getByRole('checkbox').nth(1)).toHaveAccessibleName(
    'NCIT National Cancer Institute Thesaurus 950 matching terms',
  );

  await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
  const inHungarian = picker(page).getByRole('group', { name: '2 ontológia', exact: true });
  await expect(inHungarian.getByRole('checkbox').first()).toHaveAccessibleName(
    'MELO Melanoma Ontology 38 egyező fogalmak',
  );
});
