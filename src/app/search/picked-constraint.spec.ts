import { describe, expect, it } from 'vitest';
import { toControlledTermConfig } from './picked-constraint';
import type { Presentation } from './generated/terminology-presentation';

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

describe('separate terminology presentation', () => {
  it.each(['EPA', 'BioPortal', 'Unknown future registry'])(
    'never persists %s link metadata in a constraint',
    (label) => {
      const presentation: Presentation = { href: 'https://example.org/list', label, versionScope: 'current' };
      const hit = {
        type: 'valueSet' as const,
        sourceSystem: 'future',
        sourceAcronym: 'FUTURE',
        sourceIri: 'urn:source:future',
        termBaseIri: 'urn:set:one',
        termBaseLabel: 'Set one',
        version: { id: 'hash-v1' },
        presentation,
      };
      const constraint = { ...hit, presentation: undefined };
      expect(toControlledTermConfig(hit)).toEqual(toControlledTermConfig(constraint));
      expect(JSON.stringify(toControlledTermConfig(hit))).not.toContain('presentation');
      expect(JSON.stringify(toControlledTermConfig(hit))).not.toContain('https://example.org/list');
    },
  );
});
