import {
  importResponseSchema,
  type Answer,
} from "../../../../packages/contracts/src/index";

// The web client validates live responses with the accepted shared contracts.
// Only presentation/request-shaping helpers remain in this module.
export {
  analysisSchema,
  answerSchema,
  canonicalGithubUrl,
  detailSchema,
  edgeSchema,
  entityKindSchema,
  entityKinds,
  entitySchema,
  graphQuerySchema,
  graphSchema,
  healthSchema,
  impactRequestSchema,
  impactSchema,
  importResponseSchema,
  jobSchema,
  relationshipKindSchema,
  repositorySchema,
  riskSchema,
  searchSchema,
  snapshotSchema,
  sourceSchema,
  verificationSchema,
} from "../../../../packages/contracts/src/index";
export type {
  Analysis,
  Answer,
  AskRequest,
  Edge,
  Entity,
  Graph,
  Impact,
  ImpactRequest,
  Repository,
  Risk,
  Snapshot,
  Source,
} from "../../../../packages/contracts/src/index";
export { safeSourceUrl } from "./links";

/** Response alias retained for the existing client adapter. */
export const importSchema = importResponseSchema;

/** Request shape for the bounded graph queried by this client. */
export type GraphQuery = {
  snapshotId: string;
  entityId: string;
  depth?: 1 | 2 | 3;
  nodeKinds?: string[];
  relationshipKinds?: string[];
  includeInferred?: boolean;
};

export function hasValidCitations(answer: Answer): boolean {
  const ids = new Set(answer.sources.map((source) => source.id));
  if (answer.status === "not_found" || answer.status === "unavailable")
    return answer.claims.length === 0;
  return (
    answer.claims.length > 0 &&
    answer.claims.every(
      (claim) =>
        claim.evidenceIds.length > 0 &&
        claim.evidenceIds.every((id) => ids.has(id)),
    )
  );
}
