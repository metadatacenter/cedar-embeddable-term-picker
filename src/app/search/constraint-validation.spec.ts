import { describe, expect, it } from 'vitest';
import { validateConstraints, validIri } from './constraint-validation';

describe('shared model validation at the picker boundary', () => {
  it.each([
    null,
    {},
    { icon: 'bioportal' },
    { landingPage: 'javascript:alert(1)' },
    { landingPage: 'https://example.org', provider: 'epa' },
  ])('refuses invalid links %j', (links) => {
    expect(
      validateConstraints({ constraints: [{ sourceType: 'ontology', ontologyId: 'DOID', links }], actions: [] }),
    ).toEqual([expect.objectContaining({ code: 'shape' })]);
  });
  it('accepts generic URLs without changing the source or version', () => {
    const constraint = {
      sourceType: 'ontology',
      ontologyId: 'DOID',
      version: { id: 'snapshot' },
      links: { landingPage: 'https://example.org/source', icon: 'https://example.org/icon.svg' },
    };
    const before = JSON.stringify(constraint);
    expect(validateConstraints({ constraints: [constraint], actions: [] })).toEqual([]);
    expect(JSON.stringify(constraint)).toBe(before);
  });
  it.each(['\u001c', '\u001d', '\u001e', '\u001f', ' '])('refuses a blank version id %j', (id) => {
    expect(
      validateConstraints({
        constraints: [{ sourceType: 'ontology', ontologyId: 'DOID', version: { id } }],
        actions: [],
      }),
    ).toEqual([expect.objectContaining({ code: 'version' })]);
  });
  it.each(['\u00a0', '\u2007', '\u202f', '\ufeff'])('preserves a nonblank version id %j', (id) => {
    const draft = { constraints: [{ sourceType: 'ontology', ontologyId: 'DOID', version: { id } }], actions: [] };
    expect(validateConstraints(draft)).toEqual([]);
    expect(draft.constraints[0].version.id).toBe(id);
  });
  it.each(['urn:x\u0085', 'urn:x\ud800', 'urn:x\ufffe', 'urn:x\ue000', 'urn:x#a#b', 'urn:', 'http://'])(
    'refuses malformed identifiers %j',
    (value) => expect(validIri(value)).toBe(false),
  );
  it.each(['urn:café', 'urn:x\ufeff', 'urn:x?q=\ue000'])('accepts valid identifier spelling %j', (value) =>
    expect(validIri(value)).toBe(true),
  );
});
