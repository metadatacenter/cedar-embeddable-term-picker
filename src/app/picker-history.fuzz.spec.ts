import { expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { CedarEmbeddableTermPicker } from './cedar-embeddable-term-picker';
import { TerminologyClient, HierarchyOutcome } from './search/terminology-client';
import { ClassHit, Hierarchy, SearchQuery, SearchResponse } from './search/search-types';
import { ControlledTermSet } from './search/constraint-set';
import { Command, commands, checkAsyncHistory, historySeeds } from '../testing/seeded-history';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const term = (source: string, index: number): ClassHit => ({
  type: 'class',
  sourceSystem: 'bioportal',
  sourceAcronym: source,
  termIri: `urn:${source}:term:${index}`,
  termLabel: `Term ${index}`,
  termType: 'class',
  obsolete: false,
  hasChildren: true,
  descendantCount: 6,
});
type Request = {
  id: number;
  epoch: number;
  kind: 'search' | 'page' | 'tree' | 'children';
  source: string;
  version?: string;
  iri?: string;
  offset: number;
  query?: SearchQuery;
  owner: number;
  reply: ReturnType<typeof deferred<unknown>>;
};
const nodeId = (source: string, iri: string, version?: string) => JSON.stringify([source, iri, version ?? '']);

/** HTTP replies are a controlled adversary (even an aborted request may answer).
 * The oracle holds question ownership, accepted rows and tree pages as plain data. */
async function replay(history: Command[]) {
  TestBed.resetTestingModule();
  vi.useFakeTimers();
  let fixture!: ComponentFixture<CedarEmbeddableTermPicker>;
  let picker!: CedarEmbeddableTermPicker;
  let epoch = 0,
    sequence = 0,
    owner = 0;
  let source = 'TEST',
    query = 'term0',
    endpoint = 'https://terms.example/one';
  let rows: ClassHit[] = [];
  let pins = new Map<string, string>();
  const nodes = new Map<string, Hierarchy>();
  const outcomes = new Map<string, 'found' | 'absent' | 'failed'>();
  const newest = new Map<string, number>();
  const pending: Request[] = [];
  const emitted: ControlledTermSet[] = [];
  type Choice = { sourceType: string; source: string; iri?: string; version?: string };
  let choices: Choice[] = [];
  const choiceOf = (c: ControlledTermSet['constraints'][number]): Choice => ({
    sourceType: c.sourceType,
    source: 'ontologyId' in c ? (c.ontologyId ?? '') : 'sourceId' in c ? (c.sourceId ?? '') : '',
    iri: c.sourceType === 'ontology-term' ? c.sourceId : undefined,
    version: c.version?.id,
  });
  const inputs: Array<{ value: ControlledTermSet; snapshot: string }> = [];
  const scope = (request: Request) => `${request.kind}:${nodeId(request.source, request.iri ?? '', request.version)}`;
  const enqueue = (request: Omit<Request, 'id' | 'epoch' | 'reply'>) => {
    const entry: Request = { ...request, id: ++sequence, epoch, reply: deferred<unknown>() };
    newest.set(scope(entry), entry.id);
    pending.push(entry);
    return entry.reply.promise;
  };
  // Assertions belong outside the transport: production deliberately catches client errors.
  const boundaryErrors: string[] = [];
  const client = {
    setBaseUrl: vi.fn(),
    search: vi.fn((question: SearchQuery) => {
      if (question.query !== query) boundaryErrors.push('search query differs from user intent');
      if (question.sources?.[0]?.sourceAcronym !== source)
        boundaryErrors.push('search source differs from user intent');
      const kind = question.page ? 'page' : 'search';
      if (kind === 'search') owner++;
      return enqueue({
        kind,
        source,
        offset: question.page ?? 1,
        query: structuredClone(question),
        owner,
      }) as Promise<SearchResponse>;
    }),
    hierarchy: vi.fn((acronym: string, iri: string, version?: string, _signal?: AbortSignal, offset?: number) => {
      if (version !== pins.get(acronym)) boundaryErrors.push('tree release differs from user intent');
      return enqueue({
        kind: offset === undefined ? 'tree' : 'children',
        source: acronym,
        iri,
        version,
        offset: offset ?? 0,
        owner,
      }) as Promise<HierarchyOutcome>;
    }),
  };
  TestBed.configureTestingModule({}).overrideComponent(CedarEmbeddableTermPicker, {
    set: { providers: [{ provide: TerminologyClient, useValue: client }] },
  });
  const sync = async () => {
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  };
  const mount = async () => {
    fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    picker = fixture.componentInstance;
    fixture.componentRef.setInput('query', query);
    fixture.componentRef.setInput('sources', [{ sourceAcronym: source }]);
    fixture.componentRef.setInput('termTypes', ['class']);
    fixture.componentRef.setInput('terminologyBaseUrl', endpoint);
    picker.constraintsSelected.subscribe((value) => emitted.push(value));
    await sync();
  };
  // A new question owns the requests from here on, but the rows and tree pages on screen are the
  // last answer's until a reply to this one is accepted (`settle`). Until then they stay, and an
  // author can still act on them.
  const resetQuestion = () => {
    epoch++;
    newest.clear();
  };
  const settle = (accepted: ClassHit[]) => {
    rows = accepted;
    nodes.clear();
    outcomes.clear();
  };
  const snapshot = () =>
    JSON.stringify({
      response: picker['response'](),
      nodes: [...picker['nodes']()],
      histories: [...picker['hierarchies']()],
      searching: picker['searching'](),
      loading: picker['loadingMore'](),
      error: picker['error'](),
      emitted,
    });
  const verify = () => {
    expect(boundaryErrors, 'transport requests match user intent').toEqual([]);
    expect(
      picker['draft']().constraints.map(choiceOf),
      'constraint draft preserves identities and version pins',
    ).toEqual(choices);
    expect(
      picker['response']()?.results.class?.collection ?? [],
      'only accepted pages compose the result list',
    ).toEqual(rows);
    const actual = [...picker['nodes']().values()].map((node) => JSON.stringify(node)).sort();
    expect(actual, 'tree pages retain their source and release').toEqual(
      [...nodes.values()].map((node) => JSON.stringify(node)).sort(),
    );
    for (const node of nodes.values()) {
      const children = node.children?.map((child) => child.termIri) ?? [];
      expect(new Set(children).size, 'child paging never duplicates children').toBe(children.length);
    }
    for (const input of inputs)
      expect(JSON.stringify(input.value), 'host constraints are never mutated').toBe(input.snapshot);
  };
  const answer = async (index: number, outcome: number) => {
    const request = pending.splice(index, 1)[0];
    const tree = request.kind === 'tree' || request.kind === 'children';
    const live =
      request.epoch === epoch &&
      newest.get(scope(request)) === request.id &&
      (tree ? request.version === pins.get(request.source) : request.owner === owner);
    const before = snapshot();
    const key = nodeId(request.source, request.iri ?? '', request.version);
    if (tree) {
      const found: Hierarchy = {
        sourceAcronym: request.source,
        termIri: request.iri!,
        termLabel: `${request.source}/${request.version ?? 'latest'}/epoch${request.epoch}`,
        offset: request.offset,
        childCount: 6,
        descendantCount: 6,
        children: Array.from({ length: Math.min(2, Math.max(0, 6 - request.offset)) }, (_, i) => ({
          termIri: `${request.iri}/child/${request.offset + i}`,
          termLabel: `${request.version ?? 'latest'} child ${request.offset + i}`,
          hasChildren: false,
          descendantCount: 0,
        })),
      };
      const kind = outcome === 0 ? 'found' : outcome === 1 ? 'failed' : 'absent';
      if (outcome === 1) request.reply.reject(new Error('delayed failure'));
      else
        request.reply.resolve(kind === 'found' ? { kind, hierarchy: found } : { kind, reason: 'absent from release' });
      if (live) {
        if (request.kind === 'tree') outcomes.set(key, kind);
        if (kind === 'found')
          nodes.set(
            key,
            request.kind === 'tree'
              ? found
              : {
                  ...found,
                  children: [...(nodes.get(key)?.children ?? []), ...found.children!],
                },
          );
      }
    } else {
      const collection = Array.from({ length: Math.min(25, Math.max(0, 200 - (request.offset - 1) * 25)) }, (_, i) =>
        term(request.source, (request.offset - 1) * 25 + i),
      );
      if (outcome === 1) request.reply.reject(new Error('delayed failure'));
      else
        request.reply.resolve({
          query: request.query!.query,
          sources: [
            {
              sourceSystem: 'bioportal',
              sourceAcronym: request.source,
              served: 'local',
              pinnable: true,
              versionCount: 3,
              version: { id: 'current' },
            },
          ],
          results: { class: { collection, totalCount: 200, countCapped: false, page: request.offset, pageSize: 25 } },
        } satisfies SearchResponse);
      if (live) {
        if (request.kind === 'search') settle(outcome === 1 ? [] : collection);
        else if (outcome !== 1) rows = [...rows, ...collection];
      }
    }
    await sync();
    if (!live) expect(snapshot(), 'obsolete replies leave current state untouched').toBe(before);
    verify();
  };
  await mount();
  try {
    for (const command of history) {
      if (command.op === 0) {
        const next = `term${command.b % 5}`;
        if (next !== query) {
          query = next;
          resetQuestion();
          fixture.componentRef.setInput('query', query);
        }
      } else if (command.op === 1) {
        await vi.advanceTimersByTimeAsync([0, 1, 399, 800][command.b % 4]);
      } else if (command.op === 2 && pending.length) {
        await answer(command.a % pending.length, command.b % 3);
      } else if (command.op === 3) {
        source = source === 'TEST' ? 'OTHER' : 'TEST';
        resetQuestion();
        fixture.componentRef.setInput('sources', [{ sourceAcronym: source }]);
      } else if (command.op === 4) {
        endpoint = endpoint.endsWith('one') ? 'https://terms.example/two' : 'https://terms.example/one';
        pins.clear();
        resetQuestion();
        fixture.componentRef.setInput('terminologyBaseUrl', endpoint);
      } else if (command.op === 5) {
        void picker['loadMore']('class');
      } else if (command.op === 6 && rows.length) {
        picker['mark'](rows[0]);
      } else if (command.op === 7 && rows.length) {
        // The row's own source, which is not the one being asked for while the last answer is on screen.
        const held = rows[0].sourceAcronym;
        const version = command.b % 3;
        if (version) pins.set(held, `release${version}`);
        else pins.delete(held);
        picker['pinTo'](rows[0], { id: version ? `release${version}` : 'current' }, version);
      } else if (command.op === 8 && rows.length) {
        void picker['showMore'](rows[0].sourceAcronym, rows[0].termIri);
      } else if (command.op === 9 && rows.length) {
        const held = rows[0].sourceAcronym;
        const version = pins.get(held);
        const choice: Choice = { sourceType: 'ontology-term', source: held, iri: rows[0].termIri, version };
        // A row left from before the host changed the field's source is outside the field's vocabulary.
        const allowed =
          held === source &&
          (!version || outcomes.get(nodeId(held, rows[0].termIri, version)) === 'found') &&
          !choices.some((held) => JSON.stringify(held) === JSON.stringify(choice));
        picker['choose'](rows[0]);
        if (allowed) choices.push(choice);
      } else if (command.op === 10) {
        const value: ControlledTermSet = {
          constraints: [
            { sourceType: 'ontology-term', ontologyId: source, sourceId: `urn:host:${command.b}`, label: 'Host term' },
          ],
          actions: [],
        };
        choices = value.constraints.map(choiceOf);
        inputs.push({ value, snapshot: JSON.stringify(value) });
        fixture.componentRef.setInput('constraintSet', value);
      } else if (command.op === 11) {
        fixture.destroy();
        pins = new Map();
        choices = [];
        resetQuestion();
        settle([]);
        await mount();
      } else if (command.op === 12 && choices.length) {
        const index = command.a % choices.length;
        picker['removeConstraint'](index);
        choices.splice(index, 1);
      } else if (command.op === 13) {
        const count = emitted.length;
        picker['applyConstraints']();
        expect(emitted.length, 'a valid draft applies once per user action').toBe(count + 1);
        expect(emitted.at(-1)!.constraints.map(choiceOf), 'applied constraints retain source and release').toEqual(
          choices,
        );
      }
      await sync();
      verify();
    }
    // Drain in reverse order; most stale responses otherwise would remain unexamined.
    while (pending.length) await answer(pending.length - 1, 0);
  } finally {
    fixture!.destroy();
    for (const request of pending)
      request.reply.resolve(
        request.kind === 'tree' || request.kind === 'children'
          ? { kind: 'failed', reason: 'disposed' }
          : { query: '', sources: [], results: {} },
      );
    await Promise.resolve();
    await Promise.resolve();
    vi.clearAllTimers();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  }
}

it.each(historySeeds(100))('picker history seed %i', (seed) => checkAsyncHistory(seed, commands(seed, 70, 14), replay));

it('release changes reject old tree replies and keep child paging and selection on the chosen release', () =>
  replay([
    { op: 1, a: 0, b: 3, c: 0 },
    { op: 2, a: 0, b: 0, c: 0 },
    { op: 6, a: 0, b: 0, c: 0 },
    { op: 7, a: 0, b: 1, c: 0 },
    { op: 7, a: 0, b: 2, c: 0 },
    { op: 2, a: 2, b: 0, c: 0 },
    { op: 2, a: 0, b: 0, c: 0 },
    { op: 2, a: 0, b: 0, c: 0 },
    { op: 8, a: 0, b: 0, c: 0 },
    { op: 8, a: 0, b: 0, c: 0 },
    { op: 2, a: 0, b: 0, c: 0 },
    { op: 9, a: 0, b: 0, c: 0 },
    { op: 7, a: 0, b: 1, c: 0 },
    { op: 9, a: 0, b: 0, c: 0 },
    { op: 2, a: 0, b: 0, c: 0 },
    { op: 9, a: 0, b: 0, c: 0 },
    { op: 13, a: 0, b: 0, c: 0 },
  ]));
