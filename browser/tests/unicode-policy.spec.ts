import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import type * as Policy from 'cedar-model-typescript-library/policy';

const policyBundle = createRequire(import.meta.url).resolve('cedar-model-typescript-library/policy.umd.js');
for (const locale of ['en-US', 'tr-TR']) {
  test(`shared Unicode contract in ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage();
      await page.addScriptTag({ path: policyBundle });
      const result = await page.evaluate(() => {
        const { TextPolicy, IdentifierPolicy, DisplayText } = (
          window as unknown as { CedarValidationPolicy: typeof Policy }
        ).CedarValidationPolicy;
        return {
          blanks: ['\u001c', '\u001d', '\u001e', '\u001f', '\u00a0', '\u2007', '\u202f', '\ufeff'].map((x) =>
            TextPolicy.isBlank(x),
          ),
          lengths: ['😀', 'e\u0301', '👩‍💻'].map((x) => TextPolicy.codePointLength(x)),
          identifiers: [
            'urn:x\u0085',
            'urn:x\ud800',
            'urn:x\ufffe',
            'urn:x\ue000',
            'urn:x#a#b',
            'urn:café',
            'urn:x\ufeff',
          ].map((x) => IdentifierPolicy.isValid(x)),
          match: DisplayText.splitMatch('İx', 'x'),
          composed: DisplayText.splitMatch('ae\u0301x', 'É'),
          shortened: DisplayText.elide('👩‍💻'.repeat(10), 7, 2),
        };
      });
      expect(result).toEqual({
        blanks: [true, true, true, true, false, false, false, false],
        lengths: [1, 2, 3],
        identifiers: [false, false, false, false, false, true, true],
        match: ['İ', 'x', ''],
        composed: ['a', 'e\u0301', 'x'],
        shortened: '👩‍💻'.repeat(4) + '…' + '👩‍💻'.repeat(2),
      });
    } finally {
      await context.close();
    }
  });
}
