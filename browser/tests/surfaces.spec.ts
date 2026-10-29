import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import assert from 'node:assert/strict';
import { surfaceCases, checkSurface } from './surface-contracts.generated.mjs';
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

// The registry's surfaces, each opened from fixtures and walked against the shared scale.
const registry = JSON.parse(readFileSync(new URL('../../.ui-surfaces.json', import.meta.url), 'utf8'));

const MELANOMA = {
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
        classHit('DOID', 'melanoma', {
          descendantCount: 31,
          definition:
            'A cell type cancer that has_material_basis_in abnormally proliferating cells derived from melanocytes.',
        }),
      ],
      { totalCount: 5439, distinctLabelCount: 2552 },
    ),
    branch: results([
      branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321),
      branchHit('DOID', 'melanoma', 'skin cancer', 31),
    ]),
    ontology: results([ontologyHit('MELO', 12, true), ontologyHit('NCIT', 950, false)]),
  },
};

async function searched(page: Page): Promise<void> {
  await stubSearch(page, () => MELANOMA);
  await openPicker(page);
  await search(page, 'melanoma');
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

// Hold the second page of children so the real component stays in its disabled loading state.
// Returning the response lets the state test prove that normal appearance comes back afterwards.
async function propertyDetail(page: Page): Promise<() => Promise<void>> {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  const property = {
    iri: 'urn:related',
    kind: 'object',
    label: 'related to',
    obsolete: false,
    parents: [],
    literals: [],
  };
  const selected = { sourceAcronym: 'RO', versionId: 'ro-v2', property };
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          (route.request().postDataJSON().offset ?? 0) > 0
            ? []
            : [{ ...selected, property: { ...property, hasChildren: true } }],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) =>
    route.fulfill({ json: [{ id: 'ro-v2', declaredVersion: '2', propertiesAvailable: true }] }),
  );
  let pending: Route | undefined;
  await page.route('**/properties/hierarchy?*', (route) => {
    if (Number(new URL(route.request().url()).searchParams.get('offset')) > 0) {
      pending = route;
      return;
    }
    return route.fulfill({
      json: {
        selected,
        ancestors: [],
        offset: 0,
        children: Array.from({ length: 50 }, (_, i) => ({
          ...property,
          iri: `urn:child:${i}`,
          label: `Child ${i}`,
          hasChildren: false,
        })),
      },
    });
  });
  await openPicker(page);
  await picker(page).evaluate((node) => {
    (node as HTMLElement & { termTypes: string[] }).termTypes = ['property'];
  });
  await picker(page).locator('input[type=search]').fill('related');
  await picker(page)
    .getByRole('button', { name: /related to.*in 1 ontology/ })
    .click();
  await picker(page).getByRole('option', { name: 'related to in RO' }).click();
  await expect(picker(page).locator('cetp-property-detail .use')).toBeEnabled();
  return async () => {
    await expect.poll(() => !!pending).toBe(true);
    await pending!.fulfill({ json: { selected, ancestors: [], children: [], offset: 50 } });
  };
}

const scenarios: Record<string, (page: Page) => Promise<void>> = {
  'property-loading': async (page) => {
    await propertyDetail(page);
    await picker(page).locator('cetp-property-detail .more button').click();
    await expect(picker(page).locator('cetp-property-detail .use')).toBeDisabled();
  },
  terms: async (page) => {
    await searched(page);
    await expect(picker(page).locator('.rowhead').first()).toBeVisible();
  },
  branches: async (page) => {
    await searched(page);
    await picker(page).locator('.tab').nth(1).click();
    await expect(picker(page).locator('.rowhead').first()).toBeVisible();
  },
  ontologies: async (page) => {
    await searched(page);
    await picker(page).locator('.tab').nth(2).click();
    await expect(picker(page).locator('.row.oneline').first()).toBeVisible();
  },
  'ontology-filter': async (page) => {
    await searched(page);
    await picker(page).locator('.filter-chip > button').first().click();
    await expect(picker(page).locator('.filter-popover .candidate').first()).toBeVisible();
  },
  'term-detail': async (page) => {
    await stubHierarchy(page, (query) => ({
      sourceAcronym: query.get('sourceAcronym'),
      termIri: query.get('termIri'),
      termLabel: 'Melanoma',
      path: [{ termIri: 'http://ncit.example/parent', termLabel: 'Melanocytic Neoplasm' }],
      childCount: 0,
      descendantCount: 321,
    }));
    await searched(page);
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child').first().click();
    await expect(picker(page).locator('.tree .node').first()).toBeVisible();
  },
  'constraint-table': async (page) => {
    await stubSearch(page, () => MELANOMA);
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
    await expect(picker(page).locator('.constraint-table tbody tr').first()).toBeVisible();
  },
};

for (const { surface, state, width, title } of surfaceCases(registry, scenarios))
  test(title, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await scenarios[surface.scenario](page);
    await checkSurface(page, surface, state, expect, testInfo);
  });

for (const width of [1440, 375])
  test(`property actions recover their enabled appearance after loading / ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const finishLoading = await propertyDetail(page);
    const action = picker(page).locator('cetp-property-detail .use');
    await expect(action).toHaveCSS('opacity', '1');
    await testInfo.attach('enabled property action', {
      body: await picker(page).screenshot(),
      contentType: 'image/png',
    });
    await picker(page).locator('cetp-property-detail .more button').click();
    const surface = registry.surfaces.find((entry: { id: string }) => entry.id === 'cetp.property-loading');
    await checkSurface(page, surface, 'open', expect, testInfo);
    await testInfo.attach('disabled property action', {
      body: await picker(page).screenshot(),
      contentType: 'image/png',
    });
    // A local override must be caught even though the token itself still has the right value.
    await action.evaluate((element) => {
      element.style.opacity = '0.4';
    });
    await assert.rejects(() => checkSurface(page, surface, 'open', expect, testInfo), /opacity must use/);
    await action.evaluate((element) => {
      element.style.removeProperty('opacity');
    });
    await finishLoading();
    await expect(action).toBeEnabled();
    await expect(action).toHaveCSS('opacity', '1');
    await expect(picker(page).locator('cetp-property-detail .more')).toHaveCount(0);
  });

test('compact text contract rejects local line-height drift inside the picker shadow root', async ({
  page,
}, testInfo) => {
  await scenarios['constraint-table'](page);
  const surface = registry.surfaces.find((entry: { id: string }) => entry.id === 'cetp.constraint-cell');
  await checkSurface(page, surface, 'open', expect, testInfo);
  const cell = page.locator(surface.selector);
  await cell.evaluate((element) => {
    (element as HTMLElement).style.lineHeight = '22px';
  });
  await assert.rejects(() => checkSurface(page, surface, 'open', expect, testInfo), /line-height must use/);
});
