import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { surfaceCases, checkSurface } from './surface-contracts.generated.mjs';
import { branchHit, classHit, ontologyHit, openPicker, results, search, source, stubHierarchy, stubSearch } from './support';

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
          definition: 'A cell type cancer that has_material_basis_in abnormally proliferating cells derived from melanocytes.',
        }),
      ],
      { totalCount: 5439, distinctLabelCount: 2552 },
    ),
    branch: results([branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321), branchHit('DOID', 'melanoma', 'skin cancer', 31)]),
    ontology: results([ontologyHit('MELO', 12, true), ontologyHit('NCIT', 950, false)]),
  },
};

async function searched(page: Page): Promise<void> {
  await stubSearch(page, () => MELANOMA);
  await openPicker(page);
  await search(page, 'melanoma');
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

const scenarios: Record<string, (page: Page) => Promise<void>> = {
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
