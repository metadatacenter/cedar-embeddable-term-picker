import { test, expect } from '@playwright/test';
import { openPicker, stubSearch } from './support';

for (const bad of ['bad iri', '/relative', 'urn:bad%ZZ']) {
  test(`invalid supplied identifier is visible and removable: ${bad}`, async ({ page }) => {
    await stubSearch(page, () => ({ sources: [], results: {} }));
    await openPicker(page);
    await page.locator('cedar-embeddable-term-picker').evaluate((element, value) => {
      Object.assign(element, { selectionMode: 'constraints', constraintSet: { constraints: [{ sourceType: 'ontology-term', sourceId: value }], actions: [] } });
      element.addEventListener('constraintsSelected', () => element.setAttribute('data-applied', 'true'));
    }, bad);
    const picker = page.locator('cedar-embeddable-term-picker');
    await expect(picker.getByRole('alert')).toContainText('Constraint 1');
    await picker.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(picker).not.toHaveAttribute('data-applied');
    await picker.getByRole('button', { name: 'Remove constraint 1', exact: true }).click();
    await expect(picker.getByRole('alert')).toHaveCount(0);
    await picker.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(picker).toHaveAttribute('data-applied', 'true');
  });
}

test('a rejected branch depth remains an error through Done and clears on correction', async ({ page }) => {
  await stubSearch(page, () => ({ sources: [], results: {} }));
  await openPicker(page);
  const picker = page.locator('cedar-embeddable-term-picker');
  await picker.evaluate(element => {
    Object.assign(element, { selectionMode: 'constraints', constraintSet: { constraints: [{ sourceType: 'ontology-branch', branchRootId: 'urn:branch', branchRootName: 'Branch', searchDepth: 2 }], actions: [] } });
    element.addEventListener('constraintsSelected', event => element.setAttribute('data-applied', JSON.stringify((event as CustomEvent).detail)));
  });
  await picker.locator('.constraint-table summary').click();
  const depth = picker.locator('.constraint-table input');
  await depth.fill('-1'); await depth.blur();
  await expect(picker.getByRole('alert')).toContainText('Constraint 1');
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(picker).not.toHaveAttribute('data-applied');
  await depth.fill('3'); await depth.blur();
  await expect(picker.getByRole('alert')).toHaveCount(0);
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(picker).toHaveAttribute('data-applied', /"searchDepth":3/);
});
