import AxeBuilder from '@axe-core/playwright';
import type { NodeResult } from 'axe-core';
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

/**
 * WCAG 2.1's Label in Name, criterion 2.5.3: a control's accessible name contains the text it shows,
 * so that speech input reaches it by its visible label. axe-core's rule for it is experimental, and
 * a tag selection leaves experimental rules out, so it runs by name.
 */
const LABEL_IN_NAME = 'label-content-name-mismatch';

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
  const { violations: tagged, incomplete } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const { violations: named } = await new AxeBuilder({ page }).withRules([LABEL_IN_NAME]).analyze();
  const violations = [...tagged, ...named];
  // A label on an element whose role takes none is ignored by screen readers, decided or not.
  const ignoredLabels = incomplete.filter((result) => result.id === 'aria-prohibited-attr');
  const failures: string[] = [];
  for (const violation of [...violations, ...ignoredLabels])
    for (const node of violation.nodes)
      if (!(await pending(page, violation.id, node.target)))
        failures.push(`${violation.id}: ${JSON.stringify(node.target)}`);
  expect(failures, state).toEqual([]);
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

/**
 * Two findings wait on a design decision, recorded on the versioning roadmap, and are the only
 * exceptions. A result row is an `option` outside any listbox, carries `aria-expanded`, which an
 * option does not take, and holds buttons of its own; giving the list proper semantics changes how
 * the keyboard moves through it. A release-history button is smaller than WCAG 2.2's 24px target,
 * and growing it changes the row's layout. Anything else that fails these rules fails the test.
 *
 * Each exception names its elements by a selector they match. The selector axe-core reports is
 * built from whatever attribute is rarest on the page, so it changes when an unrelated attribute
 * does, and matching its text would excuse other elements or stop excusing these.
 */
const PENDING: readonly { readonly rule: string; readonly selector: string }[] = [
  { rule: 'aria-allowed-attr', selector: '.pick' },
  { rule: 'aria-required-parent', selector: '.pick' },
  { rule: 'nested-interactive', selector: '.pick' },
  { rule: 'target-size', selector: 'button.of' },
];

/** Whether the element an axe-core finding points at is one of the exceptions for its rule. */
async function pending(page: Page, rule: string, target: NodeResult['target']): Promise<boolean> {
  const selectors = PENDING.filter((entry) => entry.rule === rule).map((entry) => entry.selector);
  return selectors.length > 0 && (await page.evaluate(matchesAt, { target, selectors }));
}

/**
 * Whether the element at an axe-core target matches one of the selectors. A target lists one entry
 * a frame; an entry is a selector, or a path of selectors that crosses shadow roots.
 */
function matchesAt({ target, selectors }: { target: NodeResult['target']; selectors: readonly string[] }): boolean {
  const path = target.at(-1);
  let scope: ParentNode = document;
  let element: Element | null = null;
  for (const step of typeof path === 'string' ? [path] : (path ?? [])) {
    element = scope.querySelector(step);
    if (element === null) return false;
    scope = element.shadowRoot ?? element;
  }
  return element !== null && selectors.some((selector) => element.matches(selector));
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

test('a control that shows a value is named by that value, then by what it is for', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await stubHierarchy(page, () => null);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  const chip = picker(page).locator('.filter-chip > button').first();
  await expect(chip).toHaveAccessibleName('Ontologies');

  // Narrowed, the chip shows the acronyms, and speech input reaches it by them.
  await chip.click();
  await picker(page).getByRole('checkbox', { name: /^NCIT/ }).check();
  await picker(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(chip.locator('.value')).toHaveText('NCIT');
  await expect(chip).toHaveAccessibleName('NCIT ontology');
  await chip.click();
  await picker(page).getByRole('checkbox', { name: /^MELO/ }).check();
  await picker(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(chip.locator('.value')).toHaveText('NCIT, MELO');
  await expect(chip).toHaveAccessibleName('NCIT, MELO ontologies');
  // The title repeats the acronyms for a pointer and is not read a second time.
  await expect(chip).toHaveAttribute('title', 'NCIT, MELO');
  await expect(chip).toHaveAccessibleDescription('');
  await expectAccessible(page, 'narrowed chip');

  // A row's release count is named by the count it shows, then by whose releases they are.
  await picker(page).locator('.rowhead').first().click();
  const counts = picker(page).locator('button.of');
  const shown = (buttons: Element[]) => buttons.map((button) => button.firstChild?.textContent?.trim());
  await expect(counts).toHaveCount(2);
  expect(await counts.evaluateAll(shown)).toEqual(['of 3', 'of 15']);
  await expect(counts.first()).toHaveAccessibleName('of 3 releases of NCIT');
  await expect(counts.nth(1)).toHaveAccessibleName('of 15 releases of DOID');
  await expect(counts.first()).toHaveAttribute('title', 'Show all 3 releases of NCIT');
  await expect(counts.first()).toHaveAccessibleDescription('');
  await expectAccessible(page, 'release counts');

  // The same in Hungarian, where the count reads "/ 3".
  await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(chip).toHaveAccessibleName('NCIT, MELO ontológiák');
  await expect(counts.first()).toHaveAccessibleName('/ 3 kiadás (NCIT)');
  expect(await counts.evaluateAll(shown)).toEqual(['/ 3', '/ 15']);
  await expectAccessible(page, 'release counts in Hungarian');
});
