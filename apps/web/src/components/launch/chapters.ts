import { HelpCircle, GitPullRequest, GitCommitHorizontal, FileCode2, Network } from 'lucide-react';
export const chapters = [
  {
    label: 'Issue',
    icon: HelpCircle,
    title: 'Start with a question.',
    copy: 'A reported problem is the first piece of context. Preserve what was asked, when it was raised, and the discussion around it.',
  },
  {
    label: 'Pull request',
    icon: GitPullRequest,
    title: 'Recover the reasoning.',
    copy: 'A linked pull request preserves the proposal and review. Read what was documented, and distinguish it from a later interpretation.',
  },
  {
    label: 'Commit',
    icon: GitCommitHorizontal,
    title: 'Anchor it to a change.',
    copy: 'The recorded commit connects the discussion to an exact revision. Follow its source, rather than relying on someone’s recollection.',
  },
  {
    label: 'File',
    icon: FileCode2,
    title: 'Meet the code.',
    copy: 'See the files that the change actually touched. Join that history to the static relationships at the indexed revision.',
  },
  {
    label: 'Dependents',
    icon: Network,
    title: 'See what could follow.',
    copy: 'Trace direct and transitive import paths. Possible impact is a reason to investigate, with the evidence and blind spots attached.',
  },
];
