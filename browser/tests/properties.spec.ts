import { test, expect } from '@playwright/test';
import { stubSearch, results } from './support';

test('property-only table enforces the maximum and browses parents at the selected ontology version', async ({
  page,
}) => {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  const parent = {
    iri: 'urn:related',
    kind: 'object',
    label: 'related to',
    obsolete: false,
    parents: [],
    literals: [],
  };
  const child = {
    iri: 'urn:part',
    kind: 'object',
    label: 'part of',
    obsolete: false,
    parents: ['urn:related'],
    literals: [],
  };
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          route.request().postDataJSON().page > 1
            ? []
            : [
                {
                  sourceAcronym: 'RO',
                  versionId: 'ro-v2',
                  property: { ...child, hasChildren: false },
                },
              ],
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
  const seen: string[] = [];
  await page.route('**/properties/hierarchy?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    seen.push(query.get('versionId')!);
    const isParent = query.get('propertyIri') === parent.iri;
    return route.fulfill({
      json: {
        selected: { sourceAcronym: 'RO', versionId: query.get('versionId'), property: isParent ? parent : child },
        ancestors: isParent ? [] : [parent],
        children: isParent ? [{ ...child, hasChildren: false }] : [],
        offset: 0,
      },
    });
  });
  await page.goto('/');
  await page.locator('cedar-embeddable-term-picker .picker').waitFor();
  await page.locator('cedar-embeddable-term-picker').evaluate((node) => {
    const picker = node as HTMLElement & { termTypes: string[]; maximumTerms: number };
    picker.termTypes = ['property'];
    picker.maximumTerms = 1;
    picker.addEventListener('constraintsSelected', (event) => {
      (window as unknown as { saved: unknown }).saved = (event as CustomEvent).detail;
    });
  });
  const picker = page.locator('cedar-embeddable-term-picker');
  await expect(picker.getByRole('tab')).toHaveCount(1);
  await picker.locator('input[type=search]').fill('part');
  await picker.getByRole('button', { name: /part of.*in 1 ontology/ }).click();
  await picker.getByRole('option', { name: 'part of in RO' }).click();
  await expect(picker.getByRole('button', { name: 'related to', exact: true })).toBeVisible();
  const details = picker.locator('cetp-property-detail');
  const detailBox = (await details.boundingBox())!;
  const sourceBox = (await picker.getByRole('option', { name: 'part of in RO' }).boundingBox())!;
  expect(Math.abs(detailBox.width - sourceBox.width)).toBeLessThan(2);
  const releaseBox = (await details.locator('.release-toolbar').boundingBox())!;
  const treeBox = (await details.locator('.tree').boundingBox())!;
  expect(Math.abs(releaseBox.x - treeBox.x)).toBeLessThan(2);
  await expect(picker.locator('.selection-release')).toContainText('pinned');
  expect((await picker.locator('.selection-release').innerText()).trim()).not.toMatch(/^·/);
  await picker.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(picker.locator('.constraint-table tbody tr')).toHaveCount(1);
  await picker.getByRole('button', { name: 'related to', exact: true }).click();
  await picker.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('Remove an entry');
  await picker.getByRole('button', { name: 'Remove constraint 1', exact: true }).click();
  await picker.getByRole('button', { name: 'Property ontology releases', exact: true }).click();
  await picker.getByRole('button', { name: '1 ro-v1', exact: true }).click();
  await picker.getByRole('button', { name: 'Select', exact: true }).click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { saved: unknown }).saved)).toMatchObject({
    constraints: [{ sourceType: 'ontology-property', sourceId: 'urn:related', version: { id: 'ro-v1' } }],
  });
  expect(seen).toContain('ro-v1');
  await page.screenshot({ path: '/tmp/cetp-property-table.png', fullPage: true });
});
