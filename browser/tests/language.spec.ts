import { Locator, Page, expect, test } from '@playwright/test';
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

/**
 * Text the terminology server wrote. Its sentences and its reasons are English whatever the picker
 * speaks, so a Hungarian picker marks each as English, and the phrase around one stays Hungarian.
 */

const region = (page: Page) => page.locator('cedar-embeddable-term-picker .picker > [role=status]');

/** Opens a Hungarian picker in a mode, with its stubs already in place. */
async function openHungarian(page: Page, mode = 'constraint'): Promise<Locator> {
  await page.goto(`/?mode=${mode}`);
  const picker = page.locator('cedar-embeddable-term-picker');
  await picker.locator('.picker').waitFor();
  await picker.evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(picker).toHaveAttribute('lang', 'hu');
  return picker;
}

test("a server's refusal is read in English, and the picker's own failure in its language", async ({ page }) => {
  let reachable = true;
  await page.route('**/search', (route) =>
    reachable
      ? route.fulfill({ status: 400, json: { message: 'A source needs a sourceAcronym.' } })
      : route.abort('failed'),
  );
  const picker = await openHungarian(page);
  await picker.locator('input[type=search]').fill('melanoma');
  const notice = picker.locator('.notice');
  await expect(notice).toHaveText('A source needs a sourceAcronym.');
  await expect(notice).toHaveAttribute('lang', 'en');
  // Said as it is shown: the live region carries the sentence with its language.
  await expect(region(page)).toHaveText('A source needs a sourceAcronym.');
  expect(await inLanguage(region(page).locator('span'), 'en')).toBe(true);

  // A failure the picker words itself is in the picker's language and carries no tag of its own.
  reachable = false;
  await picker.locator('input[type=search]').fill('melanomas');
  await expect(notice).toHaveText(
    'A terminológiai kiszolgáló nem érhető el. Ellenőrizze a kapcsolatot, és próbálja újra.',
  );
  await expect(notice).not.toHaveAttribute('lang');
  expect(await inLanguage(notice, 'hu')).toBe(true);
  await expect(region(page).locator('[lang]')).toHaveCount(0);
});

test("the reason a source was not searched is English inside the picker's sentence", async ({ page }) => {
  await stubSearch(page, () => ({
    sources: [source('NCIT'), source('GONE', { served: 'unavailable', reason: 'sourceUnknown' })],
    results: { class: results([classHit('NCIT', 'Melanoma')], { distinctLabelCount: 1 }) },
  }));
  const picker = await openHungarian(page);
  await search(page, 'melanoma');
  const notice = picker.locator('.notice');
  await expect(notice).toHaveText(
    'GONE: a keresés nem terjedt ki erre a forrásra — sourceUnknown. A fogalmai ezért hiányoznak a találatok közül, ' +
      'nem azért, mert a szótárban nem szerepelnek.',
  );
  expect(await inLanguage(notice, 'hu')).toBe(true);
  await expect(notice.locator('[lang]')).toHaveText(['sourceUnknown']);
  expect(await inLanguage(notice.locator('[lang]'), 'en')).toBe(true);

  // The announcement says the same, and is read whole when any part of it changes.
  await expect(region(page)).toContainText('sourceUnknown. A fogalmai');
  await expect(region(page).locator('[lang]')).toHaveText(['sourceUnknown']);
  expect(await inLanguage(region(page).locator('[lang]'), 'en')).toBe(true);
  await expect(region(page)).toHaveAttribute('aria-atomic', 'true');
});

test("why a term's tree is missing is read in the store's English", async ({ page }) => {
  const refusals: Readonly<Record<string, { status: number; message: string }>> = {
    NCIT: { status: 404, message: 'The store holds no term http://ncit/Melanoma in NCIT.' },
    DOID: { status: 500, message: 'the index is being rebuilt' },
    MELO: { status: 502, message: '' },
  };
  await stubSearch(page, () => ({
    sources: [source('NCIT'), source('DOID'), source('MELO')],
    results: {
      class: results([classHit('NCIT', 'Melanoma'), classHit('DOID', 'Melanoma'), classHit('MELO', 'Melanoma')], {
        distinctLabelCount: 1,
      }),
    },
  }));
  await stubHierarchy(page, (query) => refusals[query.get('sourceAcronym')!]);
  const picker = await openHungarian(page, 'constraints');
  await search(page, 'melanoma');
  await picker.locator('.rowhead').first().click();
  const why = picker.locator('.hierarchy-choice .meta.inline');

  // An answer from the store is its own sentence, all of it English.
  await picker.locator('.child', { hasText: 'NCIT' }).click();
  await expect(why).toHaveText('The store holds no term http://ncit/Melanoma in NCIT.');
  await expect(why.locator('[lang]')).toHaveText(['The store holds no term http://ncit/Melanoma in NCIT.']);
  expect(await inLanguage(why.locator('[lang]'), 'en')).toBe(true);

  // A failure is the picker's phrase, quoting the server's English.
  await picker.locator('.child', { hasText: 'DOID' }).click();
  await expect(why).toHaveText('a hierarchia nem olvasható be: the index is being rebuilt');
  expect(await inLanguage(why, 'hu')).toBe(true);
  await expect(why.locator('[lang]')).toHaveText(['the index is being rebuilt']);
  expect(await inLanguage(why.locator('[lang]'), 'en')).toBe(true);

  // A failure the server did not explain is the picker's phrase alone.
  await picker.locator('.child', { hasText: 'MELO' }).click();
  await expect(why).toHaveText('a hierarchia nem olvasható be: A terminológiai szerver 502 állapotkóddal válaszolt.');
  await expect(why.locator('[lang]')).toHaveCount(0);
});

test('a release that lacks the term says why in English', async ({ page }) => {
  await stubSearch(page, (body) =>
    body.includeVersions
      ? {
          sources: [
            source('NCIT', {
              versionCount: 2,
              declaredVersion: '26.07d',
              versions: [
                { id: 'hash-new', declaredVersion: '26.07d' },
                { id: 'hash-old', declaredVersion: '26.06e' },
              ],
            }),
          ],
          results: { ontology: results([]) },
        }
      : {
          sources: [source('NCIT', { versionCount: 2, declaredVersion: '26.07d' })],
          results: { class: results([classHit('NCIT', 'Melanoma')], { distinctLabelCount: 1 }) },
        },
  );
  await stubHierarchy(page, (query) =>
    query.get('versionId') === 'hash-old'
      ? { status: 404, message: 'Release hash-old of NCIT does not contain http://ncit/Melanoma.' }
      : { sourceAcronym: 'NCIT', termIri: query.get('termIri'), termLabel: 'Melanoma', childCount: 0 },
  );
  const picker = await openHungarian(page);
  await search(page, 'melanoma');
  await picker.locator('.rowhead').first().click();
  const row = picker.locator('.child', { hasText: 'NCIT' });
  await row.click();
  await row.locator('button.of').click();
  await picker.locator('.history button.release').nth(1).click();
  const blocked = picker.locator('.chosen .blocked');
  await expect(blocked).toHaveText('Release hash-old of NCIT does not contain http://ncit/Melanoma.');
  await expect(blocked).toHaveAttribute('lang', 'en');
});

test("a property search's or a property's failure is read in the server's English", async ({ page }) => {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  await page.route('**/properties/search', (route) =>
    route.fulfill({ status: 503, json: { message: 'The local terminology store is not configured.' } }),
  );
  const picker = await openHungarian(page, 'constraints');
  await picker.evaluate((element) => Object.assign(element, { termTypes: ['class', 'property'] }));
  await search(page, 'part');
  await picker.locator('.tab').nth(1).click();
  const alert = picker.locator('.results [role=alert]');
  await expect(alert).toHaveText('The local terminology store is not configured.');
  await expect(alert).toHaveAttribute('lang', 'en');

  // A property whose hierarchy the server refuses.
  await page.unroute('**/properties/search');
  const property = { iri: 'urn:part', kind: 'object', label: 'part of', obsolete: false, parents: [], literals: [] };
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          (route.request().postDataJSON().offset ?? 0) > 0
            ? []
            : [{ sourceAcronym: 'RO', versionId: 'ro-v1', property: { ...property, hasChildren: false } }],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/properties/hierarchy?*', (route) =>
    route.fulfill({ status: 404, json: { message: 'No property urn:part in RO at ro-v1.' } }),
  );
  await picker.locator('input[type=search]').fill('part of');
  await picker
    .getByRole('button', { name: /part of/ })
    .first()
    .click();
  await picker.getByRole('option', { name: /^part of/ }).click();
  const failure = picker.locator('cetp-property-detail [role=alert]');
  await expect(failure).toHaveText('No property urn:part in RO at ro-v1.');
  await expect(failure).toHaveAttribute('lang', 'en');
});

test("a saved action's keyword is read in English, as the model writes it", async ({ page }) => {
  const picker = await openHungarian(page, 'constraints');
  await picker.evaluate((node) =>
    Object.assign(node, {
      constraintSet: {
        constraints: [{ sourceType: 'ontology', ontologyId: 'DOID', uri: 'urn:doid' }],
        actions: [{ action: 'delete', termUri: 'urn:doid#1', sourceUri: 'urn:doid', type: 'OntologyClass' }],
      },
    }),
  );
  await picker.locator('.saved-actions summary').click();
  const action = picker.locator('.saved-actions p');
  await expect(action).toHaveText(/^delete · urn:doid#1/);
  await expect(action.locator('[lang]')).toHaveText(['delete']);
  expect(await inLanguage(action.locator('[lang]'), 'en')).toBe(true);
  expect(await inLanguage(action, 'hu')).toBe(true);
});
