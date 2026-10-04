import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CedarEmbeddableTermPicker } from './cedar-embeddable-term-picker';
import { TerminologyClient, HierarchyOutcome } from './search/terminology-client';
import { ControlledTermConfig } from './search/constraint-set';
import { ClassHit, Hierarchy, SearchResponse } from './search/search-types';
import { hierarchyRows } from './search/hierarchy-rows';
import { validHierarchy, validSearchResponse } from './search/response-validation';
import { validIri } from './search/constraint-validation';

const term: ClassHit = {
  type: 'class',
  sourceSystem: 'bioportal',
  sourceAcronym: 'TEST',
  termIri: 'urn:term',
  termLabel: 'Term',
  termType: 'class',
  obsolete: false,
  hasChildren: true,
  descendantCount: 100,
};
const tree: Hierarchy = {
  sourceAcronym: 'TEST',
  termIri: 'urn:term',
  termLabel: 'Term',
  children: [],
  childCount: 0,
  descendantCount: 0,
};
const response = (label: string): SearchResponse => ({
  query: 'term',
  sources: [],
  results: {
    class: { collection: [{ ...term, termLabel: label }], totalCount: 1, countCapped: false, page: 1, pageSize: 25 },
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('picker state transition matrix', () => {
  const client = { setBaseUrl: vi.fn(), search: vi.fn(), hierarchy: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    client.search.mockReset().mockResolvedValue(response('Current'));
    client.hierarchy.mockReset().mockResolvedValue({ kind: 'found', hierarchy: tree });
    TestBed.configureTestingModule({}).overrideComponent(CedarEmbeddableTermPicker, {
      set: { providers: [{ provide: TerminologyClient, useValue: client }] },
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  function setup() {
    const fixture = TestBed.createComponent(CedarEmbeddableTermPicker);
    fixture.componentRef.setInput('query', 'term');
    fixture.detectChanges();
    return { fixture, picker: fixture.componentInstance };
  }

  for (const transition of ['query', 'endpoint', 'source', 'types', 'replacement', 'destroy']) {
    for (const failure of [false, true])
      for (const oldFirst of [false, true]) {
        it(`ignores old ${failure ? 'failure' : 'success'} after ${transition}, old first=${oldFirst}`, async () => {
          const { fixture, picker } = setup();
          const old = deferred<SearchResponse>(),
            current = deferred<SearchResponse>();
          // Deliberately ignore AbortSignal: a completed transport or a host adapter can still settle.
          client.search.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
          const before = picker['run']('term');
          if (transition === 'query') fixture.componentRef.setInput('query', 'new term');
          if (transition === 'endpoint') fixture.componentRef.setInput('terminologyBaseUrl', 'https://new.example/');
          if (transition === 'source') fixture.componentRef.setInput('sources', [{ sourceAcronym: 'NEW' }]);
          if (transition === 'types') fixture.componentRef.setInput('termTypes', ['class']);
          if (transition === 'destroy') fixture.destroy();
          else fixture.detectChanges();
          const after = transition === 'destroy' ? Promise.resolve() : picker['run'](picker['text']());
          const settleOld = () => (failure ? old.reject(new Error('obsolete')) : old.resolve(response('Obsolete')));
          if (oldFirst) {
            settleOld();
            await before;
            if (transition !== 'destroy') expect(picker['searching']()).toBe(true);
          }
          current.resolve(response('Current'));
          await after;
          if (!oldFirst) {
            settleOld();
            await before;
          }
          if (transition !== 'destroy') {
            expect(picker['response']()?.results.class?.collection[0]).toMatchObject({ termLabel: 'Current' });
            expect(picker['error']()).toBeNull();
            expect(picker['searching']()).toBe(false);
          } else expect(picker['response']()).toBeNull();
        });
      }
  }

  const constraints: ControlledTermConfig[] = [
    { sourceType: 'ontology', ontologyId: 'TEST' },
    { sourceType: 'ontology-term', sourceId: 'urn:term' },
    { sourceType: 'ontology-branch', branchRootId: 'urn:branch', searchDepth: 0 },
    { sourceType: 'value-set', sourceId: 'urn:values' },
    {
      sourceType: 'ontology-property',
      sourceId: 'urn:property',
      ontologyId: 'TEST',
      sourceName: 'Property',
      propertyKind: 'object',
    },
  ];
  for (const constraint of constraints)
    for (const defect of ['identifier', 'version', 'duplicate', 'disabled', 'maximum']) {
      it(`reports and recovers ${constraint.sourceType}/${defect} without mutating the host`, () => {
        const { fixture, picker } = setup();
        const bad = { ...constraint, ...(defect === 'version' ? { version: { id: '' } } : {}) };
        if (defect === 'identifier') {
          if (bad.sourceType === 'ontology') bad.ontologyId = '';
          else if (bad.sourceType === 'ontology-branch') bad.branchRootId = 'bad iri';
          else bad.sourceId = 'bad iri';
        }
        const incoming = {
          constraints: defect === 'duplicate' || defect === 'maximum' ? [bad, { ...bad }] : [bad],
          actions: [],
        };
        const saved = structuredClone(incoming);
        fixture.componentRef.setInput('constraintSet', incoming);
        if (defect === 'disabled') fixture.componentRef.setInput('termTypes', []);
        if (defect === 'maximum') fixture.componentRef.setInput('maximumTerms', 1);
        fixture.detectChanges();
        const emitted = vi.fn();
        picker.constraintsSelected.subscribe(emitted);
        expect(picker.validationReport().length).toBeGreaterThan(0);
        picker['applyConstraints']();
        expect(emitted).not.toHaveBeenCalled();
        while (picker['draft']().constraints.length) picker['removeConstraint'](0);
        fixture.detectChanges();
        expect(picker.validationReport()).toEqual([]);
        picker['applyConstraints']();
        expect(emitted).toHaveBeenCalledWith({ constraints: [], actions: [] });
        expect(incoming).toEqual(saved);
      });
    }

  for (const depth of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    it(`keeps rejected depth ${depth} visible to validation until corrected`, () => {
      const { fixture, picker } = setup();
      fixture.componentRef.setInput('constraintSet', { constraints: [constraints[2]], actions: [] });
      fixture.detectChanges();
      picker['updateBranchDepth'](0, depth);
      expect(picker.validationReport()).toContainEqual({ path: 'constraints/0', row: 1, code: 'depth' });
      picker['updateBranchDepth'](0, 3);
      expect(picker.validationReport()).toEqual([]);
      expect(picker['draft']().constraints[0]).toMatchObject({ searchDepth: 3 });
    });
  }

  for (const incoming of [
    null,
    {},
    { constraints: null, actions: [] },
    { constraints: [null], actions: [] },
    { constraints: [], actions: [null] },
    { constraints: [], actions: [{ action: 'move', to: -1 }] },
  ]) {
    it(`renders invalid incoming data and recovers on replacement: ${JSON.stringify(incoming)}`, () => {
      const { fixture, picker } = setup();
      fixture.componentRef.setInput('constraintSet', incoming);
      fixture.detectChanges();
      expect(picker.validationReport().length).toBeGreaterThan(0);
      const emitted = vi.fn();
      picker.constraintsSelected.subscribe(emitted);
      picker['applyConstraints']();
      expect(emitted).not.toHaveBeenCalled();
      fixture.componentRef.setInput('constraintSet', { constraints: [constraints[0]], actions: [] });
      fixture.detectChanges();
      expect(picker.validationReport()).toEqual([]);
      picker['applyConstraints']();
      expect(emitted).toHaveBeenCalledOnce();
    });
  }

  for (const failure of [false, true])
    for (const depth of [1, 3, 8]) {
      it(`does not install a depth-${depth} hierarchy from another release, failed=${failure}`, async () => {
        const { picker } = setup();
        const old = deferred<HierarchyOutcome>();
        client.hierarchy.mockReturnValueOnce(old.promise);
        picker['pinned'].set(new Map([['TEST', { id: 'old' }]]));
        const before = picker['readHierarchy'](term);
        picker['pinned'].set(new Map([['TEST', { id: 'new' }]]));
        const currentTree = {
          ...tree,
          path: Array.from({ length: depth }, (_, i) => ({ termIri: `urn:parent:${i}`, termLabel: `Parent ${i}` })),
        };
        client.hierarchy.mockResolvedValueOnce({ kind: 'found', hierarchy: currentTree });
        await picker['readHierarchy'](term);
        if (failure) old.reject(new Error('old hierarchy'));
        else old.resolve({ kind: 'found', hierarchy: { ...tree, termLabel: 'Obsolete' } });
        await before;
        expect(picker['hierarchyOf'](term)).toEqual(currentTree);
        expect([...picker['nodes']().values()]).toEqual([currentTree]);
      });
    }

  for (const kind of ['absent', 'failed'] as const) {
    it(`blocks an unverified pinned term and can retry ${kind}`, async () => {
      const { picker } = setup();
      picker['pinned'].set(new Map([['TEST', { id: 'release' }]]));
      expect(picker['unrecordable'](term)).not.toBeNull();
      client.hierarchy.mockResolvedValueOnce({ kind, reason: 'cannot verify' });
      await picker['readHierarchy'](term);
      expect(picker['unrecordable'](term)).toBe('cannot verify');
      // Failed reads are retryable; absence requires choosing a different release.
      if (kind === 'absent') picker['pinned'].set(new Map([['TEST', { id: 'other' }]]));
      await picker['readHierarchy'](term);
      expect(picker['unrecordable'](term)).toBeNull();
    });
  }

  for (const failure of [false, true])
    for (const operation of ['page', 'candidates', 'history']) {
      it(`keeps a replacement search intact after stale ${operation} ${failure ? 'failure' : 'success'}`, async () => {
        const { fixture, picker } = setup();
        await picker['run']('term');
        const old = deferred<SearchResponse>();
        client.search.mockReturnValueOnce(old.promise);
        const pending =
          operation === 'page'
            ? picker['loadMore']('class')
            : operation === 'candidates'
              ? picker['loadCandidates']()
              : picker['openHistory']('TEST');
        fixture.componentRef.setInput('sources', [{ sourceAcronym: 'NEW' }]);
        fixture.detectChanges();
        const current = deferred<SearchResponse>();
        client.search.mockReturnValueOnce(current.promise);
        const replacement = picker['run']('term');
        if (failure) old.reject(new Error('obsolete'));
        else old.resolve(response('Obsolete'));
        await pending;
        expect(picker['searching']()).toBe(true);
        expect(picker['error']()).toBeNull();
        current.resolve(response('Current'));
        await replacement;
        expect(picker['response']()).toEqual(response('Current'));
        expect(picker['loadingMore']()).toBe(false);
      });
    }

  for (const failed of [false, true])
    it(`allows retry of child paging without duplicates, failed=${failed}`, async () => {
      const { picker } = setup();
      picker['nodes'].set(new Map([[picker['nodeKey']('TEST', 'urn:term'), tree]]));
      const pending = deferred<HierarchyOutcome>();
      client.hierarchy.mockReturnValueOnce(pending.promise);
      const first = picker['showMore']('TEST', 'urn:term');
      await picker['showMore']('TEST', 'urn:term');
      expect(client.hierarchy).toHaveBeenCalledTimes(1);
      const child = { termIri: 'urn:child', termLabel: 'Child', hasChildren: false, descendantCount: 0 };
      if (failed) pending.reject(new Error('offline'));
      else pending.resolve({ kind: 'found', hierarchy: { ...tree, children: [child] } });
      await first;
      if (failed) {
        client.hierarchy.mockResolvedValueOnce({ kind: 'found', hierarchy: { ...tree, children: [child] } });
        await picker['showMore']('TEST', 'urn:term');
      }
      expect(picker['nodes']().get(picker['nodeKey']('TEST', 'urn:term'))?.children).toEqual([child]);
    });

  for (const bad of [
    null,
    {},
    { results: {} },
    { ...response('x'), sources: null },
    { ...response('x'), results: { class: { totalCount: 1, collection: [null] } } },
    { ...response('x'), results: { class: { totalCount: 1, collection: [{ ...term, termIri: 'bad iri' }] } } },
  ]) {
    it(`rejects malformed server envelope ${JSON.stringify(bad)}`, () => {
      expect(validSearchResponse(bad)).toBe(false);
      expect(validSearchResponse(response('valid'))).toBe(true);
    });
  }
  for (const bad of [
    null,
    {},
    { ...tree, sourceAcronym: 'OTHER' },
    { ...tree, termIri: 'urn:other' },
    { ...tree, path: [null] },
    { ...tree, children: [null] },
  ]) {
    it(`rejects malformed or misaddressed tree ${JSON.stringify(bad)}`, () => {
      expect(validHierarchy(bad, 'TEST', 'urn:term')).toBe(false);
      expect(validHierarchy(tree, 'TEST', 'urn:term')).toBe(true);
    });
  }
  for (const iri of ['', 'bare', '/relative', 'http://bad iri', 'urn:bad%ZZ', 'urn:bad<value>'])
    it(`refuses invalid identifier ${iri}`, () => {
      expect(validIri(iri)).toBe(false);
      expect(validIri('urn:échantillon:one')).toBe(true);
    });

  for (const depth of [1, 3, 8, 30])
    it(`bounds cyclic and repeated hierarchy paths at depth ${depth}`, () => {
      const nodes = new Map<string, Hierarchy>();
      for (let i = 0; i < depth; i++)
        nodes.set(`urn:${i}`, {
          ...tree,
          termIri: `urn:${i}`,
          children: [{ termIri: `urn:${(i + 1) % depth}`, termLabel: 'Child', hasChildren: true, descendantCount: 10 }],
        });
      const root = nodes.get('urn:0')!;
      expect(hierarchyRows(root, 'TEST', nodes, new Set(nodes.keys()), (iri) => iri)).toHaveLength(depth);
    });
});
