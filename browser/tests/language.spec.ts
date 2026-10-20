import { Locator, expect, test } from '@playwright/test';
import { classHit, openPicker, results, search, source, stubHierarchy, stubSearch } from './support';

/**
 * The language a host chooses, through the element's attribute and its property.
 *
 * The unit tests set the input on a component; these set it the way a host page does, on the
 * custom element, which is where an attribute has to be mapped to the input at all.
 */

/** Whether the browser reads an element as being in a language, which is what `lang` decides. */
async function inLanguage(locator: Locator, language: string): Promise<boolean> {
  return locator.evaluate((element, wanted) => element.matches(`:lang(${wanted})`), language);
}

test('the language attribute and property both switch the picker, at once', async ({ page }) => {
  await openPicker(page);
  const picker = page.locator('cedar-embeddable-term-picker');
  await expect(picker.locator('.search .label')).toHaveText('Find terms');

  await picker.evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(picker.locator('.search .label')).toHaveText('Fogalmak keresése');
  await expect(picker.locator('.dismiss')).toHaveAttribute('aria-label', 'Bezárás választás nélkül');

  await picker.evaluate((element) => ((element as HTMLElement & { language: string }).language = 'en'));
  await expect(picker.locator('.search .label')).toHaveText('Find terms');
  await expect(picker.locator('.dismiss')).toHaveAttribute('aria-label', 'Close without choosing');
});

test('two pickers on one page keep their own languages', async ({ page }) => {
  await openPicker(page);
  await page.evaluate(() => {
    document.querySelector('cedar-embeddable-term-picker')!.remove();
    for (const [id, language] of [
      ['a', 'en'],
      ['b', 'hu'],
    ]) {
      const picker = document.createElement('cedar-embeddable-term-picker');
      picker.id = id;
      picker.setAttribute('language', language);
      picker.setAttribute('selection-mode', 'constraint');
      document.body.append(picker);
    }
  });
  await expect(page.locator('#a .search .label')).toHaveText('Find terms');
  await expect(page.locator('#b .search .label')).toHaveText('Fogalmak keresése');
  expect(await inLanguage(page.locator('#a .search .label'), 'en')).toBe(true);
  expect(await inLanguage(page.locator('#b .search .label'), 'hu')).toBe(true);
});

test('a Hungarian picker inside an English page is read as Hungarian', async ({ page }) => {
  await openPicker(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const picker = page.locator('cedar-embeddable-term-picker');
  // The element declares the language it speaks, so its shadow tree inherits that and not the page's.
  await expect(picker).toHaveAttribute('lang', 'en');

  await picker.evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(picker).toHaveAttribute('lang', 'hu');
  await expect(picker.locator('.search .label')).toHaveText('Fogalmak keresése');
  for (const part of [picker.locator('.search .label'), picker.locator('.search input'), picker.locator('.dismiss')]) {
    expect(await inLanguage(part, 'hu')).toBe(true);
  }

  // A language the picker does not speak falls back to English, and so does the declaration.
  await picker.evaluate((element) => element.setAttribute('language', 'fr'));
  await expect(picker).toHaveAttribute('lang', 'en');
});

test('a name the source tagged with a language is read in that language', async ({ page }) => {
  await stubSearch(page, () => ({
    sources: [source('NCIT', { name: 'National Cancer Institute Thesaurus' }), source('OCHV')],
    results: {
      class: results([
        classHit('NCIT', 'Melanoma', {
          matched: { label: 'Melanom', language: 'de' },
          names: [{ label: 'Cutaneous melanoma' }, { label: 'mélanome', language: 'fr' }],
        }),
        classHit('OCHV', '6188', { matched: { label: 'HIV-Krankheit', language: 'de' } }),
      ]),
    },
  }));
  await stubHierarchy(page, () => null);
  await openPicker(page);
  await search(page, 'melanoma');
  const picker = page.locator('cedar-embeddable-term-picker');

  // A matched name inside the row's phrase: the phrase stays the picker's, the name is German.
  const attached = picker.locator('.rowhead', { hasText: 'Melanoma' }).locator('.chip.attached');
  await expect(attached).toHaveText('matched Melanom · de');
  expect(await inLanguage(attached, 'en')).toBe(true);
  await expect(attached.locator('[lang]')).toHaveText('Melanom');
  expect(await inLanguage(attached.locator('[lang]'), 'de')).toBe(true);

  // A row whose label is a code is titled with the matched name, and so in that name's language.
  const coded = picker.locator('.rowhead', { hasText: '6188' }).locator('.title');
  await expect(coded).toHaveText('HIV-Krankheit');
  await expect(coded).toHaveAttribute('lang', 'de');

  // The marked row's panel lists the names; each tagged one carries its tag, an untagged one none.
  await picker.locator('.rowhead', { hasText: 'Melanoma' }).click();
  await picker.locator('.child').first().click();
  const detail = picker.locator('.detail');
  await expect(detail.locator('.chip')).toHaveText(['Melanom · de']);
  expect(await inLanguage(detail.locator('.chip [lang]'), 'de')).toBe(true);
  await expect(detail.locator('.alias')).toHaveText(['Cutaneous melanoma', 'mélanome · fr']);
  await expect(detail.locator('.alias').first().locator('[lang]')).toHaveCount(0);
  await expect(detail.locator('.alias').nth(1).locator('[lang]')).toHaveAttribute('lang', 'fr');

  // Switching the picker's language leaves each name in its own.
  await picker.evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(attached).toHaveText('egyezés: Melanom · de');
  expect(await inLanguage(attached, 'hu')).toBe(true);
  expect(await inLanguage(attached.locator('[lang]'), 'de')).toBe(true);
  expect(await inLanguage(detail.locator('.alias').nth(1).locator('[lang]'), 'fr')).toBe(true);
});

test('a property description is read in the language its literal carries', async ({ page }) => {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  const property = { iri: 'urn:part', kind: 'object', label: 'part of', obsolete: false, parents: [] };
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
                  property: { ...property, literals: [], hasChildren: false },
                },
              ],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/properties/hierarchy?*', (route) =>
    route.fulfill({
      json: {
        selected: {
          sourceAcronym: 'RO',
          versionId: 'ro-v1',
          property: {
            ...property,
            literals: [
              {
                predicate: 'http://www.w3.org/2000/01/rdf-schema#comment',
                lang: 'fr',
                value: 'une relation de partie',
              },
            ],
          },
        },
        ancestors: [],
        children: [],
        offset: 0,
      },
    }),
  );
  await page.goto('/');
  await page.locator('cedar-embeddable-term-picker .picker').waitFor();
  const picker = page.locator('cedar-embeddable-term-picker');
  await picker.evaluate((node) => ((node as HTMLElement & { termTypes: string[] }).termTypes = ['property']));
  await picker.locator('input[type=search]').fill('part');
  await picker.getByRole('button', { name: /part of.*in 1 ontology/ }).click();
  await picker.getByRole('option', { name: 'part of in RO' }).click();
  const description = picker.locator('cetp-property-detail .description');
  await expect(description).toHaveText('une relation de partie (fr)');
  await expect(description.locator('[lang]')).toHaveText('une relation de partie');
  expect(await inLanguage(description.locator('[lang]'), 'fr')).toBe(true);
  expect(await inLanguage(description, 'en')).toBe(true);
});
