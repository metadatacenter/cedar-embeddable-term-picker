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
            : { query: 'part', sources: [], results: { class: { collection: [] } } },
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
              sources: [],
              results: { class: { collection: [{ type: 'class', termIri: 'urn:old' }] } },
            }),
            { status: 200 },
          ),
    ),
  );
  const result = await new TerminologyClient().search({ query: 'part', types: ['class', 'property'] });
  expect(result.results.class?.collection).toHaveLength(1);
  expect(result.errors?.property).toBe('Properties were not extracted');
});
