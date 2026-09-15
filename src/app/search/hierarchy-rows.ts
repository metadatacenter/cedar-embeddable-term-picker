import type { Hierarchy, HierarchyChild, TreeRow } from './search-types';

/** Project loaded hierarchy state into visible rows, preserving the selected term's ancestry. */
export function hierarchyRows(
  tree: Hierarchy,
  acronym: string,
  nodes: ReadonlyMap<string, Hierarchy | null>,
  openNodes: ReadonlySet<string>,
  nodeKey: (iri: string) => string,
): readonly TreeRow[] {
  const spine = [...(tree.path ?? []).map((step) => step.termIri), tree.termIri];
  const rows: TreeRow[] = [];

  // `known` is what the node's parent already said about it, which is everything a row needs to
  // draw before the node is opened: reading the node to learn whether it can be opened would make
  // a closed tree fetch every branch of itself.
  const walk = (iri: string, label: string, depth: number, onSpine: boolean, known?: HierarchyChild): void => {
    const key = nodeKey(iri);
    // The node's own entry first, and the tree only as the term's opening state: narrowing or
    // extending a node writes to `nodes`, and reading the marked term from `tree` instead left
    // the one node an author is most likely to narrow showing what it held before they did.
    const held = nodes.get(key) ?? (iri === tree.termIri ? tree : undefined);
    const children = held === undefined ? undefined : (held?.children ?? []);
    const open = openNodes.has(key);
    rows.push({
      key,
      iri,
      label,
      depth,
      acronym,
      self: iri === tree.termIri,
      onSpine,
      open,
      loading: open && children === undefined,
      // A node on the spine always has something below it — the next step of the path — whatever
      // else is known about it.
      hasChildren: (onSpine && iri !== tree.termIri) || known?.hasChildren === true || (held?.childCount ?? 0) > 0,
      descendantCount: known?.descendantCount ?? held?.descendantCount ?? 0,
      shown: held?.children?.length ?? 0,
      total: held?.childCount ?? 0,
      definition: known?.definition ?? (iri === tree.termIri ? tree.definition : undefined),
    });
    const next = onSpine ? (spine[spine.indexOf(iri) + 1] ?? null) : null;
    // The path always continues. Closing an ancestor hides what stands beside the path, not the
    // path itself: a tree that collapsed to its root would lose the term the panel is about.
    if (!open) {
      if (next !== null) {
        walk(next, spineLabel(tree, next), depth + 1, true);
      }
      return;
    }
    const seen = new Set<string>();
    for (const child of children ?? []) {
      seen.add(child.termIri);
      walk(child.termIri, child.termLabel, depth + 1, child.termIri === next, child);
    }
    // Also while an opened ancestor's children are still being read.
    if (next !== null && !seen.has(next)) {
      walk(next, spineLabel(tree, next), depth + 1, true);
    }
  };

  const root = spine[0];
  walk(root, spineLabel(tree, root), 0, true);
  return rows;
}

function spineLabel(tree: Hierarchy, iri: string): string {
  if (iri === tree.termIri) {
    return tree.termLabel;
  }
  return (tree.path ?? []).find((step) => step.termIri === iri)?.termLabel ?? iri;
}
