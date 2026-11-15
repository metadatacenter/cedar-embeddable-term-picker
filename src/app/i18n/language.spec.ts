import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CedarEmbeddableTermPicker } from '../cedar-embeddable-term-picker';
import { TerminologyClient } from '../search/terminology-client';
import { SearchResponse } from '../search/search-types';
import { languageTag, messageLanguage, phrase } from './localization';

/** A client that answers every search with one fixture, so these specs need no server. */
class StubClient {
  setBaseUrl(): void {
    // The stub has no server to point anywhere.
  }

  async search(): Promise<SearchResponse> {
    return {
      query: 'melanoma',
      sources: [{ sourceSystem: 'bioportal', sourceAcronym: 'NCIT', served: 'local', pinnable: true }],
      results: {
        class: {
          totalCount: 54390,
          countCapped: false,
          distinctLabelCount: 12552,
          distinctLabelCountCapped: false,
          page: 1,
          pageSize: 25,
          collection: [
            {
              type: 'class',
              sourceSystem: 'bioportal',
              sourceAcronym: 'NCIT',
              termIri: 'http://ncit/Melanoma',
              termType: 'class',
              termLabel: 'Melanoma',
              obsolete: false,
              hasChildren: true,
              descendantCount: 321,
            },
          ],
        },
      },
    };
  }
}

type Fixture = ReturnType<typeof TestBed.createComponent<CedarEmbeddableTermPicker>>;

function shadow(fixture: Fixture): ShadowRoot {
  return (fixture.nativeElement as HTMLElement).shadowRoot!;
}

function text(fixture: Fixture, selector: string): string {
  // Collapses layout whitespace only: `\s` would also collapse the no-break space a number carries.
  return (shadow(fixture).querySelector(selector)?.textContent ?? '').replace(/[ \t\r\n]+/g, ' ').trim();
}

/** The search is debounced, so a spec waits the debounce out rather than the microtask. */
async function settle(fixture: Fixture, ms = 400): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await fixture.whenStable();
}

describe('the language input', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({}).overrideComponent(CedarEmbeddableTermPicker, {
      set: { providers: [{ provide: TerminologyClient, useValue: new StubClient() }] },
    });
  });

  it('renders Hungarian when set to hu and English again when set back', async () => {
    const fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    fixture.componentRef.setInput('query', 'melanoma');
    await settle(fixture);
    expect(text(fixture, '.search .label')).toBe('Find terms');
    expect(text(fixture, '.tab')).toBe('Terms 12,552');

    fixture.componentRef.setInput('language', 'hu');
    await fixture.whenStable();
    expect(text(fixture, '.search .label')).toBe('Fogalmak keresése');
    // Hungarian groups digits with a no-break space, where English uses a comma.
    expect(text(fixture, '.tab')).toBe('Fogalmak 12 552');
    expect(text(fixture, '.results .rowhead')).toContain('1 ontológiában');
    expect(shadow(fixture).querySelector('.actions .primary')?.textContent?.trim()).toBe('Kész');

    fixture.componentRef.setInput('language', 'en');
    await fixture.whenStable();
    expect(text(fixture, '.search .label')).toBe('Find terms');
    expect(text(fixture, '.tab')).toBe('Terms 12,552');
    expect(text(fixture, '.results .rowhead')).toContain('in 1 ontology');
    expect(shadow(fixture).querySelector('.actions .primary')?.textContent?.trim()).toBe('Done');
  });

  it('redraws a message already on screen in the new language', async () => {
    const fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    fixture.componentRef.setInput('query', 'ce');
    await settle(fixture, 1000);
    expect(text(fixture, '.notice')).toContain('at least 3 characters');

    fixture.componentRef.setInput('language', 'hu');
    await fixture.whenStable();
    expect(text(fixture, '.notice')).toContain('legalább 3 karakter');
  });

  it('falls back to English for a language it does not speak', async () => {
    const fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    fixture.componentRef.setInput('language', 'de');
    await fixture.whenStable();
    expect(text(fixture, '.search .label')).toBe('Find terms');
  });

  it('lets two pickers on one page speak different languages', async () => {
    const english = TestBed.createComponent(CedarEmbeddableTermPicker);
    const hungarian = TestBed.createComponent(CedarEmbeddableTermPicker);
    hungarian.componentRef.setInput('language', 'hu');
    await english.whenStable();
    await hungarian.whenStable();
    expect(text(english, '.search .label')).toBe('Find terms');
    expect(text(hungarian, '.search .label')).toBe('Fogalmak keresése');
  });
});

/*
 * A search asks for no label language, and the store answers with its default labels.
 *
 * `lang` chooses the language of the labels a search returns, and a pick records the label it was
 * shown. The language a field's terms are in belongs to the field, and the constraint's
 * term-language key will state it. Until that key exists there is no language to send. The
 * picker's own language is the author's: sent as `lang`, it would have a Hungarian-speaking author
 * record Hungarian labels in an English template. Once the key exists, the picker sends its
 * language as `lang`, and this test changes with it.
 */
describe('the label language a search asks for', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is none, whatever language the picker speaks', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/properties/search')) {
          return new Response(JSON.stringify({ total: 0, page: 1, pageSize: 25, items: [] }), { status: 200 });
        }
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ query: 'melanoma', sources: [], results: {} }), { status: 200 });
      }),
    );
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    fixture.componentRef.setInput('language', 'hu');
    fixture.componentRef.setInput('query', 'melanoma');
    await settle(fixture);

    expect(bodies, 'the picker searched with the client it ships with').not.toHaveLength(0);
    for (const body of bodies) expect(body).not.toHaveProperty('lang');
  });
});

describe('a label tagged with a language', () => {
  it('carries the tag it was sent, canonicalized', () => {
    expect(languageTag('fr')).toBe('fr');
    expect(languageTag('EN-us')).toBe('en-US');
  });

  it('carries none where it was sent none or one that is not a tag', () => {
    expect(languageTag(undefined)).toBeNull();
    expect(languageTag('')).toBeNull();
    expect(languageTag('not a tag')).toBeNull();
  });
});

describe('a message', () => {
  it("is in the picker's language when it is a phrase of the picker's own", () => {
    expect(messageLanguage(phrase('errors.searchFailed'))).toBeNull();
  });

  it("is English when it is the server's text", () => {
    expect(messageLanguage('The store holds no term urn:x in NCIT.')).toBe('en');
  });
});
