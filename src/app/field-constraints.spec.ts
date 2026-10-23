import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CedarEmbeddableTermPicker } from './cedar-embeddable-term-picker';
import { TerminologyClient } from './search/terminology-client';
import type { ControlledTermSet } from './search/constraint-set';
import type { SearchResponse } from './search/search-types';

const DOID = 'http://purl.obolibrary.org/obo/';

/** A field held to a DOID branch and one NCIT class, with a property constraint beside them. */
const field: ControlledTermSet = {
  constraints: [
    {
      sourceType: 'ontology-branch',
      branchRootId: `${DOID}DOID_4`,
      branchRootName: 'disease',
      sourceId: 'DOID',
      searchDepth: 0,
      version: { id: 'hash-2025', declaredVersion: '2025-12-23' },
    },
    { sourceType: 'ontology-term', sourceId: 'http://ncit/C2926', sourceName: 'Lung Carcinoma', ontologyId: 'NCIT' },
    {
      sourceType: 'ontology-property',
      sourceId: 'http://ro/part_of',
      sourceName: 'part of',
      ontologyId: 'RO',
      propertyKind: 'object',
    },
  ],
  actions: [],
};

const answer: SearchResponse = {
  query: 'asthma',
  sources: [{ sourceSystem: 'bioportal', sourceAcronym: 'DOID', served: 'local', pinnable: false }],
  results: {
    class: {
      totalCount: 1,
      countCapped: false,
      page: 1,
      pageSize: 25,
      collection: [
        {
          type: 'class',
          sourceSystem: 'bioportal',
          sourceAcronym: 'DOID',
          termIri: `${DOID}DOID_2841`,
          termType: 'class',
          termLabel: 'asthma',
          obsolete: false,
          hasChildren: false,
          descendantCount: 0,
        },
      ],
    },
  },
};

describe('choosing a term within a field', () => {
  const client = { setBaseUrl: vi.fn(), search: vi.fn(), searchWithin: vi.fn(), hierarchy: vi.fn() };

  beforeEach(() => {
    client.search.mockReset().mockResolvedValue({ ...answer, query: 'everywhere' });
    client.searchWithin.mockReset().mockResolvedValue(answer);
    TestBed.configureTestingModule({}).overrideComponent(CedarEmbeddableTermPicker, {
      set: { providers: [{ provide: TerminologyClient, useValue: client }] },
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  function setup(mode: 'term' | 'constraints', constraints: unknown = field) {
    const fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    fixture.componentRef.setInput('selectionMode', mode);
    fixture.componentRef.setInput('fieldConstraints', constraints);
    fixture.detectChanges();
    return { fixture, picker: fixture.componentInstance };
  }

  it('searches only within the constraints that hold terms', async () => {
    const { picker } = setup('term');
    await picker['run']('asthma');
    expect(client.search).not.toHaveBeenCalled();
    expect(client.searchWithin).toHaveBeenCalledOnce();
    const [query, scope] = client.searchWithin.mock.calls[0];
    expect(query.query).toBe('asthma');
    expect((scope as ControlledTermSet).constraints.map((c) => c.sourceType)).toEqual([
      'ontology-branch',
      'ontology-term',
    ]);
    expect(picker['response']()).toEqual(answer);
  });

  it('names every constraint it searches within, not the ontologies they come from', () => {
    const { fixture } = setup('term');
    fixture.detectChanges();
    const strip = (fixture.nativeElement as HTMLElement).shadowRoot!.querySelector('.narrowing')!;
    const chips = [...strip.querySelectorAll('.chip.within')].map((chip) =>
      chip.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(strip.textContent).toContain('Searching within');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toContain('disease');
    expect(chips[0]).toContain('DOID');
    expect(chips[0]).toContain('2025-12-23');
    expect(chips[1]).toContain('Lung Carcinoma');
    expect(chips[1]).toContain('NCIT');
  });

  it('reads the tree of a term at the release its constraint pins', () => {
    const { picker } = setup('term');
    expect(picker['hierarchyVersion']('DOID')).toBe('hash-2025');
    expect(picker['hierarchyVersion']('NCIT')).toBeUndefined();
  });

  it('leaves the constraints alone where the picker is not choosing one term', async () => {
    const { picker } = setup('constraints');
    await picker['run']('asthma');
    expect(client.searchWithin).not.toHaveBeenCalled();
    expect(client.search).toHaveBeenCalledOnce();
  });

  it('refuses constraints that are not a constraint set rather than searching everywhere', async () => {
    const { picker } = setup('term', { constraints: 'DOID' });
    expect(picker['configurationError']()).toEqual({ key: 'errors.fieldConstraints' });
    await picker['run']('asthma');
    expect(client.search).not.toHaveBeenCalled();
    expect(client.searchWithin).not.toHaveBeenCalled();
  });
});
