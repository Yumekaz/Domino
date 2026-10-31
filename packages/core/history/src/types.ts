export type EntityKind =
  | "Repository"
  | "File"
  | "FileRevision"
  | "Commit"
  | "PullRequest"
  | "Issue"
  | "DiscussionComment"
  | "Document"
  | "Decision"
  | "Contributor"
  | "Module";

export const ENTITY_KINDS: readonly EntityKind[] = [
  "Repository",
  "File",
  "FileRevision",
  "Commit",
  "PullRequest",
  "Issue",
  "DiscussionComment",
  "Document",
  "Decision",
  "Contributor",
  "Module",
];

export type RelationshipKind =
  | "AUTHORED"
  | "MODIFIED"
  | "IN_PR"
  | "CLOSES_ISSUE"
  | "REFERENCES"
  | "COMMENTS_ON"
  | "REVIEWED"
  | "DOCUMENTS"
  | "IMPORTS"
  | "CO_CHANGED_WITH"
  | "DECISION_SUPPORTED_BY"
  | "POSSIBLY_AFFECTS";

export const RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  "AUTHORED",
  "MODIFIED",
  "IN_PR",
  "CLOSES_ISSUE",
  "REFERENCES",
  "COMMENTS_ON",
  "REVIEWED",
  "DOCUMENTS",
  "IMPORTS",
  "CO_CHANGED_WITH",
  "DECISION_SUPPORTED_BY",
  "POSSIBLY_AFFECTS",
];

export type Verification = "observed" | "derived" | "inferred";

export type SnapshotStatus = "pending" | "ready" | "partial" | "failed" | "cancelled";

export type SourceName =
  | "issues"
  | "pullRequests"
  | "comments"
  | "reviews"
  | "commits"
  | "changedFiles"
  | "documents"
  | "timelines"
  | "gitHistory"
  | "retrieval";

export type CoverageStatus = "complete" | "partial" | "failed" | "not_attempted" | "cancelled";

export interface CoverageWindow {
  from: string | null;
  to: string | null;
}

export interface SourceCoverage {
  source: SourceName;
  status: CoverageStatus;
  pagesFetched: number;
  items: number;
  capHit: boolean;
  warnings: string[];
  window: CoverageWindow | null;
  errorCode?: string;
  errorMessage?: string;
}

export interface CoverageReport {
  sources: Partial<Record<SourceName, SourceCoverage>>;
  warnings: string[];
  limits: Record<string, number | string | boolean | null>;
}

export interface RepositoryRecord {
  id: string;
  githubId: number;
  owner: string;
  name: string;
  defaultBranch: string | null;
  visibility: "public";
  htmlUrl: string;
  createdAt: string;
}

export interface SnapshotRecord {
  id: string;
  repoId: string;
  headSha: string;
  branch: string;
  status: SnapshotStatus;
  coverage: CoverageReport;
  toolVersions: Record<string, string>;
  startedAt: string;
  completedAt: string | null;
  errors: string[];
}

export type EntityMetadata = Record<string, unknown>;

export interface EntityRecord {
  id: string;
  repoId: string;
  kind: EntityKind;
  canonicalKey: string;
  title: string | null;
  sourceUrl: string | null;
  metadata: EntityMetadata;
}

export interface RelationshipEvidence {
  excerpt?: string;
  locator?: string;
  lineRange?: [number, number];
  sourceId?: string;
  contentSha?: string;
  metadata?: Record<string, unknown>;
}

export interface RelationshipRecord {
  id: string;
  repoId: string;
  snapshotId: string;
  fromEntityId: string;
  toEntityId: string;
  kind: RelationshipKind;
  verification: Verification;
  sourceUrl: string | null;
  sourceEntityId: string | null;
  extractor: string;
  observedAt: string;
  verificationDetail: string | null;
  evidence: RelationshipEvidence;
}

export interface EvidenceChunkRecord {
  id: string;
  repoId: string;
  snapshotId: string;
  entityId: string;
  entityKind: EntityKind;
  sourceKind: string;
  sourceId: string;
  sourceUrl: string;
  locator: string;
  body: string;
  excerpt: string;
  contentSha: string;
  lineStart: number | null;
  lineEnd: number | null;
  sourceTimestamp: string | null;
  revision: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

export interface EvidenceSearchHit extends EvidenceChunkRecord {
  score: number;
}

export interface GraphNeighborhood {
  nodes: EntityRecord[];
  edges: RelationshipRecord[];
  truncated: boolean;
  warnings: string[];
}

export interface FileContributorRow {
  snapshotId: string;
  path: string;
  contributorKey: string;
  contributorName: string;
  contributorEmail: string;
  observedCommits: number;
  firstTouch: string | null;
  lastTouch: string | null;
  commitShas: string[];
}

export interface GitIdentity {
  key: string;
  name: string;
  email: string;
  rawNames: string[];
  rawEmails: string[];
  mailmapped: boolean;
}

export type GitChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed" | "unknown";

export interface GitFileChange {
  status: GitChangeStatus;
  path: string;
  currentPath: string | null;
  previousPath: string | null;
  similarity: number | null;
  isBinary: boolean;
  blobSha: string | null;
  size: number | null;
}

export interface GitCommitRecord {
  sha: string;
  parents: string[];
  author: GitIdentity;
  committer: GitIdentity;
  authoredAt: string;
  committedAt: string;
  message: string;
  subject: string;
  changes: GitFileChange[];
  isMerge: boolean;
}

export interface GitHistoryCoverage {
  requestedSha: string;
  resolvedSha: string;
  shallow: boolean;
  historyDepthRequested: number;
  commitsAnalyzed: number;
  commitsTruncated: boolean;
  maxCommitsReached: boolean;
  filesAtHead: number;
  filesTruncated: boolean;
  renamesObserved: number;
  renameConflicts: number;
  deletedFilesExcluded: number;
  mailmapPresent: boolean;
  window: CoverageWindow;
  warnings: string[];
}

export interface GitHistoryAnalysis {
  coverage: GitHistoryCoverage;
  commits: GitCommitRecord[];
  contributors: GitIdentity[];
  fileContributions: FileContributorRow[];
  currentFiles: string[];
  possibleAliasGroups: Array<{ normalizedName: string; emails: string[] }>;
}

export interface FileContributionSummary {
  path: string;
  contributors: Array<{
    key: string;
    name: string;
    email: string;
    observedCommits: number;
    firstTouch: string | null;
    lastTouch: string | null;
    commitShas: string[];
  }>;
  observedAuthors: number;
  commitCount: number;
  firstEdit: string | null;
  lastEdit: string | null;
}

export interface CoChangeCoverage {
  commitsAnalyzed: number;
  commitsTouchingTarget: number;
  commitsExcludedOverCap: number;
  observationsTruncated: number;
  maxFilesPerCommit: number;
  minSupport: number;
  window: CoverageWindow;
  excludedPaths: number;
  warnings: string[];
}

export interface CoChangeObservation {
  file: string;
  sharedCommits: number;
  targetCommits: number;
  share: number;
  commitShas: string[];
  window: CoverageWindow;
}

export interface CoChangeResult {
  targetFile: string;
  observations: CoChangeObservation[];
  coverage: CoChangeCoverage;
}

export interface HistoryProgressEvent {
  phase:
    | "validating"
    | "fetching_github"
    | "checking_out_git"
    | "analyzing_history"
    | "normalizing"
    | "linking"
    | "indexing_retrieval"
    | "analyzing_contributors"
    | "publishing";
  message: string;
  processed: number | null;
  total: number | null;
  warnings: string[];
}
