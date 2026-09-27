import { expect, test } from '@playwright/test';
import { openPicker } from './support';

/**
 * The language a host chooses, through the element's attribute and its property.
 *
 * The unit tests set the input on a component; these set it the way a host page does, on the
 * custom element, which is where an attribute has to be mapped to the input at all.
 */

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
});
