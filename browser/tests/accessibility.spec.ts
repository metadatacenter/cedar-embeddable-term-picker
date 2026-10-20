import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import {
  branchHit,
  classHit,
  ontologyHit,
  openPicker,
  results,
  search,
  source,
  stubHierarchy,
  stubSearch,
} from './support';

/**
 * Automated WCAG checks over the picker's states.
 *
 * A rule engine decides names, roles, ARIA validity, the contrast it can compute and target
 * sizes. It cannot decide focus order or what a screen reader announces. The tags are the
 * designer's: WCAG 2.0, 2.1 and 2.2 at levels A and AA.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const ANSWER = {
  sources: [
    source('NCIT', { name: 'National Cancer Institute Thesaurus', versionCount: 3, declaredVersion: '26.07d' }),
    source('DOID', { name: 'Human Disease Ontology', versionCount: 15, declaredVersion: '2026-06-30' }),
    source('MELO', { name: 'Melanoma Ontology' }),
    source('GONE', { served: 'unavailable', reason: 'sourceUnknown' }),
  ],
  results: {
    class: results(
      [
        classHit('NCIT', 'Melanoma', { descendantCount: 321, under: 'Melanocytic Neoplasm' }),
        classHit('DOID', 'melanoma', { descendantCount: 31, definition: 'A cell type cancer.' }),
      ],
      { totalCount: 2, distinctLabelCount: 1 },
    ),
    branch: results([branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321)], {
      totalCount: 1,
      distinctLabelCount: 1,
    }),
    ontology: results([ontologyHit('MELO', 38, true), ontologyHit('NCIT', 950, false)]),
    valueSet: results([]),
  },
};

/** Check the whole page once its animations finish, so contrast is read at full opacity. */
async function expectAccessible(page: Page, state: string): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const roots: DocumentOrShadowRoot[] = [document];
    for (const element of document.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
    await Promise.all(
      roots
        .flatMap((root) => root.getAnimations())
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  // A label on an element whose role takes none is ignored by screen readers, decided or not.
  const ignoredLabels = incomplete.filter((result) => result.id === 'aria-prohibited-attr');
  const failures = [...violations, ...ignoredLabels].flatMap((violation) =>
    violation.nodes
      .map((node) => JSON.stringify(node.target))
      .filter((target) => !pending(violation.id, target))
      .map((target) => `${violation.id}: ${target}`),
  );
  expect(failures, state).toEqual([]);
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

/**
 * Two findings wait on a design decision, recorded on the versioning roadmap, and are the only
 * exceptions. A result row is an `option` outside any listbox, carries `aria-expanded`, which an
 * option does not take, and holds buttons of its own; giving the list proper semantics changes how
 * the keyboard moves through it. A release-history button is smaller than WCAG 2.2's 24px target,
 * and growing it changes the row's layout. Anything else that fails these rules fails the test.
 */
function pending(rule: string, target: string): boolean {
  if (['aria-allowed-attr', 'aria-required-parent', 'nested-interactive'].includes(rule))
    return /\.pick|\.marked/.test(target);
  return rule === 'target-size' && target.includes('Show all');
}

test('the picker opened, and each tab of an answer', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await openPicker(page);
  await expectAccessible(page, 'opened');
  await search(page, 'melanoma');
  const tabs = picker(page).locator('.tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    await tabs.nth(index).click();
    await expectAccessible(page, `tab ${index + 1}`);
  }
});

test('a marked row, an opened row and an opened fold', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await stubHierarchy(page, () => null);
  await openPicker(page);
  await search(page, 'melanoma');
  await picker(page).locator('.rowhead').first().click();
  await expect(picker(page).locator('.child').first()).toHaveClass(/marked/);
  await expectAccessible(page, 'opened fold');
  await picker(page).locator('.tab').nth(2).click();
  const rows = picker(page).locator('.row.pick');
  await rows.first().click();
  await expect(rows.first()).toHaveClass(/marked/);
  await expectAccessible(page, 'marked row');
  await rows.first().press('Enter');
  await expectAccessible(page, 'opened row');
});

test('the narrowing panel', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await picker(page).locator('.filter-chip > button').first().click();
  await expect(picker(page).locator('.filter-popover')).toBeVisible();
  await expectAccessible(page, 'narrowing panel');
});

test('a constraint set in its tables', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await stubHierarchy(page, () => null);
  await openPicker(page);
  await picker(page).evaluate((node) => {
    const element = node as HTMLElement & { selectionMode: string; constraintSet: object };
    element.selectionMode = 'constraints';
    element.constraintSet = {
      constraints: [
        {
          sourceType: 'ontology',
          ontologyId: 'DOID',
          ontologyName: 'Disease Ontology',
          uri: 'urn:doid',
          version: { id: 'sha256:original', declaredVersion: '2026-06' },
        },
      ],
      actions: [],
    };
  });
  await search(page, 'melanoma');
  await expectAccessible(page, 'constraint set');
});
