/** Canonical vocabulary from master spec 6.1; unknown returned kinds remain selectable. */
export const canonicalEntityKinds = [
  'Repository',
  'File',
  'FileRevision',
  'Commit',
  'PullRequest',
  'Issue',
  'DiscussionComment',
  'Document',
  'Decision',
  'Contributor',
  'Module',
] as const;
export function returnedEntityKinds(items: readonly { kind: string }[]) {
  return [...new Set<string>([...canonicalEntityKinds, ...items.map((item) => item.kind)])];
}
