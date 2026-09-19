import { expect, test } from '@playwright/test';
import { openPicker } from './support';

test('terminology inputs disable spelling inside a spellchecked host', async ({ page }) => {
  await openPicker(page);
  await page.locator('body').evaluate((body) => body.setAttribute('spellcheck', 'true'));
  const controls = page.locator('cedar-embeddable-term-picker').locator('input, textarea');
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    await expect(control).toHaveAttribute('spellcheck', 'false');
    await expect(control).toHaveJSProperty('spellcheck', false);
  }
});
