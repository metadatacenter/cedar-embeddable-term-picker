import { describe, expect, it } from 'vitest';
import type { ControlledTermSet } from './constraint-set';
import { integratedSearchRequest, integratedSearchResponse, searchableConstraints } from './integrated-search';

const DOID = 'http://purl.obolibrary.org/obo/';

/** One of each kind a field can be constrained by, the way the designer holds them. */
const field: ControlledTermSet = {
  constraints: [
    {
      sourceType: 'ontology-branch',
      branchRootId: `${DOID}DOID_4`,
      branchRootName: 'disease',
      sourceId: 'DOID',
      source: 'Human Disease Ontology (DOID)',
      ontologyName: 'Human Disease Ontology',
      searchDepth: 0,
      version: { id: 'hash-2025', declaredVersion: '2025-12-23' },
    },
    {
      sourceType: 'ontology-term',
      sourceId: 'http://ncit/C2926',
      sourceName: 'Lung Carcinoma',
      ontologyId: 'NCIT',
    },
    { sourceType: 'ontology', ontologyId: 'HP', ontologyName: 'Human Phenotype Ontology', sourceSystem: 'bioportal' },
    { sourceType: 'value-set', sourceId: 'http://vs/sex', sourceName: 'Sex', ontologyId: 'CEDARVS', numTerms: 3 },
    {
      sourceType: 'ontology-property',
      sourceId: 'http://ro/part_of',
      sourceName: 'part of',
      ontologyId: 'RO',
      propertyKind: 'object',
    },
  ],
  actions: [
    {
      action: 'delete',
      termUri: `${DOID}DOID_2841`,
      sourceUri: `${DOID}DOID_4`,
      source: 'DOID',
      type: 'OntologyClass',
    },
  ],
};

describe('searching within a field', () => {
  it('sends each constraint as the server takes it, and leaves a property out', () => {
    const body = integratedSearchRequest('asthma', field, 2, 20);
    expect(body).toEqual({
      parameterObject: {
        inputText: 'asthma',
        valueConstraints: {
          branches: [
            {
              uri: `${DOID}DOID_4`,
              acronym: 'DOID',
              source: 'Human Disease Ontology (DOID)',
              name: 'disease',
              maxDepth: 0,
              version: { id: 'hash-2025', declaredVersion: '2025-12-23' },
            },
          ],
          classes: [{ uri: 'http://ncit/C2926', prefLabel: 'Lung Carcinoma', type: 'OntologyClass', source: 'NCIT' }],
          ontologies: [{ acronym: 'HP', name: 'Human Phenotype Ontology', sourceSystem: 'bioportal' }],
          valueSets: [{ uri: 'http://vs/sex', vsCollection: 'CEDARVS', name: 'Sex', numTerms: 3 }],
          actions: [
            {
              action: 'delete',
              termUri: `${DOID}DOID_2841`,
              type: 'OntologyClass',
              source: 'DOID',
              sourceUri: `${DOID}DOID_4`,
            },
          ],
        },
      },
      page: 2,
      pageSize: 20,
    });
    expect(searchableConstraints(field)).toHaveLength(4);
  });

  it('leaves a branch depth to the server when the field records none', () => {
    const [branch] = field.constraints;
    if (branch.sourceType !== 'ontology-branch') throw new Error('the fixture leads with its branch');
    const body = integratedSearchRequest(
      'x',
      { constraints: [{ ...branch, searchDepth: undefined }], actions: [] },
      1,
      20,
    );
    expect(body.parameterObject.valueConstraints.branches[0]).not.toHaveProperty('maxDepth');
  });

  it('reads the answer as terms, keeping each one the picker can use', () => {
    const answer = integratedSearchResponse(
      {
        totalCount: 3,
        collection: [
          {
            '@id': `${DOID}DOID_0080810`,
            id: 'DOID_0080810',
            type: 'OntologyClass',
            prefLabel: 'acute asthma',
            definition: 'An asthma with sudden onset.',
            source: 'https://data.bioontology.org/ontologies/DOID',
          },
          {
            '@id': 'http://vs/female',
            type: 'Value',
            prefLabel: 'Female',
            source: 'https://data.bioontology.org/ontologies/CEDARVS',
          },
          // An IRI with a space is that term's defect, not the page's.
          {
            '@id': 'http://example.org/Respiratory System',
            type: 'OntologyClass',
            prefLabel: 'Respiratory',
            source: 'X',
          },
        ],
      },
      'a',
      field,
      1,
      20,
    );
    expect(answer?.results.class?.totalCount).toBe(3);
    expect(answer?.results.class?.collection).toEqual([
      {
        type: 'class',
        sourceSystem: 'bioportal',
        sourceAcronym: 'DOID',
        termIri: `${DOID}DOID_0080810`,
        termType: 'class',
        termLabel: 'acute asthma',
        obsolete: false,
        hasChildren: false,
        descendantCount: 0,
        definition: 'An asthma with sudden onset.',
      },
      {
        type: 'class',
        sourceSystem: 'bioportal',
        sourceAcronym: 'CEDARVS',
        termIri: 'http://vs/female',
        termType: 'value',
        termLabel: 'Female',
        obsolete: false,
        hasChildren: false,
        descendantCount: 0,
      },
    ]);
    expect(answer?.sources.map((source) => [source.sourceAcronym, source.sourceName])).toEqual([
      ['DOID', 'Human Disease Ontology'],
      ['CEDARVS', undefined],
    ]);
  });

  it('is not an answer without a count and a collection', () => {
    expect(integratedSearchResponse({ collection: [] }, 'a', field, 1, 20)).toBeNull();
    expect(integratedSearchResponse({ totalCount: 0 }, 'a', field, 1, 20)).toBeNull();
    expect(integratedSearchResponse(null, 'a', field, 1, 20)).toBeNull();
  });
});
