import { Page, expect, test } from '@playwright/test';
import { branchHit, classHit, ontologyHit, pageOf, results, source, stubSearch } from './support';

/**
 * What the picker says to someone who cannot see the list change.
 *
 * One live region says every outcome of a search, once, and without moving focus. These record
 * every change to it while an author works, so a second announcement, a stray one, or one said on
 * every keystroke shows up as an entry the test did not expect.
 */

const ANSWER = {
  sources: [
    source('NCIT', { name: 'National Cancer Institute Thesaurus' }),
    source('GONE', { served: 'unavailable', reason: 'sourceUnknown' }),
  ],
  results: {
    class: results([classHit('NCIT', 'Melanoma')], { totalCount: 1, distinctLabelCount: 1 }),
    branch: results([branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321)], { distinctLabelCount: 1 }),
    ontology: results([ontologyHit('NCIT', 950, false)]),
    valueSet: results([]),
  },
};

const UNSEARCHED =
  'GONE was not searched — sourceUnknown. Its terms are absent from these results rather than missing from the vocabulary.';

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');
const region = (page: Page) => picker(page).locator('.picker > [role=status]');
const field = (page: Page) => picker(page).locator('.search input[type=search]');

/** Opens a picker with an empty search box, so nothing has been said yet. */
async function openEmpty(page: Page): Promise<void> {
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await field(page).fill('');
  await expect(region(page)).toHaveText('');
}

/** Records every text the live region takes from now on. */
async function listen(page: Page): Promise<void> {
  await region(page).evaluate((element) => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    new MutationObserver(() => {
      const text = element.textContent?.trim() ?? '';
      if (text !== '') said.push(text);
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });
}

const said = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said);

/** Whether focus is still in the search box, inside the picker's shadow root. */
const focusInSearch = (page: Page) =>
  picker(page).evaluate((element) => element.shadowRoot?.activeElement?.matches('.search input') ?? false);

test('typing a query says that a search started and what it found, once, after the debounce', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await openEmpty(page);
  await listen(page);

  await field(page).pressSequentially('melanoma', { delay: 40 });
  const found = `Results: Terms 1, Branches 1, Ontologies 1, Value sets 0, Properties 0. ${UNSEARCHED}`;
  await expect(region(page)).toHaveText(found);
  // Long enough for anything a keystroke or a page fetched to fill the list would have said.
  await page.waitForTimeout(1200);
  expect(await said(page)).toEqual(['searching…', found]);
  expect(await focusInSearch(page)).toBe(true);

  // The notice and the searching line say the same things on screen, and neither is live, so the
  // region above is the only voice.
  const live = picker(page).locator('[role=status], [role=alert], [aria-live]');
  await expect(live).toHaveCount(1);
  await expect(picker(page).locator('.notice')).toHaveText(UNSEARCHED);
});

test('a tab with nothing in it says so with the counts', async ({ page }) => {
  await stubSearch(page, () => ({ ...ANSWER, sources: ANSWER.sources.slice(0, 1), results: { class: results([]) } }));
  await openEmpty(page);
  await listen(page);
  await field(page).fill('melanomaa');
  await expect(picker(page).locator('.results .empty')).toHaveText('No terms match.');
  await expect(region(page)).toHaveText('Results: Terms 0, Properties 0. No terms match.');
  expect(await said(page)).toEqual(['searching…', 'Results: Terms 0, Properties 0. No terms match.']);
});

test('a search that failed says why, as the notice does', async ({ page }) => {
  await page.route('**/search', (route) =>
    route.request().url().includes('/properties/')
      ? route.fulfill({ json: { total: 0, page: 1, pageSize: 25, items: [] } })
      : route.fulfill({ status: 503, json: { message: 'the index is being rebuilt' } }),
  );
  await openEmpty(page);
  await listen(page);
  await field(page).fill('melanoma');
  await expect(picker(page).locator('.notice')).toHaveText('the index is being rebuilt');
  await expect(region(page)).toHaveText('the index is being rebuilt');
  expect(await said(page)).toEqual(['searching…', 'the index is being rebuilt']);
  expect(await focusInSearch(page)).toBe(true);
});

test('a query too short to search the corpus says so once the author stops, and only then', async ({ page }) => {
  const recorded = await stubSearch(page, () => ANSWER);
  await openEmpty(page);
  await listen(page);
  await field(page).pressSequentially('me', { delay: 40 });
  const tooShort =
    'A corpus-wide search needs at least 3 characters. Narrow to an ontology to search it with fewer.';
  await expect(region(page)).toHaveText(tooShort);
  expect(await said(page)).toEqual([tooShort]);
  expect(recorded.bodies.filter((body) => (body as { query: string }).query === 'me')).toEqual([]);

  // Clearing the box says nothing, and switching language clears what was said rather than
  // saying it again.
  await field(page).fill('');
  await expect(picker(page).locator('.notice')).toHaveCount(0);
  await field(page).pressSequentially('me', { delay: 40 });
  await expect(region(page)).toHaveText(tooShort);
  await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(region(page)).toHaveText('');
  expect(await said(page)).toEqual([tooShort, tooShort]);
});

test('scrolling for more says the list is reading, then that it has ended', async ({ page }) => {
  const first = Array.from({ length: 25 }, (_, index) => classHit('NCIT', `Melanoma ${index + 1}`));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/search', async (route) => {
    if (route.request().url().includes('/properties/')) {
      await route.fulfill({ json: { total: 0, page: 1, pageSize: 25, items: [] } });
      return;
    }
    const body = route.request().postDataJSON();
    const page = pageOf(body);
    if (page === 2) await held;
    const collection = page === 1 ? first : page === 2 ? [classHit('NCIT', 'Melanoma 26')] : [];
    await route.fulfill({
      json: {
        query: body.query,
        sources: [source('NCIT')],
        results: { class: results(collection, { totalCount: 26, distinctLabelCount: 26, page }) },
      },
    });
  });
  await openEmpty(page);
  await field(page).fill('melanoma');
  await expect(region(page)).toHaveText('Results: Terms 26, Properties 0.');
  await listen(page);

  const list = picker(page).locator('.results');
  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(region(page)).toHaveText('reading more…');
  await expect(picker(page).locator('.tail')).toHaveText('reading more…');
  release();
  await expect(picker(page).locator('.tail')).toHaveText('no more matches');
  await expect(region(page)).toHaveText('no more matches');
  expect(await said(page)).toEqual(['reading more…', 'no more matches']);
});
