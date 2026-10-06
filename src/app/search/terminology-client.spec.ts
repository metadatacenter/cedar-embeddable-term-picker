import { afterEach, expect, it, vi } from 'vitest';
import { TerminologyClient } from './terminology-client';

afterEach(() => vi.unstubAllGlobals());
it('searches properties locally with the requested ontology pin and merges them with classes', async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith('/properties/search')
            ? {
                total: 1,
                page: 1,
                pageSize: 25,
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

it('pages a property search by offset too', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ total: 0, page: 2, pageSize: 25, items: [] }), { status: 200 });
    }),
  );
  const client = new TerminologyClient();
  client.setBaseUrl('https://local.example/');

  await client.search({ query: 'part', types: ['property'], page: 2, pageSize: 25 });

  expect(bodies[0]).toMatchObject({ query: 'part', limit: 25, offset: 25 });
  expect(bodies[0]).not.toHaveProperty('page');
});
