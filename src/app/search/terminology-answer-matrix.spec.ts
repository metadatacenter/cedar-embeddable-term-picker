import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../assets/i18n/en.json';
import hu from '../../assets/i18n/hu.json';
import { Message, isPhrase, messageOf, phrase } from '../i18n/localization';
import { PropertyHit } from './search-types';
import { TerminologyClient } from './terminology-client';

/**
 * Every request the picker makes, against every way the terminology server can fail to answer it.
 * What the author reads is the server's own sentence when it gives one and the picker's text, in
 * both of its languages, when it does not. It is never the browser's "Failed to fetch". A
 * cancellation stays a cancellation, for the caller to ignore.
 */
const property = { sourceAcronym: 'RO', versionId: 'pin', termIri: 'urn:part', propertyKind: 'object' } as PropertyHit;
type Request = 'class search' | 'property search' | 'property hierarchy' | 'property versions' | 'term hierarchy';
const REQUESTS: Record<Request, (client: TerminologyClient, signal: AbortSignal) => Promise<Message>> = {
  'class search': (client, signal) =>
    client.search({ query: 'heart', types: ['class'] }, signal).then(
      () => 'answered',
      (error: unknown) => (isAbort(error) ? 'cancelled' : messageOf(error, phrase('errors.searchFailed'))),
    ),
  'property search': (client, signal) =>
    client
      .search(
        { query: 'part', types: ['property'], sources: [{ sourceAcronym: 'RO', version: { id: 'pin' } }] },
        signal,
      )
      .then(
        (result) => result.errors?.property ?? 'answered',
        (error: unknown) => (isAbort(error) ? 'cancelled' : messageOf(error, phrase('errors.propertySearchFailed'))),
      ),
  'property hierarchy': (client, signal) =>
    client.propertyHierarchy(property, signal).then(
      () => 'answered',
      (error: unknown) => (isAbort(error) ? 'cancelled' : messageOf(error, phrase('errors.propertyUnreadable'))),
    ),
  'property versions': (client, signal) =>
    client.propertyVersions('RO', signal).then(
      () => 'answered',
      (error: unknown) => (isAbort(error) ? 'cancelled' : messageOf(error, phrase('errors.propertyUnreadable'))),
    ),
  'term hierarchy': (client, signal) =>
    client.hierarchy('DOID', 'urn:heart', 'pin', signal).then(
      (outcome) => ('reason' in outcome ? outcome.reason : 'answered'),
      (error: unknown) => (isAbort(error) ? 'cancelled' : messageOf(error, phrase('errors.searchFailed'))),
    ),
};
const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError';
const SERVER = 'The store holds no release of that ontology';

type Answer = 'no answer' | 'an explained refusal' | 'an unexplained 503' | 'a 200 that is not JSON' | 'a cancellation';
const ANSWERS: Record<Answer, () => Promise<Response>> = {
  'no answer': () => Promise.reject(new TypeError('Failed to fetch')),
  'an explained refusal': () => Promise.resolve(new Response(JSON.stringify({ message: SERVER }), { status: 400 })),
  'an unexplained 503': () => Promise.resolve(new Response('', { status: 503 })),
  'a 200 that is not JSON': () => Promise.resolve(new Response('<html>Sign in</html>', { status: 200 })),
  'a cancellation': () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
};

/** What the author is told, by request and answer. */
function expected(request: Request, answer: Answer): Message {
  const lookup = request === 'property hierarchy' || request === 'property versions' || request === 'property search';
  switch (answer) {
    case 'no answer':
      return phrase('errors.unreachable');
    case 'an explained refusal':
      return SERVER;
    case 'an unexplained 503':
      return lookup
        ? phrase('errors.propertyLookupFailed', { status: 503 })
        : phrase('errors.serverAnswered', { status: 503 });
    case 'a 200 that is not JSON':
      return phrase('errors.invalidResponse');
    case 'a cancellation':
      return 'cancelled';
  }
}

function text(catalogue: unknown, message: Message): string {
  if (!isPhrase(message)) return message;
  const value = message.key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalogue);
  if (typeof value !== 'string') throw new Error(`no text for ${message.key}`);
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    String((message.params as Record<string, unknown>)?.[name]),
  );
}

describe('The terminology server failing a picker request', () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const [request, run] of Object.entries(REQUESTS) as [Request, (typeof REQUESTS)[Request]][])
    for (const [answer, respond] of Object.entries(ANSWERS) as [Answer, (typeof ANSWERS)[Answer]][])
      it(`${request} meets ${answer}`, async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(() => respond()),
        );
        const client = new TerminologyClient();
        client.setBaseUrl('https://terminology.example/');
        const told = await run(client, new AbortController().signal);
        expect(told).toEqual(expected(request, answer));
        for (const catalogue of [en, hu]) {
          const shown = text(catalogue, told);
          expect(shown).not.toMatch(/Failed to fetch|Unexpected token/);
        }
      });
});
