import { afterEach, expect, it, vi } from 'vitest';
import { messageOf, phrase } from '../i18n/localization';
import { TerminologyClient } from './terminology-client';

afterEach(() => vi.unstubAllGlobals());
it('searches properties locally with the requested ontology pin and merges them with classes', async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith('/properties/search')
            ? {
                totalCount: 1,
                request: { limit: 25, offset: 0 },
                currentOffset: 0,
                items: [
                  {
                    sourceAcronym: 'RO',
                    versionId: 'pin',
                    property: { iri: 'urn:part', label: 'part of', kind: 'object', obsolete: false, hasChildren: true },
                  },
                ],
              }
            : { query: 'part', sources: [], results: { class: { totalCount: 0, collection: [] } } },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');
  const result = await client.search({
    query: 'part',
    types: ['class', 'property'],
    sources: [{ sourceAcronym: 'RO', version: { id: 'pin' } }],
  });
  expect(result.results.property?.collection[0]).toMatchObject({
    type: 'property',
    propertyKind: 'object',
    versionId: 'pin',
  });
  expect(result.results.class).toBeDefined();
  expect(fetcher).toHaveBeenCalledWith(
    'https://local.example/properties/search',
    expect.objectContaining({ body: expect.stringContaining('"versionId":"pin"') }),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not call class search when only properties are enabled and reports extraction refusals', async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ message: 'Properties were not extracted' }), { status: 503 }),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(new TerminologyClient().search({ query: 'part', types: ['property'] })).rejects.toThrow(
    'Properties were not extracted',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual(expect.arrayContaining(['/properties/search']));
});

it('keeps class results when a historical snapshot has no extracted properties', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/properties/')
        ? new Response(JSON.stringify({ message: 'Properties were not extracted' }), { status: 503 })
        : new Response(
            JSON.stringify({
              query: 'part',
              sources: [],
              results: {
                class: {
                  totalCount: 1,
                  collection: [
                    {
                      type: 'class',
                      termIri: 'urn:old',
                      termLabel: 'Old',
                      sourceSystem: 'bioportal',
                      sourceAcronym: 'TEST',
                    },
                  ],
                },
              },
            }),
            { status: 200 },
          ),
    ),
  );
  const result = await new TerminologyClient().search({ query: 'part', types: ['class', 'property'] });
  expect(result.results.class?.collection).toHaveLength(1);
  expect(result.errors?.property).toBe('Properties were not extracted');
});

it('asks for a page by limit and offset, never by page number', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ query: 'x', sources: [], results: {} }), { status: 200 });
    }),
  );
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');

  await client.search({ query: 'x', types: ['class'], pageSize: 25 });
  await client.search({ query: 'x', types: ['class'], page: 3, pageSize: 25 });
  await client.search({ query: 'x', types: ['class'], page: 2 });

  expect(bodies[0]).toMatchObject({ limit: 25 });
  expect(bodies[0]).not.toHaveProperty('offset');
  expect(bodies[1]).toMatchObject({ limit: 25, offset: 50 });
  expect(bodies[2]).toMatchObject({ offset: 20 });
  expect(bodies[2]).not.toHaveProperty('limit');
  for (const body of bodies) {
    expect(body).not.toHaveProperty('page');
    expect(body).not.toHaveProperty('pageSize');
  }
});

it('searches each source at the system and release it names', async () => {
  // The server reads `sourceSystem`, `sourceAcronym` and `version` from each entry. A pin that does
  // not reach it is a search at latest, whose rows belong to another release than the field's.
  const sent: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ query: 'melanoma', sources: [], results: {} }), { status: 200 });
    }),
  );
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');
  const sources = [
    { sourceSystem: 'bioportal', sourceAcronym: 'DOID', version: { id: 'hash-2025' } },
    { sourceAcronym: 'NCIT', version: 'latest' as const },
    { sourceSystem: 'agroportal', sourceAcronym: 'AGROVOC' },
  ];

  await client.search({ query: 'melanoma', types: ['class', 'branch'], sources, lang: 'hu', pageSize: 25 });

  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe('https://local.example/search');
  expect(sent[0].init?.method).toBe('POST');
  expect(JSON.parse(String(sent[0].init?.body))).toEqual({
    query: 'melanoma',
    types: ['class', 'branch'],
    sources: [
      { sourceSystem: 'bioportal', sourceAcronym: 'DOID', version: { id: 'hash-2025' } },
      { sourceAcronym: 'NCIT', version: 'latest' },
      { sourceSystem: 'agroportal', sourceAcronym: 'AGROVOC' },
    ],
    lang: 'hu',
    limit: 25,
  });
});

it('shows the kinds it knows when the server answers one it does not', async () => {
  const term = { type: 'class', sourceSystem: 'bioportal', sourceAcronym: 'DOID', termIri: 'urn:m', termLabel: 'm' };
  const individual = { type: 'individual', sourceSystem: 'bioportal', sourceAcronym: 'DOID', iri: 'urn:i' };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            query: 'm',
            sources: [],
            results: {
              class: { totalCount: 1, countCapped: false, page: 1, pageSize: 20, collection: [term] },
              individual: { totalCount: 1, collection: [individual] },
            },
          }),
          { status: 200 },
        ),
    ),
  );

  const answer = await new TerminologyClient().search({ query: 'm', types: ['class'] });

  expect(answer.results.class?.collection).toEqual([term]);
  expect(Object.keys(answer.results)).toEqual(['class']);
});

it('still refuses an answer whose known kind is malformed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            query: 'm',
            sources: [],
            results: { class: { totalCount: 1, collection: [{ type: 'class', termIri: 'not an iri' }] } },
          }),
          { status: 200 },
        ),
    ),
  );

  const failure = await new TerminologyClient().search({ query: 'm', types: ['class'] }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(messageOf(failure, phrase('errors.searchFailed'))).toEqual(phrase('errors.invalidResponse'));
});

it('pages a property search by offset too', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ totalCount: 30, request: { limit: 25, offset: 25 }, currentOffset: 25, items: [] }),
        { status: 200 },
      );
    }),
  );
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');

  const answer = await client.search({ query: 'part', types: ['property'], page: 2, pageSize: 25 });

  expect(bodies[0]).toMatchObject({ query: 'part', limit: 25, offset: 25 });
  expect(bodies[0]).not.toHaveProperty('page');
  expect(answer.results.property).toMatchObject({ totalCount: 30, page: 2, pageSize: 25 });
});

it('asks for a page within a field by limit and offset, and reads the page from the answered window', async () => {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ totalCount: 60, request: { limit: 25, offset: 50 }, currentOffset: 50, collection: [] }),
        { status: 200 },
      );
    }),
  );
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');

  const answer = await client.searchWithin(
    { query: 'asthma', types: ['class'], page: 3, pageSize: 25 },
    { constraints: [{ sourceType: 'ontology', ontologyId: 'HP' }], actions: [] },
  );

  expect(urls[0]).toMatch(/bioportal\/integrated-search$/);
  expect(bodies[0]).toMatchObject({ limit: 25, offset: 50 });
  expect(bodies[0]).not.toHaveProperty('page');
  expect(bodies[0]).not.toHaveProperty('pageSize');
  expect(answer.results.class).toMatchObject({ totalCount: 60, page: 3, pageSize: 25 });
});

it("works out each kind's page from the limit and offset it was served at", async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            query: 'x',
            sources: [],
            results: {
              class: {
                totalCount: 120,
                countCapped: false,
                request: { limit: 25, offset: 50 },
                currentOffset: 50,
                collection: [],
              },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');

  const answer = await client.search({ query: 'x', types: ['class'], page: 3, pageSize: 25 });

  expect(answer.results.class).toMatchObject({ page: 3, pageSize: 25, totalCount: 120 });
});
