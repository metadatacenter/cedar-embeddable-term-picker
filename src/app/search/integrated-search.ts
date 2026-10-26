import type {
  ControlledTermAction,
  ControlledTermConfig,
  ControlledTermSet,
  ControlledTermVersionRef,
} from './constraint-set';
import { constraintAcronym } from './constraint-presentation';
import { validIri } from './constraint-validation';
import type { ClassHit, SearchResponse, SourceBlock } from './search-types';

/**
 * Search within a field's constraints, as the terminology server's integrated search answers it.
 *
 * The route the metadata editor offers a field's values through. A picker choosing one term for a
 * field, such as its default, asks the same question, so an author is offered exactly what an
 * instance of the field may hold: the terms under each branch to its depth, each listed class, the
 * values of each value set and the terms of each ontology, at the release each constraint pins,
 * less the terms the field's actions remove. Searching the constraints' ontologies instead offered
 * all 1,569 DOID terms for "disease" to a field constrained to one of them, and refused the choice
 * only after it was made.
 *
 * This module is the wire boundary. The request spells its keys as the server's request model
 * spells them, and the answer is converted to the picker's hits on arrival; nothing past this file
 * sees either document.
 */
export const INTEGRATED_SEARCH_PATH = 'bioportal/integrated-search';

/** The constraints a term can be searched within. A property constraint holds no terms. */
export function searchableConstraints(set: ControlledTermSet | undefined): readonly ControlledTermConfig[] {
  return (set?.constraints ?? []).filter((c) => wireConstraint(c) !== null);
}

/** The request for one page of terms matching `query` within the set. */
export function integratedSearchRequest(query: string, set: ControlledTermSet, page: number, pageSize: number) {
  const valueConstraints = {
    ontologies: [] as object[],
    branches: [] as object[],
    classes: [] as object[],
    valueSets: [] as object[],
    actions: set.actions.map(wireAction),
  };
  for (const constraint of set.constraints) {
    const wire = wireConstraint(constraint);
    if (wire !== null) valueConstraints[wire.list].push(wire.entry);
  }
  return { parameterObject: { valueConstraints, inputText: query }, page, pageSize };
}

type WireList = 'ontologies' | 'branches' | 'classes' | 'valueSets';

/**
 * One constraint as the server's request model takes it, or null where it cannot take it.
 *
 * Optional members are left out rather than sent empty: the server rejects a member it does not
 * know and checks the ones it requires, and an empty string is not an absent one.
 */
function wireConstraint(c: ControlledTermConfig): { list: WireList; entry: object } | null {
  const common = {
    ...(c.iri ? { iri: c.iri } : {}),
    ...(c.sourceSystem ? { sourceSystem: c.sourceSystem } : {}),
    ...(c.version ? { version: wireVersion(c.version) } : {}),
  };
  switch (c.sourceType) {
    case 'ontology':
      return c.ontologyId
        ? {
            list: 'ontologies',
            entry: {
              acronym: c.ontologyId,
              ...(c.uri ? { uri: c.uri } : {}),
              ...(c.ontologyName ? { name: c.ontologyName } : {}),
              ...(typeof c.numTerms === 'number' ? { numTerms: c.numTerms } : {}),
              ...common,
            },
          }
        : null;
    case 'ontology-branch': {
      const acronym = constraintAcronym(c);
      return c.branchRootId && acronym
        ? {
            list: 'branches',
            entry: {
              uri: c.branchRootId,
              acronym,
              source: c.source || acronym,
              ...(c.branchRootName ? { name: c.branchRootName } : {}),
              ...(c.searchDepth !== undefined ? { maxDepth: c.searchDepth } : {}),
              ...common,
            },
          }
        : null;
    }
    case 'ontology-term': {
      const source = c.source || c.ontologyId;
      return c.sourceId && source
        ? {
            list: 'classes',
            entry: {
              uri: c.sourceId,
              prefLabel: c.sourceName || c.label || c.sourceId,
              type: c.termType ?? 'OntologyClass',
              ...(c.label ? { label: c.label } : {}),
              source,
              ...common,
            },
          }
        : null;
    }
    case 'value-set':
      return c.sourceId && c.ontologyId
        ? {
            list: 'valueSets',
            entry: {
              uri: c.sourceId,
              vsCollection: c.ontologyId,
              ...(c.sourceName ? { name: c.sourceName } : {}),
              ...(typeof c.numTerms === 'number' ? { numTerms: c.numTerms } : {}),
              ...common,
            },
          }
        : null;
    case 'ontology-property':
      return null;
  }
}

function wireVersion(version: ControlledTermVersionRef) {
  return {
    id: version.id,
    ...(version.effectiveDate ? { effectiveDate: version.effectiveDate } : {}),
    ...(version.declaredVersion ? { declaredVersion: version.declaredVersion } : {}),
  };
}

function wireAction(action: ControlledTermAction) {
  return {
    action: action.action,
    termUri: action.termUri,
    type: action.type,
    source: action.source,
    ...(action.sourceUri ? { sourceUri: action.sourceUri } : {}),
    ...(action.to !== undefined ? { to: action.to } : {}),
  };
}

type Wire = Record<string, unknown>;
const object = (value: unknown): value is Wire => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * The answer as the picker's terms results, or null where it is not an answer at all.
 *
 * A term the picker cannot use is left out rather than failing the page: one term with an IRI no
 * identifier policy accepts is that term's defect, not the other forty's.
 */
export function integratedSearchResponse(
  body: unknown,
  query: string,
  set: ControlledTermSet,
  page: number,
  pageSize: number,
): SearchResponse | null {
  if (!object(body) || !Array.isArray(body['collection'])) return null;
  const total = body['totalCount'];
  if (!Number.isSafeInteger(total) || (total as number) < 0) return null;
  const hits: ClassHit[] = [];
  for (const item of body['collection']) {
    const hit = object(item) ? hitOf(item, set) : null;
    if (hit !== null) hits.push(hit);
  }
  const sources = new Map<string, SourceBlock>();
  for (const hit of hits) {
    if (!sources.has(hit.sourceAcronym)) sources.set(hit.sourceAcronym, sourceOf(hit, set));
  }
  return {
    query,
    sources: [...sources.values()],
    results: {
      class: { totalCount: total as number, countCapped: false, page, pageSize, collection: hits },
    },
  };
}

/**
 * The `@id` rather than `id`: for a term reached through a value constraint the server sends a short
 * identifier in `id`, and the full IRI only in `@id`.
 */
function hitOf(item: Wire, set: ControlledTermSet): ClassHit | null {
  const iri = item['@id'];
  const label = item['prefLabel'];
  const acronym = acronymOf(item['source']);
  if (!validIri(iri) || !text(label) || acronym === null) return null;
  const definition = item['definition'];
  return {
    type: 'class',
    sourceSystem: constraintFor(acronym, set)?.sourceSystem || 'bioportal',
    sourceAcronym: acronym,
    termIri: iri,
    termType: item['type'] === 'Value' ? 'value' : 'class',
    termLabel: label,
    obsolete: false,
    hasChildren: false,
    descendantCount: 0,
    ...(text(definition) ? { definition } : {}),
  };
}

/** The server names a term's source by its ontology's address, which ends in the acronym. */
function acronymOf(source: unknown): string | null {
  if (!text(source)) return null;
  const acronym = source.split('/').filter(Boolean).at(-1);
  return acronym === undefined ? null : acronym;
}

function constraintFor(acronym: string, set: ControlledTermSet): ControlledTermConfig | undefined {
  return set.constraints.find((c) => constraintAcronym(c) === acronym);
}

function sourceOf(hit: ClassHit, set: ControlledTermSet): SourceBlock {
  const name = constraintFor(hit.sourceAcronym, set)?.ontologyName;
  return {
    sourceSystem: hit.sourceSystem,
    sourceAcronym: hit.sourceAcronym,
    ...(name ? { sourceName: name } : {}),
    served: 'local',
    pinnable: false,
  };
}
