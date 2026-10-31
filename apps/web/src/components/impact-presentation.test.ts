import { describe, expect, it } from 'vitest';
import { hasStructuralPath, impactPresentation, type AffectedFile } from './impact-presentation';
import { returnedEntityKinds, canonicalEntityKinds } from '../api/entity-kinds';
const item: AffectedFile = {
  file: 'b.ts',
  signal: 'static_reverse_dependency',
  depth: 1,
  path: ['b.ts', 'a.ts'],
  impact: 'possible',
  explanation: 'Reported import',
  evidence: [],
};
describe('Impact display truthfulness', () => {
  it('labels a complete returned dependency path', () =>
    expect(impactPresentation(item, ['a.ts']).kind).toBe('structural'));
  it('never classifies an unknown signal as a direct dependency just because depth is one', () =>
    expect(impactPresentation({ ...item, signal: 'unknown' }, ['a.ts'])).toMatchObject({
      kind: 'unknown',
      marker: '?',
    }));
  it('keeps historical association separate even when it contains a path', () =>
    expect(impactPresentation({ ...item, signal: 'historically_coupled' }, ['a.ts']).kind).toBe(
      'association',
    ));
  it('withholds structural path treatment for inconsistent depth, source, or changed file', () => {
    expect(hasStructuralPath({ ...item, depth: 2 }, ['a.ts'])).toBe(false);
    expect(hasStructuralPath({ ...item, path: ['a.ts', 'b.ts'] }, ['a.ts'])).toBe(false);
    expect(hasStructuralPath(item, ['another.ts'])).toBe(false);
    expect(hasStructuralPath({ ...item, path: [] }, ['a.ts'])).toBe(false);
  });
});
describe('Canonical record filters', () => {
  it('includes canonical types and preserves additional returned types without duplicate choices', () => {
    const kinds = returnedEntityKinds([{ kind: 'ADR' }, { kind: 'File' }, { kind: 'ADR' }]);
    expect(kinds).toEqual([...canonicalEntityKinds, 'ADR']);
    expect(kinds).toContain('Decision');
    expect(kinds).toContain('DiscussionComment');
    expect(kinds).toContain('Module');
  });
});
