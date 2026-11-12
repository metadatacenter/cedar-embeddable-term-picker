import { Locator, Page, expect, test } from '@playwright/test';
import { classHit, ontologyHit, results, search, source, stubHierarchy, stubSearch, tabKey } from './support';

/**
 * Where focus goes when the control that had it goes away, and what a key does inside a row.
 *
 * A control that removes itself took focus with it to the top of the page, so a keyboard author
 * started again from there. Each case here pins where focus lands instead: the nearest control
 * that remains.
 */

const ANSWER = {
  sources: [
    source('NCIT', { name: 'National Cancer Institute Thesaurus', versionCount: 3, declaredVersion: '26.07d' }),
    source('MELO', { name: 'Melanoma Ontology', versionCount: 2, declaredVersion: '1.0' }),
  ],
  results: {
    class: results([classHit('NCIT', 'Melanoma')]),
    ontology: results([ontologyHit('MELO', 38, true), ontologyHit('NCIT', 950, false)]),
  },
};

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

/** Whether focus, inside the picker's shadow root, is on this element. */
async function focused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => (element.getRootNode() as ShadowRoot).activeElement === element);
}

async function openConstraints(page: Page, set: object): Promise<void> {
  await stubSearch(page, () => ANSWER);
  await stubHierarchy(page, () => null);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await picker(page).evaluate((element, set) => Object.assign(element, { constraintSet: set }), set);
}

function ontology(acronym: string): object {
  return { sourceType: 'ontology', ontologyId: acronym, ontologyName: acronym, uri: `urn:${acronym.toLowerCase()}` };
}

function action(term: string): object {
  return { action: 'delete', termUri: `urn:${term}`, sourceUri: 'urn:ncit', source: 'NCIT', type: 'OntologyClass' };
}

test('clearing the narrowing chip leaves focus on the chip', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  const chip = picker(page).locator('.filter-chip > button').first();
  const clear = picker(page).locator('.filter-chip > .clear');

  for (const press of [(segment: Locator) => segment.press('Enter'), (segment: Locator) => segment.click()]) {
    await chip.click();
    await picker(page).getByRole('checkbox', { name: /^NCIT/ }).check();
    await picker(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(chip).toHaveAccessibleName('NCIT ontology');
    await clear.focus();
    await press(clear);
    await expect(clear).toHaveCount(0);
    await expect(chip).toHaveAccessibleName('Ontologies');
    expect(await focused(chip)).toBe(true);
  }
});

test('removing a constraint leaves focus on the nearest remove button, then on what follows the table', async ({
  page,
}) => {
  await openConstraints(page, { constraints: [ontology('DOID'), ontology('NCIT'), ontology('MELO')], actions: [] });
  const remove = (number: number) =>
    picker(page).getByRole('button', { name: `Remove constraint ${number}`, exact: true });

  // The last row goes, so focus moves to the row above it.
  await remove(3).press('Enter');
  await expect(remove(3)).toHaveCount(0);
  expect(await focused(remove(2))).toBe(true);

  // A row with one below it is taken by that row, and focus stays on its button.
  await remove(1).focus();
  await page.keyboard.press('Enter');
  await expect(remove(2)).toHaveCount(0);
  await expect(picker(page).locator('.constraint-table tbody tr')).toContainText(['NCIT']);
  expect(await focused(remove(1))).toBe(true);

  // The only row goes, so focus moves on to the search box, the first control after the table.
  await remove(1).press('Enter');
  await expect(picker(page).locator('.constraint-empty')).toBeVisible();
  expect(await focused(picker(page).locator('.search input'))).toBe(true);
});

test('removing the only constraint with saved actions moves focus to the actions', async ({ page }) => {
  await openConstraints(page, { constraints: [ontology('NCIT')], actions: [action('a')] });
  await picker(page).getByRole('button', { name: 'Remove constraint 1', exact: true }).press('Enter');
  await expect(picker(page).locator('.constraint-empty')).toBeVisible();
  expect(await focused(picker(page).locator('.saved-actions summary'))).toBe(true);
});

test('removing a saved action leaves focus on the nearest action, then on the last constraint', async ({ page }) => {
  await openConstraints(page, {
    constraints: [ontology('DOID'), ontology('NCIT')],
    actions: [action('a'), action('b')],
  });
  await picker(page).locator('.saved-actions summary').click();
  const remove = (number: number) => picker(page).getByRole('button', { name: `Remove action ${number}`, exact: true });

  await remove(2).press('Enter');
  await expect(remove(2)).toHaveCount(0);
  expect(await focused(remove(1))).toBe(true);

  // The last action takes its list with it, and the control above the list is the last
  // constraint's remove button.
  await remove(1).press('Enter');
  await expect(picker(page).locator('.saved-actions')).toHaveCount(0);
  expect(await focused(picker(page).getByRole('button', { name: 'Remove constraint 2', exact: true }))).toBe(true);
});

test('Enter on a row’s release count opens the history, as a click does, and leaves the row unmarked', async ({
  page,
}) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await picker(page).locator('.tab').nth(2).click();
  const rows = picker(page).locator('.row.pick');
  await expect(rows).toHaveCount(2);

  for (const [index, press] of [
    [0, (count: Locator) => count.click()],
    [1, (count: Locator) => count.press('Enter')],
  ] as const) {
    const row = rows.nth(index);
    const count = row.locator('button.of');
    await press(count);
    await expect(count).toHaveAttribute('aria-expanded', 'true');
    await expect(picker(page).locator('.history')).toHaveCount(1);
    await expect(row).not.toHaveClass(/marked/);
    await expect(row.locator('.opens')).toHaveAttribute('aria-expanded', 'false');
    await expect(picker(page).locator('.selection-detail')).toHaveCount(0);
    // Safari does not focus a button on a pointer click. Keyboard activation must retain focus.
    if (index === 1) expect(await focused(count)).toBe(true);
  }

  // Enter on the row's name still marks it.
  await rows.first().locator('.opens').press('Enter');
  await expect(rows.first()).toHaveClass(/marked/);
  await expect(picker(page).locator('.selection-detail')).toHaveCount(1);
});

test('each result is a list item whose name is a button, reached by Tab and ringed on its row', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=constraint');
  await picker(page).locator('.picker').waitFor();
  const chosen: unknown[] = [];
  await page.exposeFunction('recordChoice', (constraint: unknown) => chosen.push(constraint));
  await picker(page).evaluate((element) =>
    element.addEventListener('selected', (event) =>
      (window as unknown as { recordChoice: (c: unknown) => void }).recordChoice((event as CustomEvent).detail),
    ),
  );
  await search(page, 'melanoma');
  await picker(page).locator('.tab').nth(2).click();

  // The list holds the results, one item each, and each item holds its row's two buttons.
  const items = picker(page).getByRole('tabpanel').getByRole('list').first().getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(picker(page).getByRole('option')).toHaveCount(0);
  const name = (index: number) => items.nth(index).getByRole('button').first();
  const count = (index: number) => items.nth(index).getByRole('button', { name: /^of \d/ });
  await expect(name(0)).toHaveAccessibleName(/^Melanoma Ontology ?MELO$/);
  await expect(name(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(count(0)).toHaveAccessibleName('of 2 releases of MELO');
  const rows = picker(page).locator('.row.pick');
  const ring = (index: number) => rows.nth(index).evaluate((row) => getComputedStyle(row).outlineStyle);

  // Each row's name is its Tab stop, then its release count. The ring is drawn on the row, only
  // while the name has focus.
  await picker(page).locator('.tab').nth(2).focus();
  await page.keyboard.press(tabKey(page, 'Tab'));
  expect(await focused(name(0))).toBe(true);
  expect(await ring(0)).toBe('solid');
  await expect(name(0)).toHaveCSS('outline-style', 'none');
  await page.keyboard.press(tabKey(page, 'Tab'));
  expect(await focused(count(0))).toBe(true);
  expect(await ring(0)).toBe('none');
  await page.keyboard.press(tabKey(page, 'Tab'));
  expect(await focused(name(1))).toBe(true);
  expect(await ring(1)).toBe('solid');

  // Space opens the row's detail, as Enter does, and either closes it again. The row stays the
  // selection, which its button states after its name.
  await page.keyboard.press('Space');
  await expect(name(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(rows.nth(1)).toHaveClass(/marked/);
  await expect(name(1)).toHaveAccessibleDescription('Selected ontology');
  await expect(items.nth(1).locator('.selection-detail')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(name(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(name(1)).toHaveAccessibleDescription('Selected ontology');
  await expect(picker(page).locator('.selection-detail')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(name(1)).toHaveAttribute('aria-expanded', 'true');
  expect(chosen).toHaveLength(0);

  // A click anywhere on a row opens it and moves focus to its name, so the next key acts on it.
  await rows.first().locator(':scope > .meta.inline').click();
  await expect(name(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(name(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(name(1)).toHaveAccessibleDescription('');
  expect(await focused(name(0))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(name(0)).toHaveAttribute('aria-expanded', 'false');

  // A double click anywhere on a row chooses it.
  await rows.nth(1).locator('.version').dblclick();
  expect(chosen).toHaveLength(1);
  expect((chosen[0] as { sourceAcronym: string }).sourceAcronym).toBe('NCIT');
});

test("choosing a property's release, or reading more of its children, keeps focus in the detail", async ({ page }) => {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  const parent = {
    iri: 'urn:related',
    kind: 'object',
    label: 'related to',
    obsolete: false,
    parents: [],
    literals: [],
  };
  const property = { iri: 'urn:part', kind: 'object', label: 'part of', obsolete: false, parents: ['urn:related'] };
  const children = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      iri: `urn:kid${from + index}`,
      kind: 'object',
      label: `kid ${from + index}`,
      obsolete: false,
      parents: ['urn:part'],
      hasChildren: false,
    }));
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          (route.request().postDataJSON().offset ?? 0) > 0
            ? []
            : [{ sourceAcronym: 'RO', versionId: 'ro-v2', property: { ...property, literals: [], hasChildren: true } }],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) =>
    route.fulfill({
      json: [
        { id: 'ro-v2', declaredVersion: '2', propertiesAvailable: true },
        { id: 'ro-v1', declaredVersion: '1', propertiesAvailable: true },
      ],
    }),
  );
  // Fifty children, the most one read returns, then three more and no further.
  await page.route('**/properties/hierarchy?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const offset = Number(query.get('offset') ?? 0);
    return route.fulfill({
      json: {
        selected: { sourceAcronym: 'RO', versionId: query.get('versionId'), property: { ...property, literals: [] } },
        ancestors: [parent],
        children: children(offset, offset ? 3 : 50),
        offset,
      },
    });
  });
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await picker(page).evaluate((element) => Object.assign(element, { termTypes: ['property'] }));
  await search(page, 'part');
  await picker(page)
    .getByRole('button', { name: /part of.*in 1 ontology/ })
    .click();
  await picker(page).locator('.child').first().locator('.opens').click();
  const detail = picker(page).locator('cetp-property-detail');
  await expect(detail.locator('.tree')).toBeVisible();

  // The release list closes on a choice and takes the chosen button with it; focus goes back to
  // the toggle that opened it.
  const toggle = detail.locator('.release-toggle');
  await toggle.press('Enter');
  await detail.getByRole('button', { name: '1 ro-v1', exact: true }).press('Enter');
  await expect(detail.getByRole('group')).toHaveCount(0);
  expect(await focused(toggle)).toBe(true);

  // The last read of children takes "More children" away; focus goes to the first child it added.
  await detail.getByRole('button', { name: 'More children', exact: true }).press('Enter');
  await expect(detail.getByRole('button', { name: 'More children', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'kid 52', exact: true })).toBeVisible();
  expect(await focused(detail.getByRole('button', { name: 'kid 50', exact: true }))).toBe(true);
});

test('the result tabs take one Tab stop, the arrow keys move focus along them, and Enter or Space shows one', async ({
  page,
}) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  const tab = (name: string) => picker(page).getByRole('tab', { name: new RegExp(`^${name}`) });
  const panel = picker(page).getByRole('tabpanel');
  const names = ['Terms', 'Branches', 'Ontologies', 'Value sets', 'Properties'];

  // The shown tab is the only one in the Tab order, and the result list is its panel.
  const stops = async () => Promise.all(names.map(async (name) => (await tab(name).getAttribute('tabindex')) === '0'));
  expect(await stops()).toEqual([true, false, false, false, false]);
  await expect(panel).toHaveAccessibleName(/^Terms/);
  await expect(tab('Terms')).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);

  // An arrow key moves focus and shows nothing, wrapping at either end.
  await tab('Terms').focus();
  await page.keyboard.press('ArrowRight');
  expect(await focused(tab('Branches'))).toBe(true);
  await expect(tab('Terms')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(tab('Properties'))).toBe(true);
  await page.keyboard.press('Home');
  expect(await focused(tab('Terms'))).toBe(true);
  await page.keyboard.press('End');
  expect(await focused(tab('Properties'))).toBe(true);
  await expect(panel).toHaveAccessibleName(/^Terms/);

  // Enter shows the focused tab, which becomes the Tab stop, and Space does the same.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(tab('Ontologies')).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toHaveAccessibleName(/^Ontologies/);
  expect(await stops()).toEqual([false, false, true, false, false]);
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(tab('Terms')).toHaveAttribute('aria-selected', 'true');

  // Tab leaves the strip from any tab, rather than stepping through the others.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(tabKey(page, 'Tab'));
  const onTab = await picker(page).evaluate((element) => element.shadowRoot?.activeElement?.getAttribute('role'));
  expect(onTab).not.toBe('tab');
});
