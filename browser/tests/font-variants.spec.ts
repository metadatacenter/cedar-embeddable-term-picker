import { expect, test } from '@playwright/test';
import { classHit, openPicker, results, search, source, stubSearch, useHostFontsBuild } from './support';

/**
 * The two builds a host can load, told apart by the faces the document holds.
 *
 * The default build registers CEDAR Roboto 400 and 500 itself, in seven subsets each. The
 * host-fonts build registers none. On a page that registers none either, the document holds no
 * CEDAR face, and on a page that registers the token package's faces it holds exactly those. Had
 * the default build been served instead, the second page would hold every face twice.
 */
const variants = [
  { title: 'the default build registers the CEDAR faces itself', hostFonts: false, hostFaces: false, perWeight: 7 },
  { title: 'the host-fonts build registers no face of its own', hostFonts: true, hostFaces: false, perWeight: 0 },
  {
    title: 'the host-fonts build renders with the faces its host registers',
    hostFonts: true,
    hostFaces: true,
    perWeight: 7,
  },
];

for (const { title, hostFonts, hostFaces, perWeight } of variants) {
  test(title, async ({ page }) => {
    if (hostFonts) {
      await useHostFontsBuild(page, { hostFaces });
    }
    await stubSearch(page, () => ({
      sources: [source('TEST')],
      results: { class: results([classHit('TEST', 'Example term')]) },
    }));
    await openPicker(page);
    expect(await page.evaluate(() => customElements.get('cedar-embeddable-term-picker') !== undefined)).toBe(true);

    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const weights = await page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.family.replace(/['"]/g, '') === 'CEDAR Roboto')
        .map((face) => face.weight),
    );
    expect(weights.filter((weight) => weight === '400')).toHaveLength(perWeight);
    expect(weights.filter((weight) => weight === '500')).toHaveLength(perWeight);
    expect(weights).toHaveLength(2 * perWeight);

    await search(page, 'example');
    await expect(
      page.locator('cedar-embeddable-term-picker').getByText('Example term', { exact: true }).first(),
    ).toBeVisible();
  });
}
