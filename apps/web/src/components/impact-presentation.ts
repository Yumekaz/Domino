import type { Impact } from '../api/schemas';
export type AffectedFile = Impact['affected'][number];
export function hasStructuralPath(item: AffectedFile, changedFiles: readonly string[]) {
  return (
    item.signal === 'static_reverse_dependency' &&
    Number.isInteger(item.depth) &&
    item.depth > 0 &&
    item.path.length === item.depth + 1 &&
    item.path[0] === item.file &&
    changedFiles.includes(item.path[item.path.length - 1])
  );
}
export function impactPresentation(item: AffectedFile, changedFiles: readonly string[]) {
  if (item.signal === 'historically_coupled')
    return {
      kind: 'association' as const,
      marker: '↔',
      label: 'Historical co-change · association',
      badge: 'HISTORICAL ASSOCIATION',
      pathLabel: 'ASSOCIATED FILES · NOT AN IMPORT PATH',
    };
  if (hasStructuralPath(item, changedFiles))
    return {
      kind: 'structural' as const,
      marker: String(item.depth),
      label:
        item.depth === 1
          ? 'Direct dependent · possible impact'
          : 'Transitive dependent · possible impact',
      badge: `${item.depth} HOP${item.depth === 1 ? '' : 'S'} · POSSIBLE IMPACT`,
      pathLabel: 'IMPORT PATH · DEPENDENT → CHANGED FILE',
    };
  return {
    kind: 'unknown' as const,
    marker: '?',
    label:
      item.signal === 'static_reverse_dependency'
        ? 'Structural signal · incomplete path'
        : 'Unclassified signal · inspect evidence',
    badge:
      item.signal === 'static_reverse_dependency'
        ? 'INCOMPLETE STRUCTURAL PROOF'
        : 'UNCLASSIFIED SIGNAL',
    pathLabel: 'RETURNED FILES · DEPENDENCY DIRECTION NOT ESTABLISHED',
  };
}
