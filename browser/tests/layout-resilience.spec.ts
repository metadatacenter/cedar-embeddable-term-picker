import { Page, expect, test } from '@playwright/test';
import { branchHit, classHit, ontologyHit, results, search, source, stubHierarchy, stubSearch } from './support';

/**
 * Whether the picker's content survives a narrow host, a zoomed window and wider text.
 *
 * WCAG 2.2 asks four things of a layout. At 320 CSS px nothing may scroll sideways, no text is drawn
 * over other text and every control stays reachable (1.4.10). At 200% zoom, which for a 1280 by 800 window is a 640 by 400 viewport,
 * no text is clipped or drawn over other text and every control stays reachable (1.4.4). Text spaced
 * as 1.4.12 describes loses nothing and runs into nothing. A placeholder's text meets 4.5:1 (1.4.3).
 *
 * Each check measures the rendered page in every main state. A finding fails the test unless it is
 * listed below with the visible change it needs. A listed finding that no longer occurs fails too,
 * so the list cannot outlive what it describes.
 */

type Check = 'reflow' | 'resize' | 'spacing';
type Kind = 'page scrolls' | 'scrolls' | 'unreachable' | 'clipped' | 'ellipsis' | 'overlap';

interface Exception {
  readonly check: Check;
  readonly kind: Kind;
  /** A selector the element matches. For an overlap, either of the two texts. */
  readonly selector: string;
  /** The states it occurs in. */
  readonly states: readonly string[];
  /** What it is, and the visible change that would remove it. */
  readonly why: string;
}

/**
 * Two-dimensional data, which 1.4.10 allows to scroll inside its own box at 320 CSS px. Its rows
 * are read across as well as down, and wrapping them would take the columns apart.
 */
const SCROLLS_IN_PLACE: readonly { readonly selector: string; readonly why: string }[] = [
  {
    selector: '.constraint-set',
    why:
      'The constraint table, a table of terms with their sources and releases. At 320 CSS px it is wider ' +
      'than the picker and scrolls inside its own section.',
  },
];

/** Findings that wait on a visible change. */
const EXCEPTIONS: readonly Exception[] = [
  {
    check: 'reflow',
    kind: 'scrolls',
    selector: '.history',
    states: ['the release history'],
    why:
      'The release history sets each release in four columns, three of them 19em wide together, so at ' +
      "320 CSS px it scrolls sideways. Its head's count is left no width and runs over the column beside " +
      'it, as it does at 375px, and a long release has its tag cut. A release has three facts, and a list ' +
      'of them is not a table that needs two dimensions. Below some width each release could take two ' +
      "lines, which changes the history's layout.",
  },
  {
    check: 'reflow',
    kind: 'overlap',
    selector: '.releases-head > .grow',
    states: ['the release history'],
    why:
      "At 320 CSS px the release history's head leaves its count no width, so the count is drawn over " +
      "the column heading beside it. The two-line release that the history's sideways scrolling needs " +
      'would give the head room for its count.',
  },
  {
    check: 'resize',
    kind: 'ellipsis',
    selector: '.chosen .about',
    states: ['the terms tab', 'the branches tab', 'the release history'],
    why:
      'At 640 by 400 the selection\'s source line ends in an ellipsis, and "National Cancer Institute ' +
      'Thesaurus (NCIT)" loses its acronym. The lines beside it carry their whole text as a title, and ' +
      'this one carries none. Showing it needs a title, which adds a tooltip, or a line that wraps, which ' +
      'changes the height of the bar.',
  },
  {
    check: 'resize',
    kind: 'ellipsis',
    selector: '.row > .grow.ellipsis',
    states: ['the value sets tab'],
    why:
      "Every result row is one line. At 640 by 400 a value set's row cuts the terms it matched at an " +
      "ellipsis, and only the value set's own name has a title. Showing the rest needs a title over the " +
      'whole row, which adds a tooltip, or a row that wraps.',
  },
  {
    check: 'resize',
    kind: 'clipped',
    selector: '.filter-popover',
    states: ['the narrowing panel'],
    why:
      'At 640 by 400 the narrowing panel opens under its chip with about 96px of room. Its box clips the ' +
      'ontologies to choose from and its Clear all, Cancel and Apply buttons until the page is scrolled ' +
      'and the panel follows the chip up. Showing them at once needs the panel placed above the chip, or ' +
      'kept tall enough for its finder, a row and its footer, which changes where it is drawn.',
  },
];

/** The CSS 1.4.12 describes, as its understanding document and the common bookmarklet apply it. */
const SPACING =
  '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } ' +
  'p { margin-bottom: 2em !important; }';

const VERSIONS = [
  { id: 'hash-c-0123456789abcdef', effectiveDate: '2026-07-01T00:00:00.000-07:00', declaredVersion: '26.07d' },
  { id: 'hash-b-0123456789abcdef', effectiveDate: '2026-06-03T00:00:00.000-07:00', declaredVersion: '26.06e' },
  { id: 'hash-a-0123456789abcdef', effectiveDate: '2026-05-06T00:00:00.000-07:00' },
];

/** An answer with something on every tab, long names included, and a source that was not searched. */
const ANSWER = {
  sources: [
    source('NCIT', {
      name: 'National Cancer Institute Thesaurus',
      versionCount: 3,
      declaredVersion: '26.07d',
      versions: VERSIONS,
    }),
    source('DOID', { name: 'Human Disease Ontology', versionCount: 15, declaredVersion: '2026-06-30' }),
    source('MELO', { name: 'Melanoma Ontology' }),
    source('GONE', { served: 'unavailable', reason: 'sourceUnknown' }),
  ],
  results: {
    class: results(
      [
        classHit('NCIT', 'Melanoma', {
          descendantCount: 321,
          under: 'Melanocytic Neoplasm',
          names: [{ label: 'Cutaneous melanoma' }, { label: 'mélanome', language: 'fr' }],
        }),
        classHit('DOID', 'melanoma', {
          descendantCount: 31,
          definition:
            'A cell type cancer that has_material_basis_in abnormally proliferating cells derived from melanocytes.',
        }),
      ],
      { totalCount: 2, distinctLabelCount: 1 },
    ),
    branch: results([branchHit('NCIT', 'Melanoma', 'Melanocytic Neoplasm', 321)], {
      totalCount: 1,
      distinctLabelCount: 1,
    }),
    ontology: results([ontologyHit('MELO', 38, true), ontologyHit('NCIT', 950, false)]),
    valueSet: results([
      {
        type: 'valueSet',
        sourceSystem: 'bioportal',
        sourceAcronym: 'NCIT',
        termBaseIri: 'http://ncit/C-melanoma-stage',
        termBaseLabel: 'Melanoma Clinical Stage Value Set',
        termCount: 12,
        matchedTerms: [{ termIri: 'http://ncit/C-stage-1', termLabel: 'Stage I Cutaneous Melanoma' }],
      },
    ]),
  },
};

const PROPERTY = { iri: 'urn:part', kind: 'object', label: 'part of', obsolete: false, parents: ['urn:related'] };

/** Answers the search, NCIT's release history, a tree for any term, and the property endpoints. */
async function stubAll(page: Page): Promise<void> {
  await stubSearch(page, (body) =>
    body.includeVersions
      ? { sources: [ANSWER.sources[0]], results: { ontology: results([]) } }
      : {
          ...ANSWER,
          results: Object.fromEntries(
            Object.entries(ANSWER.results).filter(([kind]) => !body.types || body.types.includes(kind)),
          ),
        },
  );
  await stubHierarchy(page, (query) => ({
    sourceAcronym: query.get('sourceAcronym'),
    termIri: query.get('termIri'),
    termLabel: 'Melanoma',
    path: [
      { termIri: 'http://ncit/Neoplasm', termLabel: 'Neoplasm by Morphology' },
      { termIri: 'http://ncit/Melanocytic', termLabel: 'Melanocytic Neoplasm' },
    ],
    children: [
      { termIri: 'http://ncit/Acral', termLabel: 'Acral Lentiginous Melanoma', hasChildren: true, descendantCount: 3 },
      { termIri: 'http://ncit/Nodular', termLabel: 'Nodular Melanoma', hasChildren: false, descendantCount: 0 },
    ],
    childCount: 40,
    descendantCount: 321,
  }));
  // Registered after the search stub, so these answer first.
  await page.route('**/properties/search', (route) =>
    route.fulfill({
      json: {
        total: 1,
        page: 1,
        pageSize: 25,
        items:
          (route.request().postDataJSON().offset ?? 0) > 0
            ? []
            : [{ sourceAcronym: 'RO', versionId: 'ro-v2', property: { ...PROPERTY, literals: [], hasChildren: true } }],
      },
    }),
  );
  await page.route('**/properties/versions?*', (route) =>
    route.fulfill({
      json: [
        { id: 'ro-v2-0123456789abcdef', declaredVersion: '2026-02-17', propertiesAvailable: true },
        { id: 'ro-v1-0123456789abcdef', declaredVersion: '2025-06-01', propertiesAvailable: true },
      ],
    }),
  );
  await page.route('**/properties/hierarchy?*', (route) =>
    route.fulfill({
      json: {
        selected: {
          sourceAcronym: 'RO',
          versionId: 'ro-v2',
          property: {
            ...PROPERTY,
            literals: [
              {
                predicate: 'http://www.w3.org/2000/01/rdf-schema#comment',
                lang: 'en',
                value: 'a core relation that holds between a part and its whole',
              },
            ],
          },
        },
        ancestors: [{ ...PROPERTY, iri: 'urn:related', label: 'overlaps', parents: [], literals: [] }],
        children: [{ ...PROPERTY, iri: 'urn:sub', label: 'has component', parents: ['urn:part'], hasChildren: true }],
        offset: 0,
      },
    }),
  );
}

const picker = (page: Page) => page.locator('cedar-embeddable-term-picker');

async function open(page: Page, mode: string): Promise<void> {
  await stubAll(page);
  await page.goto(`/?mode=${mode}`);
  await picker(page).locator('.picker').waitFor();
}

async function answered(page: Page, mode = 'constraints'): Promise<void> {
  await open(page, mode);
  await search(page, 'melanoma');
}

/** A tab by its position: Terms, Branches, Ontologies, Value sets, Properties. */
async function showTab(page: Page, index: number): Promise<void> {
  await picker(page).locator('.tab').nth(index).click();
  await expect(picker(page).locator('.tab').nth(index)).toHaveAttribute('aria-selected', 'true');
}

/**
 * The five kinds, set before the query is typed. Setting them after a search starts a second one, and
 * a reply that arrives late replaces the results a test has already opened.
 */
async function withProperties(page: Page): Promise<void> {
  await open(page, 'constraints');
  await picker(page).evaluate((element) =>
    Object.assign(element, { termTypes: ['class', 'branch', 'ontology', 'valueSet', 'property'] }),
  );
  await search(page, 'melanoma');
  await expect(picker(page).locator('.tab')).toHaveCount(5);
}

/** The states, each reached from a fresh page. */
const STATES: Readonly<Record<string, (page: Page) => Promise<void>>> = {
  opened: (page) => open(page, 'constraint'),
  'the terms tab': async (page) => {
    await answered(page);
    await picker(page).locator('.rowhead').first().click();
  },
  'the branches tab': async (page) => {
    await answered(page);
    await showTab(page, 1);
    await picker(page).locator('.rowhead').first().click();
  },
  'the ontologies tab': async (page) => {
    await answered(page);
    await showTab(page, 2);
  },
  'the value sets tab': async (page) => {
    await answered(page);
    await showTab(page, 3);
  },
  'the properties tab': async (page) => {
    await withProperties(page);
    await showTab(page, 4);
    await picker(page).locator('.rowhead').first().click();
  },
  'a marked and opened row': async (page) => {
    await answered(page, 'constraint');
    await showTab(page, 2);
    await picker(page).locator('.row.pick').first().click();
    await expect(picker(page).locator('.detail')).toBeVisible();
  },
  'the tree': async (page) => {
    await answered(page, 'constraint');
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child').first().click();
    await expect(picker(page).locator('.tree .node')).toHaveCount(5);
    await picker(page).locator('.tree button.twist').first().click();
  },
  'the release history': async (page) => {
    await answered(page);
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child').first().locator('button.of').click();
    await expect(picker(page).locator('.history button.release')).toHaveCount(3);
  },
  "a property's detail": async (page) => {
    await withProperties(page);
    await showTab(page, 4);
    await picker(page).locator('.rowhead').first().click();
    await picker(page).locator('.child.pick').first().click();
    await expect(picker(page).locator('cetp-property-detail .tree')).toBeVisible();
    await picker(page).locator('.release-toggle').click();
  },
  'the narrowing panel': async (page) => {
    await answered(page);
    await picker(page).locator('.filter-chip > button').first().click();
    await expect(picker(page).locator('.candidate input')).toHaveCount(2);
  },
  'a set constraint': async (page) => {
    await open(page, 'constraints');
    await picker(page).evaluate((node) =>
      Object.assign(node, {
        constraintSet: {
          constraints: [
            {
              sourceType: 'ontology',
              ontologyId: 'DOID',
              ontologyName: 'Human Disease Ontology',
              uri: 'http://purl.obolibrary.org/obo/doid.owl',
              version: { id: 'sha256:0123456789abcdef0123456789abcdef', declaredVersion: '2026-06-30' },
            },
            {
              sourceType: 'ontology-branch',
              ontologyId: 'NCIT',
              uri: 'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl#C3224',
              label: 'Melanoma',
              searchDepth: 2,
            },
          ],
          actions: [
            {
              action: 'move',
              termUri: 'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl#C3224',
              sourceUri: 'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl',
              type: 'OntologyClass',
              to: 2,
            },
          ],
        },
      }),
    );
    for (const summary of await picker(page).locator('cetp-constraint-table summary').all()) await summary.click();
    await search(page, 'melanoma');
  },
};

interface Finding {
  readonly kind: Kind;
  readonly where: string;
  readonly detail: string;
  /** The index of the exception or the in-place scroller that covers it. */
  readonly excused: number | null;
}

/**
 * Measures the page as it stands. Runs in the browser, so it takes everything it needs as arguments
 * and returns plain findings.
 */
function measure({
  kinds,
  excuses,
}: {
  kinds: readonly Kind[];
  excuses: readonly { readonly kind: Kind; readonly selector: string }[];
}): Finding[] {
  const roots: (Document | ShadowRoot)[] = [];
  const collect = (root: Document | ShadowRoot): void => {
    roots.push(root);
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot);
  };
  collect(document);
  const elements = roots.flatMap((root) => [...root.querySelectorAll<HTMLElement>('*')]);
  const parentOf = (element: Element): Element | null =>
    element.parentElement ?? (element.parentNode instanceof ShadowRoot ? element.parentNode.host : null);
  const lineage = (element: Element): Element[] => {
    const line: Element[] = [];
    for (let at: Element | null = element; at; at = parentOf(at)) line.push(at);
    return line;
  };
  const contains = (outer: Element, inner: Element): boolean => lineage(inner).includes(outer);
  const style = (element: Element) => getComputedStyle(element);
  // Visually hidden text is for assistive technology and is clipped to a pixel on purpose.
  const hiddenOnPurpose = (element: Element): boolean =>
    lineage(element).some((at) => {
      const box = at.getBoundingClientRect();
      return style(at).clipPath !== 'none' && box.width <= 1 && box.height <= 1;
    });
  const shown = (element: Element): boolean =>
    element.getClientRects().length > 0 &&
    style(element).visibility === 'visible' &&
    !lineage(element).some((at) => at.localName === 'select' || Number(style(at).opacity) === 0) &&
    !hiddenOnPurpose(element);
  const describe = (element: Element): string => {
    const steps = lineage(element)
      .slice(0, 3)
      .map((at) => at.localName + [...at.classList].map((name) => `.${name}`).join(''));
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${steps.reverse().join(' > ')}${text ? ` "${text}"` : ''}`;
  };
  const excusedBy = (kind: Kind, ...involved: Element[]): number | null => {
    const index = excuses.findIndex(
      (excuse) => excuse.kind === kind && involved.some((element) => element.matches(excuse.selector)),
    );
    return index < 0 ? null : index;
  };
  const findings: Finding[] = [];
  const found = (kind: Kind, detail: string, ...involved: Element[]): void => {
    findings.push({ kind, where: involved.map(describe).join(' / '), detail, excused: excusedBy(kind, ...involved) });
  };

  // The visible text, a text node at a time, with the boxes it is drawn in.
  const texts = elements
    .filter(shown)
    .flatMap((element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
        .map((node) => ({ node, element })),
    );
  const boxesOf = (node: Node): DOMRect[] => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter((box) => box.width > 0.5 && box.height > 0.5);
  };
  const visibleText = (element: Element): string =>
    texts
      .filter((text) => contains(element, text.element))
      .map((text) => text.node.textContent)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

  if (kinds.includes('page scrolls')) {
    const page = document.documentElement;
    if (page.scrollWidth > page.clientWidth)
      findings.push({
        kind: 'page scrolls',
        where: 'the page',
        detail: `${page.scrollWidth}px of content in ${page.clientWidth}px`,
        excused: null,
      });
  }

  if (kinds.includes('scrolls'))
    for (const element of elements.filter(shown)) {
      const overflow = style(element).overflowX;
      if ((overflow === 'auto' || overflow === 'scroll') && element.scrollWidth > element.clientWidth + 1)
        found('scrolls', `${element.scrollWidth}px of content in ${element.clientWidth}px`, element);
    }

  // An element clips text where it hides its overflow, holds more than fits, and some of what does
  // not fit is text. Overflow that is only an icon or a transform, such as a turned chevron, hides
  // no content.
  if (kinds.includes('clipped'))
    for (const element of elements.filter(shown)) {
      const { overflowX, overflowY, textOverflow } = style(element);
      const clips = (overflow: string) => overflow === 'hidden' || overflow === 'clip';
      const inner = element.getBoundingClientRect();
      const [left, top] = [inner.left + element.clientLeft, inner.top + element.clientTop];
      const words = texts.filter((text) => contains(element, text.element)).flatMap((text) => boxesOf(text.node));
      const across =
        clips(overflowX) &&
        element.scrollWidth > element.clientWidth + 1 &&
        words.some((box) => box.left < left - 1 || box.right > left + element.clientWidth + 1);
      const down =
        clips(overflowY) &&
        element.scrollHeight > element.clientHeight + 1 &&
        words.some((box) => box.top < top - 1 || box.bottom > top + element.clientHeight + 1);
      if (!across && !down) continue;
      const size = `${element.scrollWidth}x${element.scrollHeight} in ${element.clientWidth}x${element.clientHeight}`;
      if (across && !down && textOverflow === 'ellipsis') {
        // An ellipsis loses nothing where the whole text is also a title or a name around it.
        const whole = visibleText(element);
        const elsewhere = lineage(element).some((at) =>
          [at.getAttribute('title'), at.getAttribute('aria-label')].some((said) =>
            said?.replace(/\s+/g, ' ').includes(whole),
          ),
        );
        if (!elsewhere) found('ellipsis', `${size}, and no title or name holds the whole`, element);
      } else found('clipped', size, element);
    }

  if (kinds.includes('overlap')) {
    // What a text node shows is what its scrolling and clipping boxes leave of it, its own element's
    // included, since an ellipsis is the element clipping its own text. A panel in the top layer, and
    // a sticky or fixed box, is drawn over the content that passes under it, and where its background
    // is opaque, what passes under is hidden rather than overlapped.
    const layer = (element: Element) =>
      lineage(element).find((at) => at.matches(':popover-open') || ['sticky', 'fixed'].includes(style(at).position)) ??
      null;
    const opaque = (element: Element | null) =>
      element !== null && /^rgb\(|^rgba\(.*, 1\)$/.test(style(element).backgroundColor);
    const drawn = texts.flatMap(({ node, element }) => {
      let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      for (const at of lineage(element)) {
        const { overflowX, overflowY } = style(at);
        const box = at.getBoundingClientRect();
        if (overflowX !== 'visible')
          clip = { ...clip, left: Math.max(clip.left, box.left), right: Math.min(clip.right, box.right) };
        if (overflowY !== 'visible')
          clip = { ...clip, top: Math.max(clip.top, box.top), bottom: Math.min(clip.bottom, box.bottom) };
      }
      return boxesOf(node)
        .map((box) => ({
          left: Math.max(box.left, clip.left),
          top: Math.max(box.top, clip.top),
          right: Math.min(box.right, clip.right),
          bottom: Math.min(box.bottom, clip.bottom),
        }))
        .filter((box) => box.right - box.left > 1 && box.bottom - box.top > 1)
        .map((box) => ({ box, node, element, layer: layer(element) }));
    });
    const reported = new Set<string>();
    for (const [index, one] of drawn.entries())
      for (const other of drawn.slice(index + 1)) {
        if (one.node === other.node) continue;
        if (one.layer !== other.layer && (opaque(one.layer) || opaque(other.layer))) continue;
        const width = Math.min(one.box.right, other.box.right) - Math.max(one.box.left, other.box.left);
        const height = Math.min(one.box.bottom, other.box.bottom) - Math.max(one.box.top, other.box.top);
        if (width <= 1 || height <= 1) continue;
        const key = `${describe(one.element)}|${describe(other.element)}`;
        if (reported.has(key)) continue;
        reported.add(key);
        found('overlap', `${width.toFixed(1)}x${height.toFixed(1)}px`, one.element, other.element);
      }
  }

  if (kinds.includes('unreachable')) {
    const controls = elements.filter(
      (element) =>
        element.matches('button, input:not([type=hidden]), select, textarea, a[href], summary, [tabindex="0"]') &&
        !(element as HTMLButtonElement).disabled &&
        shown(element),
    );
    for (const control of controls) {
      control.scrollIntoView({ block: 'center', inline: 'center' });
      const box = control.getBoundingClientRect();
      const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
      let hit: Element | null =
        x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (inner === null || inner === hit) break;
        hit = inner;
      }
      // While the narrowing panel is open it floats over the page, and what it covers is reached by
      // closing it.
      const panel = hit === null ? undefined : lineage(hit).find((at) => at.matches(':popover-open'));
      if (panel !== undefined && !contains(panel, control)) continue;
      if (hit === null || !contains(control, hit))
        found('unreachable', hit === null ? 'its centre is off screen' : `its centre shows ${describe(hit)}`, control);
    }
  }
  return findings;
}

/** Measures the placeholder of every input that shows one against what is behind it. */
function placeholders(): { where: string; ratio: number; text: string; background: string }[] {
  const roots: (Document | ShadowRoot)[] = [];
  const collect = (root: Document | ShadowRoot): void => {
    roots.push(root);
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot);
  };
  collect(document);
  const parse = (color: string): number[] => {
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: number[], bottom: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  return roots
    .flatMap((root) => [
      ...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]'),
    ])
    .filter((input) => input.placeholder !== '' && input.value === '' && input.getClientRects().length > 0)
    .map((input) => {
      // The ground is the first opaque background behind the input, composited from the top down.
      const layers: number[][] = [];
      for (
        let at: Element | null = input;
        at;
        at = at.parentElement ?? (at.parentNode as ShadowRoot | null)?.host ?? null
      ) {
        const fill = parse(getComputedStyle(at).backgroundColor);
        layers.push(fill);
        if (fill[3] === 1) break;
      }
      const ground = layers.reduceRight((below, layer) => over(layer, [...below, 1]), [255, 255, 255]);
      const placeholder = getComputedStyle(input, '::placeholder');
      const color = parse(placeholder.color);
      const text = over([...color.slice(0, 3), color[3] * Number(placeholder.opacity)], [...ground, 1]);
      const [lighter, darker] = [luminance(text), luminance(ground)].sort((a, b) => b - a);
      return {
        where: `${input.localName}${[...input.classList].map((name) => `.${name}`).join('')} "${input.placeholder}"`,
        ratio: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100,
        text: hex(text),
        background: hex(ground),
      };
    });
}

const KINDS: Readonly<Record<Check, readonly Kind[]>> = {
  reflow: ['page scrolls', 'scrolls', 'unreachable', 'overlap'],
  resize: ['clipped', 'ellipsis', 'overlap', 'unreachable'],
  spacing: ['clipped', 'ellipsis', 'overlap'],
};

/** Waits for the picker's own transitions, so what is measured is what stays on screen. */
async function settle(page: Page): Promise<void> {
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
  await page.mouse.move(0, 0);
}

/**
 * Runs one check over the page as it stands. A finding fails unless an exception or, for reflow, an
 * in-place scroller covers it, and an exception for this state that covers nothing fails too.
 */
async function check(page: Page, which: Check, state: string): Promise<void> {
  const exceptions = EXCEPTIONS.filter((exception) => exception.check === which && exception.states.includes(state));
  const scrollers =
    which === 'reflow' ? SCROLLS_IN_PLACE.map(({ selector }) => ({ kind: 'scrolls' as const, selector })) : [];
  const findings = await page.evaluate(measure, {
    kinds: KINDS[which],
    excuses: [...exceptions, ...scrollers].map(({ kind, selector }) => ({ kind, selector })),
  });
  const failures = findings
    .filter((finding) => finding.excused === null)
    .map((finding) => `${finding.kind}: ${finding.where} (${finding.detail})`);
  const unused = exceptions
    .filter((_, index) => !findings.some((finding) => finding.excused === index))
    .map(({ kind, selector }) => `listed but not found: ${kind} at ${selector}`);
  expect([...failures, ...unused], `${which} in ${state}`).toEqual([]);
}

for (const [state, reach] of Object.entries(STATES)) {
  test(`reflow at 320 CSS px: ${state}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    // The host page's own gutter would leave the picker narrower than the viewport.
    await page.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        document.body.style.margin = '0';
        document.body.style.padding = '0';
      }),
    );
    await reach(page);
    expect((await picker(page).boundingBox())?.width).toBe(320);
    await settle(page);
    await check(page, 'reflow', state);
  });

  test(`resize to 640 by 400: ${state}`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await reach(page);
    await settle(page);
    await check(page, 'resize', state);
  });

  test(`text spacing at 1280 CSS px: ${state}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await reach(page);
    await page.evaluate((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      const roots: (Document | ShadowRoot)[] = [document];
      for (let index = 0; index < roots.length; index++)
        for (const element of roots[index].querySelectorAll('*'))
          if (element.shadowRoot) roots.push(element.shadowRoot);
      for (const root of roots) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }, SPACING);
    // The spacing reaches the picker's own shadow tree, not only the page around it.
    expect(
      await picker(page)
        .locator('.picker')
        .evaluate((element) => [getComputedStyle(element).lineHeight, getComputedStyle(element).letterSpacing]),
    ).toEqual(['21px', '1.68px']);
    await settle(page);
    await check(page, 'spacing', state);
  });
}

for (const state of ['opened', 'the narrowing panel']) {
  test(`placeholder contrast: ${state}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await STATES[state](page);
    if (state === 'opened') await picker(page).locator('.search input').fill('');
    await settle(page);
    const measured = await page.evaluate(placeholders);
    expect(measured.length, 'inputs showing a placeholder').toBeGreaterThan(0);
    expect(
      measured.filter((one) => one.ratio < 4.5),
      state,
    ).toEqual([]);
  });
}
