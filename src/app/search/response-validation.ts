import { validIri } from './constraint-validation';
import { Hierarchy, SearchKind, SearchResponse, TAB_ORDER } from './search-types';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const refs = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (ref) => object(ref) && validIri(ref['termIri']) && (ref['termLabel'] === undefined || text(ref['termLabel'])),
    ));

/**
 * The search answer as the picker reads it, or null when it cannot be used.
 *
 * A result kind the picker does not know is left out rather than refused. A server that adds a kind
 * still answers the kinds the picker shows, and refusing the whole answer would turn every search
 * into an error. A known kind that is malformed still refuses the answer.
 */
export function readSearchResponse(value: unknown): SearchResponse | null {
  if (!object(value) || !object(value['results'])) return null;
  const results = Object.fromEntries(
    Object.entries(value['results'])
      .filter(([kind]) => TAB_ORDER.includes(kind as SearchKind))
      .map(([kind, block]) => [kind, withPage(block)]),
  );
  const response = { ...value, results };
  return validSearchResponse(response) ? response : null;
}

/**
 * A kind's block with its one-based `page` and its `pageSize` worked out from the limit and offset
 * it was served at. The server states a page by `request` and `currentOffset` alone.
 */
function withPage(block: unknown): unknown {
  if (!object(block)) return block;
  const request = block['request'];
  if (!object(request)) return block;
  const limit = request['limit'];
  const offset = block['currentOffset'] ?? request['offset'];
  if (typeof limit !== 'number' || typeof offset !== 'number' || !count(limit) || limit < 1 || !count(offset)) {
    return block;
  }
  return { ...block, page: Math.floor(offset / limit) + 1, pageSize: limit };
}

/** Reject unusable envelopes at the transport boundary, before computed views consume them. */
export function validSearchResponse(value: unknown): value is SearchResponse {
  if (!object(value) || !text(value['query']) || !Array.isArray(value['sources']) || !object(value['results']))
    return false;
  if (
    !value['sources'].every(
      (source) =>
        object(source) &&
        text(source['sourceAcronym']) &&
        text(source['sourceSystem']) &&
        (source['versions'] === undefined || Array.isArray(source['versions'])),
    )
  )
    return false;
  return Object.entries(value['results']).every(
    ([kind, result]) =>
      result === undefined ||
      (TAB_ORDER.includes(kind as (typeof TAB_ORDER)[number]) &&
        object(result) &&
        count(result['totalCount']) &&
        Array.isArray(result['collection']) &&
        result['collection'].every((hit) => {
          if (!object(hit) || hit['type'] !== kind || !text(hit['sourceAcronym']) || !text(hit['sourceSystem']))
            return false;
          if (!refs(hit['path']) || !refs(hit['examples']) || !refs(hit['matchedTerms'])) return false;
          for (const key of ['matchedLabels', 'names'])
            if (
              hit[key] !== undefined &&
              (!Array.isArray(hit[key]) || !hit[key].every((label) => object(label) && text(label['label'])))
            )
              return false;
          if (kind === 'ontology') return true;
          if (kind === 'class' || kind === 'property')
            return (
              validIri(hit['termIri']) &&
              text(hit['termLabel']) &&
              (kind !== 'property' ||
                (text(hit['versionId']) &&
                  ['object', 'datatype', 'annotation'].includes(hit['propertyKind'] as string)))
            );
          return (
            validIri(hit['termBaseIri']) &&
            (kind === 'valueSet'
              ? hit['termBaseLabel'] === undefined || text(hit['termBaseLabel'])
              : text(hit['termBaseLabel']))
          );
        })),
  );
}

export function validHierarchy(value: unknown, acronym: string, iri: string): value is Hierarchy {
  return (
    object(value) &&
    value['sourceAcronym'] === acronym &&
    value['termIri'] === iri &&
    text(value['termLabel']) &&
    count(value['childCount']) &&
    refs(value['path']) &&
    refs(value['children'])
  );
}
