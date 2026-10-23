import { describe, expect, it } from 'vitest';
import { toControlledTermConfig } from './picked-constraint';

describe('a picked branch', () => {
  it('reaches every level below its root until the author narrows it', () => {
    const config = toControlledTermConfig({
      type: 'branch',
      sourceAcronym: 'DOID',
      sourceSystem: 'bioportal',
      termBaseIri: 'http://purl.obolibrary.org/obo/DOID_4',
      termBaseLabel: 'disease',
    });
    expect(config.sourceType === 'ontology-branch' ? config.searchDepth : undefined).toBe(0);
  });
});
