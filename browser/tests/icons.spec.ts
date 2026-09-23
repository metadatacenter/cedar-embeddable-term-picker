import { expect, test } from '@playwright/test';
import { openPicker, stubSearch, results, classHit, source, search } from './support';

test('picker controls use decorative SVGs and leave readable space for result labels', async ({ page }) => {
  await stubSearch(page, () => ({
    sources: [source('TEST')],
    results: { class: results([classHit('TEST', 'Example')]) },
  }));
  await openPicker(page);
  await search(page, 'example');
  const picker = page.locator('cedar-embeddable-term-picker');
  await expect(picker.getByRole('button', { name: 'Close without choosing' }).locator('svg')).toHaveAttribute(
    'data-cedar-icon',
    'close',
  );
  const icons = picker.locator('cetp-icon svg');
  expect(await icons.count()).toBeGreaterThan(1);
  for (const icon of await icons.all()) {
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    await expect(icon).toHaveAttribute('stroke-width', '2');
    await expect(icon).toHaveAttribute('stroke', 'currentColor');
    const box = await icon.boundingBox();
    if (box) {
      expect([16, 20, 24]).toContain(box.width);
      expect(box.height).toBe(box.width);
    }
  }
});


test('keyboard focus uses shared geometry and preserves the host color', async ({ page }) => {
  await openPicker(page);
  const picker = page.locator('cedar-embeddable-term-picker');
  await picker.evaluate(element => (element as HTMLElement).style.setProperty('--cetp-color-primary', '#663399'));
  const close = picker.getByRole('button', { name: 'Close without choosing' });
  await page.keyboard.press('Tab');
  await close.focus();
  await expect(close).toHaveCSS('outline-width', '2px');
  await expect(close).toHaveCSS('outline-offset', '2px');
  await expect(close).toHaveCSS('outline-color', 'rgb(102, 51, 153)');
});
