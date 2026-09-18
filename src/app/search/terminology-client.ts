import { Injectable } from '@angular/core';
import {
  Hierarchy,
  SearchQuery,
  SearchResponse,
  SEARCH_KINDS,
  PropertySummary,
  PropertyHit,
  PropertyHierarchy,
  VersionInfo,
} from './search-types';

/**
 * The picker's one call to the terminology server.
 *
 * Framework-free apart from the decorator: no Angular types cross this boundary, so what it returns
 * can be tested without a DOM and the component holds no knowledge of HTTP.
 */
@Injectable({ providedIn: 'root' })
export class TerminologyClient {
  /**
   * Where the terminology server's version-aware search lives.
   *
   * Same-origin by default, so the dev server's proxy sends it on and no CORS
   * question arises. A host embedding the picker in its own page is not on the
   * terminology server's origin and has no such proxy, so it names the base
   * instead and this hangs off it — the path is the picker's, in the way CEE's
   * `bioportal/integrated-search` is CEE's, and a host free to move it could only
   * move it somewhere nothing answers.
   */
  private endpoint = '/search';

  /** Point the client at a host-named terminology server. Must end in a slash. */
  setBaseUrl(baseUrl: string | null): void {
    this.endpoint = baseUrl === null ? '/search' : `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}search`;
  }

  /**
   * Runs a search, or reports why the server would not.
   *
   * A refusal is not an error to swallow. "Needs at least two characters" and "no local store" are
   * answers the author has to see, and are the difference between a search that found nothing and
   * one that never ran.
   */
  async search(query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
    const types = query.types ?? SEARCH_KINDS.filter((type) => type !== 'property');
    if (types.includes('property')) {
      const ordinary = types.filter((type) => type !== 'property');
      const [classes, properties] = await Promise.all([
        ordinary.length
          ? this.search({ ...query, types: ordinary }, signal)
          : Promise.resolve({ query: query.query, sources: [], results: {} } as SearchResponse),
        this.searchProperties(query, signal).catch((error: unknown): SearchResponse => {
          if (!ordinary.length || signal?.aborted) throw error;
          return {
            query: query.query,
            sources: [],
            results: {},
            errors: {
              property: error instanceof Error ? error.message : 'Property search failed.',
            },
          };
        }),
      ]);
      return {
        query: query.query,
        sources: classes.sources,
        errors: properties.errors,
        results: { ...classes.results, property: properties.results.property },
      };
    }
    if (!types.length) return { query: query.query, sources: [], results: {} };
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(refusalMessage(body) ?? `The terminology server answered ${response.status}.`);
    }
    return body as SearchResponse;
  }

  private propertyEndpoint(): string {
    return this.endpoint.replace(/search$/, 'properties');
  }

  private async propertyRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.propertyEndpoint()}${path}`, init);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(refusalMessage(body) ?? `Property lookup failed (${response.status}).`);
    return body as T;
  }

  private async searchProperties(query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
    const result = await this.propertyRequest<{
      total: number;
      page: number;
      pageSize: number;
      items: { sourceAcronym: string; versionId: string; property: PropertySummary }[];
    }>('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        query: query.query,
        page: query.page,
        pageSize: query.pageSize,
        sources: query.sources?.map((source) => ({
          sourceAcronym: source.sourceAcronym,
          versionId: typeof source.version === 'object' ? source.version.id : undefined,
        })),
      }),
    });
    return {
      query: query.query,
      sources: [],
      results: {
        property: {
          totalCount: result.total,
          countCapped: false,
          page: result.page,
          pageSize: result.pageSize,
          collection: result.items.map(({ sourceAcronym, versionId, property }): PropertyHit => ({
            type: 'property',
            sourceSystem: 'bioportal',
            sourceAcronym,
            versionId,
            termIri: property.iri,
            termLabel: property.label,
            propertyKind: property.kind,
            obsolete: property.obsolete,
            hasChildren: property.hasChildren,
          })),
        },
      },
    };
  }

  propertyHierarchy(hit: PropertyHit, signal?: AbortSignal, offset = 0): Promise<PropertyHierarchy> {
    return this.propertyRequest(
      `/hierarchy?${new URLSearchParams({
        sourceAcronym: hit.sourceAcronym,
        versionId: hit.versionId,
        propertyIri: hit.termIri,
        kind: hit.propertyKind,
        offset: String(offset),
      })}`,
      { signal },
    );
  }

  propertyVersions(
    acronym: string,
    signal?: AbortSignal,
  ): Promise<readonly (VersionInfo & { propertiesAvailable: boolean })[]> {
    return this.propertyRequest(`/versions?${new URLSearchParams({ sourceAcronym: acronym })}`, { signal });
  }

  /**
   * Where one term sits in its ontology.
   *
   * Its own call rather than part of a search: a page of results is twenty-five terms and an author
   * asks this of one.
   *
   * The three outcomes are distinct because two of them are answers and one is not. A 404 is the
   * store saying what it holds, and it says which of the several reasons applies — a release nothing
   * answers to, a release that does not contain the term, a term the index does not hold — so the
   * server's own sentence is carried through rather than replaced by a guess. Any other status is a
   * failure, and a failure is not evidence about the store's contents.
   */
  async hierarchy(
    sourceAcronym: string,
    termIri: string,
    versionId?: string,
    signal?: AbortSignal,
    offset?: number,
  ): Promise<HierarchyOutcome> {
    const query = new URLSearchParams({ sourceAcronym, termIri });
    if (versionId) {
      query.set('versionId', versionId);
    }
    if (offset) {
      query.set('offset', String(offset));
    }
    const response = await fetch(`${this.endpoint}/hierarchy?${query}`, { signal });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 404) {
      return {
        kind: 'absent',
        reason: refusalMessage(body) ?? `The store holds no ${termIri} in ${sourceAcronym}.`,
      };
    }
    if (!response.ok) {
      return {
        kind: 'failed',
        reason: refusalMessage(body) ?? `The terminology server answered ${response.status}.`,
      };
    }
    return { kind: 'found', hierarchy: body as Hierarchy };
  }
}

/**
 * What a hierarchy request produced.
 *
 * `absent` and `failed` are kept apart because only the first says anything about the store. They
 * were one `null`, so a dropped connection and a term genuinely outside a pinned release reached the
 * author as the same sentence about what the store holds — and for a release identifier nothing
 * matched, that sentence was about a term nothing had looked for.
 */
export type HierarchyOutcome =
  | { readonly kind: 'found'; readonly hierarchy: Hierarchy }
  | { readonly kind: 'absent'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

function refusalMessage(body: unknown): string | null {
  if (body === null || typeof body !== 'object') {
    return null;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : null;
}
