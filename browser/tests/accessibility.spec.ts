import AxeBuilder from '@axe-core/playwright';
import type { NodeResult } from 'axe-core';
import { Locator, Page, expect, test } from '@playwright/test';
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

/**
 * Automated WCAG checks over the picker's states.
 *
 * A rule engine decides names, roles, ARIA validity, the contrast it can compute and target
 * sizes. It cannot decide focus order or what a screen reader announces. The tags are the
 * designer's: WCAG 2.0, 2.1 and 2.2 at levels A and AA.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * WCAG 2.1's Label in Name, criterion 2.5.3: a control's accessible name contains the text it shows,
 * so that speech input reaches it by its visible label. axe-core's rule for it is experimental, and
 * a tag selection leaves experimental rules out, so it runs by name.
 */
const LABEL_IN_NAME = 'label-content-name-mismatch';

const ANSWER = {
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
        classHit('DOID', 'melanoma', { descendantCount: 31, definition: 'A cell type cancer.' }),
      ],
      { totalCount: 2, distinctLabelCount: 1 },
    ),
    branch: results([branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321)], {
      totalCount: 1,
      distinctLabelCount: 1,
    }),
    ontology: results([ontologyHit('MELO', 38, true), ontologyHit('NCIT', 950, false)]),
    valueSet: results([]),
  },
};

/**
 * Check the whole page once its animations finish, so contrast is read at full opacity.
 *
 * A violation fails unless it is pending. axe-core leaves some contrast and target-size checks
 * undecided, and an undecided result fails too, unless it is pending or settled below by
 * measurement. Each settled result is measured again here, so a settlement cannot outlive the
 * colours it was made for.
 */
async function expectAccessible(page: Page, state: string): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const roots: DocumentOrShadowRoot[] = [document];
    for (const element of document.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
    await Promise.all(
      roots
        .flatMap((root) => root.getAnimations())
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const { violations: tagged, incomplete } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const { violations: named } = await new AxeBuilder({ page }).withRules([LABEL_IN_NAME]).analyze();
  const violations = [...tagged, ...named];
  // A label on an element whose role takes none is ignored by screen readers, decided or not.
  const ignoredLabels = incomplete.filter((result) => result.id === 'aria-prohibited-attr');
  const failures: string[] = [];
  for (const violation of [...violations, ...ignoredLabels])
    for (const node of violation.nodes)
      if (!(await pending(page, violation.id, node.target)))
        failures.push(`${violation.id}: ${JSON.stringify(node.target)}`);
  for (const result of incomplete.filter((result) => UNDECIDED.includes(result.id)))
    for (const node of result.nodes) {
      if (await pending(page, result.id, node.target)) continue;
      const settlement = await settled(page, result.id, node.target);
      if (settlement === undefined) {
        const why = [...node.any, ...node.all, ...node.none].map((check) => check.message).join(' ');
        failures.push(`undecided ${result.id}: ${JSON.stringify(node.target)} (${why})`);
        continue;
      }
      const contrast = await measuredContrast(page, node.target);
      if (contrast.ratio < MINIMUM_CONTRAST || Math.abs(contrast.ratio - settlement.measured.ratio) > 0.1)
        failures.push(
          `settled ${result.id}: ${settlement.selector} now measures ${contrast.ratio.toFixed(2)}:1, ` +
            `${contrast.text} on ${contrast.background}, where ${settlement.measured.ratio}:1 was recorded`,
        );
    }
  expect(failures, state).toEqual([]);
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

/**
 * Findings that wait on a design decision. Two are recorded on the versioning roadmap. A result row
 * is an `option` outside any listbox, carries `aria-expanded`, which an option does not take, and
 * holds buttons of its own; giving the list proper semantics changes how the keyboard moves through
 * it. A release-history button is smaller than WCAG 2.2's 24px target, and growing it changes the
 * row's layout. The tree's targets are a third, found when the tree was first checked, and growing
 * them changes the tree's layout in the same way. Anything else that fails these rules fails the
 * test.
 *
 * Each exception names its elements by a selector they match. The selector axe-core reports is
 * built from whatever attribute is rarest on the page, so it changes when an unrelated attribute
 * does, and matching its text would excuse other elements or stop excusing these.
 */
const PENDING: readonly { readonly rule: string; readonly selector: string }[] = [
  { rule: 'aria-allowed-attr', selector: '.pick' },
  { rule: 'aria-required-parent', selector: '.pick' },
  { rule: 'nested-interactive', selector: '.pick' },
  { rule: 'target-size', selector: 'button.of' },
  // The releases an open history lists are 22px tall with 2px between them, short of 24px. They
  // belong to the same release-history decision: growing them lengthens the panel.
  { rule: 'target-size', selector: '.history button.release' },
  // A tree's twists are 16px square and its terms 14px tall, one row every 16px, so neither meets
  // 24px and their 24px circles overlap. Meeting it means taller tree rows, which changes the
  // tree's layout and so waits on the design too.
  { rule: 'target-size', selector: '.tree button.twist' },
  { rule: 'target-size', selector: '.tree button.term' },
];

/** The rules whose undecided results are settled here rather than discarded. */
const UNDECIDED = ['color-contrast', 'target-size'];

/** WCAG 2.2's 1.4.3 minimum for text below the large size, which every settled text is. */
const MINIMUM_CONTRAST = 4.5;

/**
 * Undecided results settled by measuring the screen, each with what was measured and why it passes.
 *
 * Only the narrow layout produces them. There a few columns run out of room: text overflows its
 * box or is cut at an edge, and axe-core then cannot tell what is painted behind it. The
 * measurement does not need to: it hides the text, reads the commonest colour left where the text
 * was, and compares the text's own colour with it.
 */
const SETTLED: readonly Settled[] = [
  {
    rule: 'color-contrast',
    selector: '.releases-head .grow',
    measured: { ratio: 6.87, text: '#555555', background: '#f4f6f6' },
    why:
      "At 375px the history head's first column has no width, and its count wraps out of it over " +
      "the column beside it. The pixels behind the text are the panel's surface.",
  },
  {
    rule: 'color-contrast',
    selector: '.row.pick:not(.marked) > .meta.inline',
    measured: { ratio: 7.46, text: '#555555', background: '#ffffff' },
    why:
      'At 375px an ontology row takes two lines, and some of the points axe-core samples in the ' +
      "count's box fall outside its text and on the row. Nothing else is drawn there: the pixels " +
      "behind the count are the row's white.",
  },
  {
    rule: 'color-contrast',
    selector: '.history button.release .tag',
    measured: { ratio: 6.87, text: '#555555', background: '#f4f6f6' },
    why:
      'At 375px in Hungarian a release is wider than the history and its tag is cut at the edge, ' +
      "which axe-core reads as an overlap. The pixels behind what is drawn are the release's surface.",
  },
];

interface Settled {
  readonly rule: 'color-contrast';
  readonly selector: string;
  readonly measured: { readonly ratio: number; readonly text: string; readonly background: string };
  readonly why: string;
}

/** Whether the element an axe-core finding points at is one of the exceptions for its rule. */
async function pending(page: Page, rule: string, target: NodeResult['target']): Promise<boolean> {
  const selectors = PENDING.filter((entry) => entry.rule === rule).map((entry) => entry.selector);
  return selectors.length > 0 && (await page.evaluate(matchesAt, { target, selectors }));
}

/** The settlement for an undecided result, if its element is one the list covers. */
async function settled(page: Page, rule: string, target: NodeResult['target']): Promise<Settled | undefined> {
  for (const entry of SETTLED.filter((entry) => entry.rule === rule))
    if (await page.evaluate(matchesAt, { target, selectors: [entry.selector] })) return entry;
  return undefined;
}

/**
 * Whether the element at an axe-core target matches one of the selectors. A target lists one entry
 * a frame; an entry is a selector, or a path of selectors that crosses shadow roots.
 */
function matchesAt({ target, selectors }: { target: NodeResult['target']; selectors: readonly string[] }): boolean {
  const path = target.at(-1);
  let scope: ParentNode = document;
  let element: Element | null = null;
  for (const step of typeof path === 'string' ? [path] : (path ?? [])) {
    element = scope.querySelector(step);
    if (element === null) return false;
    scope = element.shadowRoot ?? element;
  }
  return element !== null && selectors.some((selector) => element.matches(selector));
}

/**
 * The contrast of an element's text with what is painted behind it, read from the screen.
 *
 * The text's colour is its computed one. The background is the commonest colour in a screenshot of
 * the area its text covers, taken with that text made transparent, so whatever paints there is
 * measured without deciding which element it belongs to. Each function sent to the page finds the
 * element again, as `matchesAt` does, since such a function takes nothing with it.
 */
async function measuredContrast(
  page: Page,
  target: NodeResult['target'],
): Promise<{ ratio: number; text: string; background: string }> {
  const area = await page.evaluate((target) => {
    const path = target.at(-1);
    let scope: ParentNode = document;
    let element: HTMLElement | null = null;
    for (const step of typeof path === 'string' ? [path] : (path ?? [])) {
      element = scope.querySelector<HTMLElement>(step);
      if (element === null) throw new Error(`nothing at ${JSON.stringify(target)}`);
      scope = element.shadowRoot ?? element;
    }
    element!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const range = document.createRange();
    range.selectNodeContents(element!);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const left = Math.floor(Math.max(0, Math.min(...rects.map((rect) => rect.left))));
    const top = Math.floor(Math.max(0, Math.min(...rects.map((rect) => rect.top))));
    const right = Math.ceil(Math.min(innerWidth, Math.max(...rects.map((rect) => rect.right))));
    const bottom = Math.ceil(Math.min(innerHeight, Math.max(...rects.map((rect) => rect.bottom))));
    const color = getComputedStyle(element!).color;
    element!.style.setProperty('color', 'transparent', 'important');
    element!.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    return { clip: { x: left, y: top, width: right - left, height: bottom - top }, color };
  }, target);
  const shot = await page.screenshot({ clip: area.clip, animations: 'disabled', caret: 'hide' });
  const background = await page.evaluate(
    async ({ target, png }) => {
      const path = target.at(-1);
      let scope: ParentNode = document;
      let element: HTMLElement | null = null;
      for (const step of typeof path === 'string' ? [path] : (path ?? [])) {
        element = scope.querySelector<HTMLElement>(step);
        scope = element!.shadowRoot ?? element!;
      }
      element!.style.removeProperty('color');
      element!.style.removeProperty('-webkit-text-fill-color');
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const counts = new Map<number, number>();
      for (let index = 0; index < pixels.length; index += 4) {
        const key = (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const commonest = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      return [(commonest >> 16) & 255, (commonest >> 8) & 255, commonest & 255];
    },
    { target, png: shot.toString('base64') },
  );
  const [r, g, b, alpha = 1] = area.color.match(/[\d.]+/g)!.map(Number);
  const text = [r, g, b].map((channel, index) => channel * alpha + background[index] * (1 - alpha));
  const ratio = contrastOf(text, background);
  return { ratio: Math.round(ratio * 100) / 100, text: hex(text), background: hex(background) };
}

function contrastOf(one: readonly number[], other: readonly number[]): number {
  const luminance = (rgb: readonly number[]) => {
    const [r, g, b] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

test('the picker opened, and each tab of an answer', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await openPicker(page);
  await expectAccessible(page, 'opened');
  await search(page, 'melanoma');
  const tabs = picker(page).locator('.tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    await tabs.nth(index).click();
    await expectAccessible(page, `tab ${index + 1}`);
  }
});

for (const [mode, width] of [
  ['constraint', 1280],
  ['constraints', 375],
] as const) {
  test(`a marked row, an opened row and an opened fold, ${mode} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubSearch(page, () => ANSWER);
    await stubHierarchy(page, () => null);
    await page.goto(`/?mode=${mode}`);
    await picker(page).locator('.picker').waitFor();
    await search(page, 'melanoma');
    await picker(page).locator('.rowhead').first().click();
    await expect(picker(page).locator('.child').first()).toHaveClass(/marked/);
    await expectAccessible(page, 'opened fold');
    await picker(page).locator('.tab').nth(2).click();
    const rows = picker(page).locator('.row.pick');
    await rows.first().click();
    await expect(rows.first()).toHaveClass(/marked/);
    await expectAccessible(page, 'marked row');
    await rows.first().press('Enter');
    await expectAccessible(page, 'opened row');
  });
}

test('the narrowing panel', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  const chip = picker(page).locator('.filter-chip > button').first();
  // The chip controls the panel only while there is one.
  await expect(chip).not.toHaveAttribute('aria-controls');
  await chip.click();
  await expect(picker(page).locator('.filter-popover')).toBeVisible();
  await expect(chip).toHaveAttribute('aria-controls', 'narrowing-panel');
  await expectAccessible(page, 'narrowing panel');
});

test('a constraint set in its tables', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
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
  await search(page, 'melanoma');
  await expectAccessible(page, 'constraint set');
});

test('a control that shows a value is named by that value, then by what it is for', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await stubHierarchy(page, () => null);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  const chip = picker(page).locator('.filter-chip > button').first();
  await expect(chip).toHaveAccessibleName('Ontologies');

  // Narrowed, the chip shows the acronyms, and speech input reaches it by them.
  await chip.click();
  await picker(page).getByRole('checkbox', { name: /^NCIT/ }).check();
  await picker(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(chip.locator('.value')).toHaveText('NCIT');
  await expect(chip).toHaveAccessibleName('NCIT ontology');
  await chip.click();
  await picker(page).getByRole('checkbox', { name: /^MELO/ }).check();
  await picker(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(chip.locator('.value')).toHaveText('NCIT, MELO');
  await expect(chip).toHaveAccessibleName('NCIT, MELO ontologies');
  // The title repeats the acronyms for a pointer and is not read a second time.
  await expect(chip).toHaveAttribute('title', 'NCIT, MELO');
  await expect(chip).toHaveAccessibleDescription('');
  await expectAccessible(page, 'narrowed chip');

  // A row's release count is named by the count it shows, then by whose releases they are.
  await picker(page).locator('.rowhead').first().click();
  const counts = picker(page).locator('button.of');
  const shown = (buttons: Element[]) => buttons.map((button) => button.firstChild?.textContent?.trim());
  await expect(counts).toHaveCount(2);
  expect(await counts.evaluateAll(shown)).toEqual(['of 3', 'of 15']);
  await expect(counts.first()).toHaveAccessibleName('of 3 releases of NCIT');
  await expect(counts.nth(1)).toHaveAccessibleName('of 15 releases of DOID');
  await expect(counts.first()).toHaveAttribute('title', 'Show all 3 releases of NCIT');
  await expect(counts.first()).toHaveAccessibleDescription('');
  await expectAccessible(page, 'release counts');

  // The same in Hungarian, where the count reads "/ 3".
  await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
  await expect(chip).toHaveAccessibleName('NCIT, MELO ontológiák');
  await expect(counts.first()).toHaveAccessibleName('/ 3 kiadás (NCIT)');
  expect(await counts.evaluateAll(shown)).toEqual(['/ 3', '/ 15']);
  await expectAccessible(page, 'release counts in Hungarian');
});

const VERSIONS = [
  { id: 'hash-c-0123456789abcdef', effectiveDate: '2026-07-01T00:00:00.000-07:00', declaredVersion: '26.07d' },
  { id: 'hash-b-0123456789abcdef', effectiveDate: '2026-06-03T00:00:00.000-07:00', declaredVersion: '26.06e' },
  { id: 'hash-a-0123456789abcdef', effectiveDate: '2026-05-06T00:00:00.000-07:00' },
];

/**
 * Answers the search, NCIT's release history and a hierarchy with an ancestor and two children,
 * so a marked term draws a tree with twists, terms and a release to pin.
 */
async function stubTree(page: Page): Promise<void> {
  await stubSearch(page, (body) =>
    body.includeVersions
      ? {
          sources: [
            source('NCIT', {
              name: 'National Cancer Institute Thesaurus',
              versionCount: 3,
              declaredVersion: '26.07d',
              versions: VERSIONS,
            }),
          ],
          results: { ontology: results([]) },
        }
      : ANSWER,
  );
  await stubHierarchy(page, (query) => ({
    sourceAcronym: query.get('sourceAcronym'),
    termIri: query.get('termIri'),
    termLabel: 'Melanoma',
    path: [{ termIri: 'http://ncit/Neoplasm', termLabel: 'Melanocytic Neoplasm' }],
    children: [
      { termIri: 'http://ncit/Acral', termLabel: 'Acral Melanoma', hasChildren: true, descendantCount: 3 },
      { termIri: 'http://ncit/Nodular', termLabel: 'Nodular Melanoma', hasChildren: false, descendantCount: 0 },
    ],
    childCount: 2,
    descendantCount: 321,
  }));
}

/** Marks the first term of the first fold, which draws its tree. */
async function markTree(page: Page): Promise<void> {
  await picker(page).locator('.rowhead').first().click();
  await picker(page).locator('.child').first().click();
  await expect(picker(page).locator('.tree button.twist')).toHaveCount(3);
}

async function openWithTree(page: Page): Promise<void> {
  await stubTree(page);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await markTree(page);
}

for (const width of [1280, 375]) {
  test(`a marked term's tree, an opened node, the release history and a pinned release at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openWithTree(page);
    await expectAccessible(page, 'tree');
    await picker(page).locator('.tree button.twist').first().click();
    await expect(picker(page).locator('.tree button.twist').first()).toHaveAttribute('aria-expanded', 'true');
    await expectAccessible(page, 'opened node');
    await picker(page).locator('.child').first().locator('button.of').click();
    await expect(picker(page).locator('.history button.release')).toHaveCount(3);
    await expectAccessible(page, 'release history');
    await picker(page).locator('.history button.release').nth(1).click();
    await expect(picker(page).locator('.child').first().locator('.version')).toHaveText('26.06e');
    await expectAccessible(page, 'pinned release');
    await picker(page).evaluate((element) => element.setAttribute('language', 'hu'));
    await expectAccessible(page, 'pinned release in Hungarian');
  });
}

/**
 * Hovers a control and checks the page, then focuses it from the keyboard and checks again, so a
 * hover colour and a focus ring are each read as drawn.
 */
async function hoveredAndFocused(page: Page, kind: string, control: Locator): Promise<void> {
  await control.hover();
  await expectAccessible(page, `${kind}, hovered`);
  // A key pressed first makes the browser treat the focus as the keyboard's, and draw its ring.
  await page.mouse.move(0, 0);
  await page.keyboard.press('Shift');
  await control.focus();
  expect(await control.evaluate((element) => element.matches(':focus-visible')), kind).toBe(true);
  await expectAccessible(page, `${kind}, focused`);
}

test('each kind of button, a tab, a row and the search box, hovered and focused', async ({ page }) => {
  await stubTree(page);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  // Narrowed first, so the chip shows its clear segment, and the narrowed answer is waited for:
  // it replaces the rows, and a tree opened before it arrived would go with them.
  await picker(page).locator('.filter-chip > button').first().click();
  await picker(page).getByRole('checkbox', { name: /^NCIT/ }).check();
  const narrowed = page.waitForResponse(
    (response) => response.url().endsWith('/search') && (response.request().postDataJSON()?.sources ?? []).length > 0,
  );
  await picker(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await narrowed;
  await expect(picker(page).locator('.working')).toHaveClass(/idle/);
  await markTree(page);
  await picker(page).locator('.child').first().locator('button.of').click();
  await expect(picker(page).locator('.history button.release')).toHaveCount(3);
  const controls: Readonly<Record<string, string>> = {
    'the primary button': '.actions .primary',
    'a secondary button': '.actions button:not(.primary)',
    'the narrowing chip': '.filter-chip > button',
    "the chip's clear segment": '.filter-chip > .clear',
    'a group head': '.rowhead',
    "a row's release count": 'button.of',
    'a release in the history': '.history button.release',
    "a tree's twist": '.tree button.twist',
    "a tree's term": '.tree button.term',
    'the select button': '.hierarchy-choice .use',
    'a tab': '.tab:not(.active)',
    'a row': '.child.pick',
    'the search box': '.search input',
  };
  for (const [kind, selector] of Object.entries(controls))
    await hoveredAndFocused(page, kind, picker(page).locator(selector).first());
});

test("the narrowing panel's finder, a checkbox and its buttons, hovered and focused", async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await search(page, 'melanoma');
  await picker(page).locator('.filter-chip > button').first().click();
  await expect(picker(page).locator('.candidate input')).toHaveCount(2);
  for (const [kind, selector] of Object.entries({
    "the panel's finder": '.finder input',
    'a checkbox': '.candidate input',
    "the panel's apply button": '.filter-popover .primary',
    "the panel's other buttons": '.filter-popover footer button:not(.primary)',
  }))
    await hoveredAndFocused(page, kind, picker(page).locator(selector).first());
});

test('the vocabulary and release selector, hovered and focused', async ({ page }) => {
  await stubSearch(page, () => ANSWER);
  await page.goto('/?mode=term');
  await picker(page).locator('.picker').waitFor();
  await picker(page).evaluate((element) =>
    Object.assign(element, {
      sources: [{ sourceAcronym: 'NCIT' }, { sourceAcronym: 'DOID', version: { id: 'hash' } }],
    }),
  );
  await expect(picker(page).locator('.scope-selector select')).toBeVisible();
  await search(page, 'melanoma');
  await expectAccessible(page, 'selector');
  await hoveredAndFocused(page, 'the selector', picker(page).locator('.scope-selector select'));
});

test("a property's detail, its releases and their controls, hovered and focused", async ({ page }) => {
  await stubSearch(page, () => ({ sources: [], results: { class: results([]) } }));
  const parent = {
    iri: 'urn:related',
    kind: 'object',
    label: 'related to',
    obsolete: false,
    parents: [],
    literals: [],
  };
  const property = {
    iri: 'urn:part',
    kind: 'object',
    label: 'part of',
    obsolete: false,
    parents: ['urn:related'],
    literals: [
      { predicate: 'http://www.w3.org/2000/01/rdf-schema#comment', lang: 'fr', value: 'une relation de partie' },
    ],
  };
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          (route.request().postDataJSON().offset ?? 0) > 0
            ? []
            : [{ sourceAcronym: 'RO', versionId: 'ro-v2', property: { ...property, hasChildren: false } }],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) =>
    route.fulfill({
      json: [
        { id: 'ro-v2', declaredVersion: '2', propertiesAvailable: true },
        { id: 'ro-v1', declaredVersion: '1', propertiesAvailable: true },
      ],
    }),
  );
  await page.route('**/properties/hierarchy?*', (route) =>
    route.fulfill({
      json: {
        selected: { sourceAcronym: 'RO', versionId: 'ro-v2', property },
        ancestors: [parent],
        children: [
          {
            iri: 'urn:sub',
            kind: 'object',
            label: 'sub part',
            obsolete: false,
            parents: ['urn:part'],
            hasChildren: true,
          },
        ],
        offset: 0,
      },
    }),
  );
  await page.goto('/?mode=constraints');
  await picker(page).locator('.picker').waitFor();
  await picker(page).evaluate((element) => Object.assign(element, { termTypes: ['property'] }));
  await picker(page).locator('input[type=search]').fill('part');
  await picker(page)
    .getByRole('button', { name: /part of.*in 1 ontology/ })
    .click();
  const row = picker(page).getByRole('option', { name: 'part of in RO, object property', exact: true });
  await row.click();
  await expect(picker(page).locator('cetp-property-detail .tree')).toBeVisible();
  await expectAccessible(page, 'property detail');
  await picker(page).locator('.release-toggle').click();
  await expect(picker(page).getByRole('group', { name: 'Property ontology releases' })).toBeVisible();
  await expectAccessible(page, 'property releases');
  for (const [kind, selector] of Object.entries({
    "the property's release toggle": '.release-toggle',
    'a property release': 'cetp-property-detail button.release',
    "a property's parent": 'cetp-property-detail button.term',
    "the property's select button": 'cetp-property-detail .use',
  }))
    await hoveredAndFocused(page, kind, picker(page).locator(selector).first());
});
