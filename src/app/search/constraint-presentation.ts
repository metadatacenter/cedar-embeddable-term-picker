import type { ControlledTermConfig } from './constraint-set';

/** The translation key of the word a constraint row uses for its kind. */
export function constraintKind(c: ControlledTermConfig): string {
  return {
    'ontology-term': 'table.kind.ontologyTerm',
    'ontology-branch': 'table.kind.ontologyBranch',
    ontology: 'table.kind.ontology',
    'value-set': 'table.kind.valueSet',
    'ontology-property': 'table.kind.ontologyProperty',
  }[c.sourceType];
}

/**
 * What an author reads on a constraint row.
 *
 * A switch rather than five fallbacks. The old chain,
 * `branchRootName || sourceName || ontologyName || sourceId || ontologyId`, worked by
 * knowing which fields happened to be absent on which kind — so it read as a puzzle
 * and it silently picked the wrong field the moment a variant grew one.
 */
export function constraintLabel(c: ControlledTermConfig): string {
  switch (c.sourceType) {
    case 'ontology-branch':
      return c.branchRootName || c.branchRootId || c.sourceType;
    case 'ontology':
      return c.ontologyName || c.ontologyId || c.sourceType;
    case 'ontology-property':
    case 'ontology-term':
      return c.label || c.sourceName || c.sourceId || c.sourceType;
    case 'value-set':
      return c.sourceName || c.sourceId || c.sourceType;
  }
}

/**
 * The identifier the constraint names: an ontology, a branch root, a term, a list.
 *
 * One question with four answers, which the template used to ask as
 * `c.uri || c.branchRootId || c.sourceId` in one place and `c.uri || c.sourceId` in
 * another — two chains that disagreed about branches.
 */
export function constraintUri(c: ControlledTermConfig): string {
  switch (c.sourceType) {
    case 'ontology-branch':
      return c.branchRootId;
    case 'ontology':
      return c.uri || c.ontologyId;
    case 'ontology-property':
    case 'ontology-term':
    case 'value-set':
      return c.sourceId;
  }
}

/** The acronym of the ontology a constraint belongs to, where it belongs to one. */
export function constraintAcronym(c: ControlledTermConfig): string {
  switch (c.sourceType) {
    case 'ontology':
      return c.ontologyId;
    case 'ontology-branch':
      return c.sourceId || c.source || '';
    case 'ontology-property':
    case 'ontology-term':
      return c.ontologyId || c.source || '';
    case 'value-set':
      // A value set names the collection it belongs to and carries no `source`.
      return c.ontologyId || '';
  }
}

/** Semantic identity excludes labels and other display metadata. */
export function constraintIdentity(c: ControlledTermConfig): string {
  return JSON.stringify([
    c.sourceType,
    c.sourceSystem || 'bioportal',
    constraintAcronym(c),
    c.sourceType === 'ontology' ? c.ontologyId : constraintUri(c),
    c.version?.id ?? null,
    c.sourceType === 'ontology-branch' ? (c.searchDepth ?? 0) : null,
    c.sourceType === 'ontology-term' ? (c.termType ?? 'OntologyClass') : null,
  ]);
}
