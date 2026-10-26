import { expect, test } from '@playwright/test';
import { openPicker, stubSearch, results, classHit, source, search, useHostFontsBuild } from './support';

/*
 * The host-fonts build on a host that registers the CEDAR faces is held to the default build's
 * baselines. The two differ only in who registers the same faces, so they must not differ by a pixel.
 */
const cases = [1280, 375].flatMap((width) => [false, true].map((hostFonts) => ({ width, hostFonts })));

for (const { width, hostFonts } of cases) {
  const variant = hostFonts ? ' from the host-fonts build' : '';
  test(`CEE visual contract and readable search at ${width}px${variant}`, async ({ page }, testInfo) => {
    if (hostFonts) {
      await useHostFontsBuild(page, { hostFaces: true });
    }
    await page.setViewportSize({ width, height: 900 });
    await stubSearch(page, () => ({
      sources: [source('TEST')],
      results: { class: results([classHit('TEST', 'Example term')]) },
    }));
    await openPicker(page);
    const picker = page.locator('cedar-embeddable-term-picker');
    const surface = picker.locator('.picker');
    await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(surface).toHaveCSS('background-image', 'none');
    await expect(surface).toHaveCSS('border-radius', '0px');
    await expect(surface).toHaveCSS('box-shadow', 'none');
    const input = picker.locator('.search input');
    await expect(input).toHaveCSS('min-height', '36px');
    await expect(input).toHaveCSS('border-radius', '4px');
    await expect(input).toHaveCSS('font-size', '14px');
    await expect(picker.locator('.label').first()).toHaveCSS('text-transform', 'none');
    await search(page, 'example');
    await expect(picker.getByText('Example term', { exact: true }).first()).toBeVisible();
    const box = await picker.boundingBox();
    for (const tab of await picker.locator('.tab').all()) {
      const tabBox = await tab.boundingBox();
      expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(box!.x + box!.width);
    }
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (process.env.CETP_VISUAL) {
      await expect(picker).toHaveScreenshot(`picker-${width}.png`, {
        animations: 'disabled', maxDiffPixels: 0, threshold: 0.02,
      });
    }
    await testInfo.attach('picker appearance', { body: await picker.screenshot(), contentType: 'image/png' });
  });
}
