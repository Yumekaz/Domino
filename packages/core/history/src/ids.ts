import { createHash } from "node:crypto";

const ROOT_NAMESPACE = "4c2f8d1a-6e1b-5c4a-9f6d-3a2b1c0d9e8f";

function parseUuid(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  return Buffer.from(hex, "hex");
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20, 32)}`;
}

export function uuidV5(name: string, namespace: string = ROOT_NAMESPACE): string {
  const hash = createHash("sha1")
    .update(parseUuid(namespace))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export const NAMESPACES = {
  repository: uuidV5("domino:repository"),
  snapshot: uuidV5("domino:snapshot"),
  entity: uuidV5("domino:entity"),
  relationship: uuidV5("domino:relationship"),
  evidence: uuidV5("domino:evidence"),
} as const;

export function canonicalRepositoryKey(githubId: number): string {
  if (!Number.isSafeInteger(githubId) || githubId <= 0) {
    throw new Error(`Invalid GitHub repository id: ${String(githubId)}`);
  }
  return `github:repo:${githubId}`;
}

export function repositoryId(githubId: number): string {
  return uuidV5(canonicalRepositoryKey(githubId), NAMESPACES.repository);
}

export function snapshotId(repoId: string, headSha: string): string {
  if (!/^[0-9a-f]{40}$/i.test(headSha)) {
    throw new Error(`Snapshot head SHA must be full 40-hex: ${headSha}`);
  }
  return uuidV5(`${repoId}|${headSha.toLowerCase()}`, NAMESPACES.snapshot);
}

export function entityId(repoId: string, kind: string, canonicalKey: string): string {
  return uuidV5(`${repoId}|${kind}|${canonicalKey}`, NAMESPACES.entity);
}

export function relationshipId(input: {
  repoId: string;
  snapshotId: string;
  kind: string;
  fromEntityId: string;
  toEntityId: string;
  sourceEntityId: string | null;
}): string {
  return uuidV5(
    [
      input.repoId,
      input.snapshotId,
      input.kind,
      input.fromEntityId,
      input.toEntityId,
      input.sourceEntityId ?? "",
    ].join("|"),
    NAMESPACES.relationship,
  );
}

export function evidenceChunkId(entityIdValue: string, chunkIndex: number, contentSha: string): string {
  return uuidV5(`${entityIdValue}|${chunkIndex}|${contentSha}`, NAMESPACES.evidence);
}

export function canonicalIssueKey(githubId: number): string {
  return `github:issue:${githubId}`;
}

export function canonicalPullRequestKey(githubId: number): string {
  return `github:pr:${githubId}`;
}

export function canonicalCommentKey(githubId: number): string {
  return `github:comment:${githubId}`;
}

export function canonicalReviewKey(githubId: number): string {
  return `github:review:${githubId}`;
}

export function canonicalCommitKey(sha: string): string {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Commit SHA must be full 40-hex: ${sha}`);
  }
  return `git:commit:${sha.toLowerCase()}`;
}

export function canonicalFileKey(normalizedPath: string): string {
  return `file:${normalizedPath}`;
}

export function canonicalFileRevisionKey(normalizedPath: string, sha: string): string {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`File revision SHA must be full 40-hex: ${sha}`);
  }
  return `file-revision:${normalizedPath}@${sha.toLowerCase()}`;
}

export function canonicalDocumentKey(normalizedPath: string, sha: string): string {
  return `document:${normalizedPath}@${sha.toLowerCase()}`;
}

export function normalizeIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeIdentityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function gitContributorKey(input: { name: string; email: string }): string {
  const email = normalizeIdentityEmail(input.email);
  if (email.length > 0) {
    return `git:email:${email}`;
  }
  const name = normalizeIdentityName(input.name);
  if (name.length > 0) {
    return `git:name:${name}`;
  }
  return "git:unknown";
}

export function githubContributorKey(login: string | null): string {
  const normalized = (login ?? "ghost").trim().toLowerCase();
  return `github:user:${normalized}`;
}
