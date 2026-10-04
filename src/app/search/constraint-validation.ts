import { ControlledTermSet } from './constraint-set';
import { constraintIdentity } from './constraint-presentation';
import { SearchKind } from './search-types';

export interface ConstraintIssue {
  path: string;
  code: string;
  row?: number;
}
const kinds: Record<string, SearchKind> = {
  ontology: 'ontology',
  'ontology-branch': 'branch',
  'ontology-term': 'class',
  'value-set': 'valueSet',
  'ontology-property': 'property',
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** Absolute IRIs, including URNs and Unicode; spaces, controls and malformed escapes are not identifiers. */
export const validIri = (value: unknown): value is string =>
  text(value) &&
  /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(value) &&
  !/[<>"{}|\\^`]/.test(value) &&
  [...value].every((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127) &&
  !/%(?![\da-f]{2})/i.test(value);

export function validateConstraints(
  value: unknown,
  maximum?: number,
  types?: readonly SearchKind[],
): readonly ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];
  if (!record(value) || !Array.isArray(value['constraints']) || !Array.isArray(value['actions']))
    return [{ path: '', code: 'shape' }];
  if (maximum !== undefined && value['constraints'].length > maximum)
    issues.push({ path: 'constraints', code: 'maximum' });
  const identities = new Set<string>();
  value['constraints'].forEach((constraint: unknown, index: number) => {
    const add = (code: string) => issues.push({ path: `constraints/${index}`, row: index + 1, code });
    if (!record(constraint) || !text(constraint['sourceType']) || !Object.hasOwn(kinds, constraint['sourceType'])) {
      add('kind');
      return;
    }
    const c = constraint;
    if (types && !types.includes(kinds[c['sourceType'] as string])) add('disabled');
    const identifier =
      c['sourceType'] === 'ontology'
        ? text(c['ontologyId'])
        : validIri(c['sourceType'] === 'ontology-branch' ? c['branchRootId'] : c['sourceId']);
    if (!identifier) add('identifier');
    if (c['version'] !== undefined && (!record(c['version']) || !text(c['version']['id']))) add('version');
    if (
      c['sourceType'] === 'ontology-branch' &&
      c['searchDepth'] !== undefined &&
      (!Number.isSafeInteger(c['searchDepth']) || (c['searchDepth'] as number) < 0)
    )
      add('depth');
    if (
      c['sourceType'] === 'ontology-property' &&
      (!text(c['ontologyId']) || !['object', 'datatype', 'annotation'].includes(c['propertyKind'] as string))
    )
      add('property');
    const identity = constraintIdentity(c as unknown as ControlledTermSet['constraints'][number]);
    if (identities.has(identity)) add('duplicate');
    identities.add(identity);
  });
  value['actions'].forEach((action: unknown, index: number) => {
    if (
      !record(action) ||
      !['delete', 'move'].includes(action['action'] as string) ||
      !validIri(action['termUri']) ||
      !text(action['sourceUri']) ||
      !text(action['source']) ||
      !['OntologyClass', 'Value'].includes(action['type'] as string) ||
      (action['action'] === 'move' && (!Number.isSafeInteger(action['to']) || (action['to'] as number) < 0))
    ) {
      issues.push({ path: `actions/${index}`, row: index + 1, code: 'action' });
    }
  });
  return issues;
}

/** A safe projection for rendering only. Validation and emission always use the unmodified draft. */
export function displayConstraints(value: unknown): ControlledTermSet {
  if (!record(value)) return { constraints: [], actions: [] };
  return {
    constraints: (Array.isArray(value['constraints']) ? value['constraints'] : []).map((c) => (record(c) ? c : {})),
    actions: (Array.isArray(value['actions']) ? value['actions'] : []).map((a) => (record(a) ? a : {})),
  } as unknown as ControlledTermSet;
}
