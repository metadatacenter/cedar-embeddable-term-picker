import { TestBed } from '@angular/core/testing';
import { CedarEmbeddableTermPicker } from '../cedar-embeddable-term-picker';
import { TerminologyClient } from '../search/terminology-client';
import { SearchResponse } from '../search/search-types';

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
    expect(text(fixture, '.tab')).toBe('terms 12,552');

    fixture.componentRef.setInput('language', 'hu');
    await fixture.whenStable();
    expect(text(fixture, '.search .label')).toBe('Fogalmak keresése');
    // Hungarian groups digits with a no-break space, where English uses a comma.
    expect(text(fixture, '.tab')).toBe('fogalmak 12 552');
    expect(text(fixture, '.results .rowhead')).toContain('1 ontológiában');
    expect(shadow(fixture).querySelector('.constraint-table-controls .use')?.textContent?.trim()).toBe('Kész');

    fixture.componentRef.setInput('language', 'en');
    await fixture.whenStable();
    expect(text(fixture, '.search .label')).toBe('Find terms');
    expect(text(fixture, '.tab')).toBe('terms 12,552');
    expect(text(fixture, '.results .rowhead')).toContain('in 1 ontology');
    expect(shadow(fixture).querySelector('.constraint-table-controls .use')?.textContent?.trim()).toBe('Done');
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
