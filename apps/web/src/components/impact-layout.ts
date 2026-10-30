import type { Impact } from '../api/schemas';
export type ImpactDisplayNode = { file: string; level: number; changed: boolean };
export type ImpactDisplayEdge = { source: string; target: string };
/** Layout only. All vertices and segments come from returned static paths. No impact analysis. */
export function returnedImpactPaths(result: Impact) {
  const nodes = new Map<string, ImpactDisplayNode>();
  const edges = new Map<string, ImpactDisplayEdge>();
  const structural = result.affected.filter((a) => a.signal === 'static_reverse_dependency');
  result.changedFiles
    .slice(0, 8)
    .forEach((file) => nodes.set(file, { file, level: 0, changed: true }));
  let limited = structural.length > 12 || result.changedFiles.length > 8;
  structural.slice(0, 12).forEach((affected) => {
    const path = [...affected.path].reverse();
    if (path.length > 8) {
      limited = true;
      return;
    }
    path.forEach((file, index) => {
      const previous = nodes.get(file);
      if (!previous)
        nodes.set(file, { file, level: index, changed: result.changedFiles.includes(file) });
      else if (index < previous.level) previous.level = index;
      if (index > 0) {
        const source = path[index - 1];
        edges.set(JSON.stringify([source, file]), { source, target: file });
      }
    });
  });
  return { nodes: [...nodes.values()], edges: [...edges.values()], limited };
}
