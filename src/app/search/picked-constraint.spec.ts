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

describe('shared constraint links', () => {
  it.each(['epa', 'bioportal', 'future'])('preserves %s links and the exact version independently', (sourceSystem) => {
    const links = { landingPage: 'https://example.org/list', icon: 'https://example.org/icon.svg' };
    const hit = {
      type: 'valueSet' as const,
      sourceSystem,
      sourceAcronym: 'TEST',
      sourceIri: 'urn:source:test',
      termBaseIri: 'urn:set:one',
      termBaseLabel: 'Set one',
      version: { id: 'hash-v1' },
      links,
    };
    expect(toControlledTermConfig(hit).links).toEqual(links);
    expect(toControlledTermConfig(hit).version?.id).toBe('hash-v1');
  });
});
