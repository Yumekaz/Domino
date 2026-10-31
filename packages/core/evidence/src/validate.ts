import type {
  AskSource,
  ClaimSupport,
  ClaimValidationOutcome,
  EvidencePack,
  RawLlmAnswer,
  RawLlmClaim,
  ValidatedClaim,
} from "./types.ts";
import type { HistoryStore } from "../../history/src/ports.ts";
import { HistoryError } from "../../history/src/errors.ts";
import { clip } from "../../history/src/paths.ts";
import {
  containsAllAnchors,
  containsAllQuotes,
  contentTokens,
  detectInstructionRisk,
  extractAnchors,
  extractIssueNumbers,
  extractQuotedSpans,
  maxSentenceCoverage,
  tokenCoverage,
} from "./text.ts";

export function parseLlmAnswer(text: string, maxClaims = 10): RawLlmAnswer {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new HistoryError("LLM_BAD_OUTPUT", "The model did not return a JSON object", {
      recoverable: true,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1)) as unknown;
  } catch {
    throw new HistoryError("LLM_BAD_OUTPUT", "The model returned malformed JSON", {
      recoverable: true,
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HistoryError("LLM_BAD_OUTPUT", "The model response was not a JSON object", {
      recoverable: true,
    });
  }
  const record = parsed as Record<string, unknown>;
  const status = record.status;
  if (status !== "supported" && status !== "partial" && status !== "not_found") {
    throw new HistoryError("LLM_BAD_OUTPUT", "The model returned an unknown answer status", {
      recoverable: true,
    });
  }
  const answer = typeof record.answer === "string" ? record.answer.trim().slice(0, 4_000) : "";
  const rawClaims = Array.isArray(record.claims) ? record.claims : [];
  if (rawClaims.length > maxClaims) {
    throw new HistoryError("LLM_BAD_OUTPUT", "The model returned too many claims", {
      recoverable: true,
      details: { maxClaims },
    });
  }
  const claims: RawLlmClaim[] = [];
  for (const item of rawClaims) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new HistoryError("LLM_BAD_OUTPUT", "The model returned a malformed claim", {
        recoverable: true,
      });
    }
    const claim = item as Record<string, unknown>;
    const claimText = typeof claim.text === "string" ? claim.text.trim().slice(0, 2_000) : "";
    if (claimText.length === 0) {
      throw new HistoryError("LLM_BAD_OUTPUT", "The model returned an empty claim", {
        recoverable: true,
      });
    }
    const evidenceIds = Array.isArray(claim.evidenceIds)
      ? claim.evidenceIds.filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, 10)
      : [];
    const support = claim.support;
    if (support !== "documented" && support !== "interpretation") {
      throw new HistoryError("LLM_BAD_OUTPUT", "The model returned an invalid claim support label", {
        recoverable: true,
      });
    }
    claims.push({ text: claimText, evidenceIds, support });
  }
  if (status === "not_found" && claims.length > 0) {
    throw new HistoryError(
      "LLM_BAD_OUTPUT",
      "The model returned not_found together with factual claims",
      { recoverable: true },
    );
  }
  const unknowns = Array.isArray(record.unknowns)
    ? record.unknowns
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().slice(0, 500))
        .slice(0, 10)
    : [];
  return {
    status,
    answer,
    claims,
    unknowns,
  };
}

export interface ValidateAnswerInput {
  raw: RawLlmAnswer;
  pack: EvidencePack;
  allowedEvidenceIds: Set<string>;
  store: HistoryStore;
  supportThreshold: number;
  downgradeThreshold: number;
}

export interface ValidationResult {
  status: "supported" | "partial" | "not_found";
  answer: string;
  claims: ValidatedClaim[];
  sources: AskSource[];
  unknowns: string[];
  warnings: string[];
  validation: {
    modelStatus: RawLlmAnswer["status"];
    claims: ClaimValidationOutcome[];
    checkedEvidenceIds: string[];
    rejectedEvidenceIds: string[];
    acceptedClaims: number;
    rejectedClaims: number;
  };
}

export async function validateAnswer(input: ValidateAnswerInput): Promise<ValidationResult> {
  const { raw, pack, allowedEvidenceIds, store } = input;
  const packById = new Map(pack.chunks.map((chunk) => [chunk.id, chunk]));
  const citedIds = [
    ...new Set(raw.claims.flatMap((claim) => claim.evidenceIds)),
  ];
  const storedChunks = await store.getEvidenceChunks(pack.repoId, pack.snapshotId, citedIds);
  const storedById = new Map(storedChunks.map((chunk) => [chunk.id, chunk]));
  const rejectedEvidenceIds = new Set<string>();
  const outcomes: ClaimValidationOutcome[] = [];
  const acceptedClaims: ValidatedClaim[] = [];
  const acceptedEvidenceIds = new Set<string>();
  const warnings: string[] = [];

  for (let index = 0; index < raw.claims.length; index += 1) {
    const claim = raw.claims[index];
    const evidenceIds = [...new Set(claim.evidenceIds)];
    const outcome: ClaimValidationOutcome = {
      claimIndex: index,
      accepted: false,
      support: null,
      citedEvidenceIds: evidenceIds,
      acceptedEvidenceIds: [],
      maxTokenCoverage: 0,
      reason: null,
    };
    outcomes.push(outcome);
    if (evidenceIds.length === 0) {
      outcome.reason = "Claim has no evidence IDs";
      continue;
    }
    const unknown = evidenceIds.filter(
      (id) => !allowedEvidenceIds.has(id) || !packById.has(id) || !storedById.has(id),
    );
    if (unknown.length > 0) {
      for (const id of unknown) {
        rejectedEvidenceIds.add(id);
      }
      outcome.reason = "Claim cites evidence outside the retrieved pack or missing source records";
      continue;
    }
    let consistencyFailure = false;
    for (const id of evidenceIds) {
      const packChunk = packById.get(id);
      const stored = storedById.get(id);
      if (
        packChunk === undefined ||
        stored === undefined ||
        packChunk.contentSha !== stored.contentSha ||
        packChunk.sourceUrl !== stored.sourceUrl ||
        stored.body.trim().length === 0 ||
        stored.locator.trim().length === 0 ||
        !isHttpsUrl(stored.sourceUrl)
      ) {
        consistencyFailure = true;
        rejectedEvidenceIds.add(id);
      }
    }
    if (consistencyFailure) {
      outcome.reason = "Claim cited an invalid or inconsistent source record";
      continue;
    }
    const claimTokens = contentTokens(claim.text);
    if (claimTokens.length < 2) {
      outcome.reason = "Claim is too short to validate against source text";
      continue;
    }
    const bodies = evidenceIds.map((id) => storedById.get(id)?.body ?? "");
    const unionText = bodies.join("\n\n");
    // Token overlap alone can accept a claim that reverses a source by adding
    // "not". This is a narrow safeguard, not semantic entailment checking.
    if (hasExplicitNegation(claim.text) && !hasExplicitNegation(unionText)) {
      outcome.reason = "Claim contains negation absent from its cited source text";
      continue;
    }
    const relationshipFailure = checkRelationshipClaim(claim.text, pack);
    if (relationshipFailure !== null) {
      outcome.reason = relationshipFailure;
      continue;
    }
    const instructionRisk = bodies.some((body) => detectInstructionRisk(body));
    if (instructionRisk) {
      warnings.push(
        `Claim ${index + 1} cited source text containing instruction-like content; it was not promoted beyond an interpretation.`,
      );
    }
    const unionCoverage = tokenCoverage(claimTokens, unionText);
    const sentenceCoverage = Math.max(
      0,
      ...bodies.map((body) => maxSentenceCoverage(claimTokens, body)),
    );
    outcome.maxTokenCoverage = Math.max(unionCoverage, sentenceCoverage);
    const anchors = extractAnchors(claim.text);
    if (!containsAllAnchors(unionText, anchors)) {
      outcome.reason = "Claim references a number or SHA absent from the cited evidence";
      continue;
    }
    const quotes = extractQuotedSpans(claim.text);
    if (!containsAllQuotes(unionText, quotes)) {
      outcome.reason = "Claim contains a quotation absent from the cited evidence";
      continue;
    }

    const documentedSupport =
      sentenceCoverage >= input.supportThreshold || unionCoverage >= 0.85;
    const interpretationSupport =
      sentenceCoverage >= input.downgradeThreshold || unionCoverage >= input.downgradeThreshold;
    let support: ClaimSupport | null = null;
    if (claim.support === "documented") {
      if (documentedSupport && !instructionRisk) {
        support = "documented";
      } else if (interpretationSupport) {
        support = "interpretation";
        if (!instructionRisk) {
          warnings.push(
            `Claim ${index + 1} was downgraded from documented to interpretation: the cited text supports it only partially.`,
          );
        }
      }
    } else if (interpretationSupport) {
      support = "interpretation";
    }
    if (support === null) {
      outcome.reason = "Cited evidence has insufficient conservative token support";
      continue;
    }
    outcome.accepted = true;
    outcome.support = support;
    outcome.acceptedEvidenceIds = evidenceIds;
    acceptedClaims.push({
      text: claim.text,
      evidenceIds,
      support,
    });
    for (const id of evidenceIds) {
      acceptedEvidenceIds.add(id);
    }
  }

  const sources = buildSources([...acceptedEvidenceIds], packById);
  const checkedEvidenceIds = [...new Set(citedIds)];
  const validation = {
    modelStatus: raw.status,
    claims: outcomes,
    checkedEvidenceIds,
    rejectedEvidenceIds: [...rejectedEvidenceIds].sort(),
    acceptedClaims: acceptedClaims.length,
    rejectedClaims: outcomes.filter((outcome) => !outcome.accepted).length,
  };

  if (raw.status === "not_found") {
    return {
      status: "not_found",
      answer: "No supporting project history found.",
      claims: [],
      sources: [],
      unknowns: raw.unknowns,
      warnings,
      validation,
    };
  }
  if (acceptedClaims.length === 0) {
    return {
      status: "not_found",
      answer: "No supporting project history found.",
      claims: [],
      sources: [],
      unknowns: [
        ...raw.unknowns,
        "The generated answer had no claim that passed citation and support validation.",
      ],
      warnings,
      validation,
    };
  }
  if (outcomes.some((outcome) => !outcome.accepted)) {
    const withheld = outcomes.filter((outcome) => !outcome.accepted).length;
    return {
      status: "partial",
      answer: acceptedClaims.map((claim) => claim.text).join(" "),
      claims: acceptedClaims,
      sources,
      unknowns: [
        ...raw.unknowns,
        `${withheld} generated claim(s) were withheld because their cited evidence did not support them.`,
      ],
      warnings,
      validation,
    };
  }
  return {
    status: raw.status,
    // Only claims pass source validation; the model's separate summary can
    // contain additional, uncited statements even when every claim passes.
    answer: acceptedClaims.map((claim) => claim.text).join(" "),
    claims: acceptedClaims,
    sources,
    unknowns: raw.unknowns,
    warnings,
    validation,
  };
}

function hasExplicitNegation(text: string): boolean {
  return /\b(?:not|no|never|neither|nor|without|cannot)\b|\b\w+n['’]t\b|\bnon[-‐‑]\w+/i.test(text);
}

function buildSources(ids: string[], packById: Map<string, EvidencePack["chunks"][number]>): AskSource[] {
  const sources: AskSource[] = [];
  for (const id of ids) {
    const chunk = packById.get(id);
    if (chunk === undefined) {
      continue;
    }
    const title =
      typeof chunk.metadata.title === "string" && chunk.metadata.title.length > 0
        ? chunk.metadata.title
        : chunk.locator;
    sources.push({
      id: chunk.id,
      entityId: chunk.entityId,
      kind: chunk.sourceKind,
      sourceId: chunk.sourceId,
      url: chunk.sourceUrl,
      locator: chunk.locator,
      title,
      // Search snippets can omit the sentence supporting a claim. Return the
      // bounded source text supplied to the model so it can be inspected.
      excerpt: clip(chunk.body, 2_400),
      timestamp: chunk.sourceTimestamp,
      revision: chunk.revision,
      contentSha: chunk.contentSha,
    });
  }
  return sources.sort((left, right) => left.id.localeCompare(right.id));
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function checkRelationshipClaim(claimText: string, pack: EvidencePack): string | null {
  const numbers = extractIssueNumbers(claimText);
  const closingVerb = /\b(close[sd]?|closing|fix(es|ed)?|resolv(e[sd])?)\b/i.test(claimText);
  if (closingVerb && numbers.length > 0) {
    const closingEdges = pack.edges.filter((edge) => edge.kind === "CLOSES_ISSUE");
    const matching = closingEdges.filter((edge) => {
      const from = entityNumber(pack, edge.fromEntityId);
      const to = entityNumber(pack, edge.toEntityId);
      if (numbers.length >= 2) {
        return numbers.includes(from ?? -1) && numbers.includes(to ?? -1);
      }
      return numbers.includes(from ?? -1) || numbers.includes(to ?? -1);
    });
    if (matching.length === 0) {
      return "Claim asserts a closing relationship that is not present in stored graph edges";
    }
  }
  const mergedVerb = /\b(merged|merge)\b/i.test(claimText);
  if (mergedVerb && numbers.length > 0) {
    const mergedNumbers = pack.entities
      .filter(
        (entity) =>
          entity.kind === "PullRequest" &&
          typeof entity.metadata.mergedAt === "string" &&
          entity.metadata.mergedAt.length > 0,
      )
      .map((entity) => entityNumber(pack, entity.id))
      .filter((value): value is number => value !== null);
    if (!numbers.every((number) => mergedNumbers.includes(number))) {
      return "Claim asserts a merge state that is not present in stored pull-request records";
    }
  }
  const inPrVerb = /\b(belongs? to|part of|included in)\b/i.test(claimText);
  const sha = claimText.match(/\b[0-9a-f]{40}\b/i)?.[0]?.toLowerCase();
  if (inPrVerb && sha !== undefined && numbers.length > 0) {
    const matching = pack.edges.filter(
      (edge) =>
        edge.kind === "IN_PR" &&
        pack.entities.some(
          (entity) =>
            entity.id === edge.fromEntityId &&
            entity.kind === "Commit" &&
            String(entity.metadata.sha ?? "").toLowerCase() === sha,
        ) &&
        numbers.includes(entityNumber(pack, edge.toEntityId) ?? -1),
    );
    if (matching.length === 0) {
      return "Claim asserts a commit-to-PR relationship that is not present in stored graph edges";
    }
  }
  return null;
}

function entityNumber(pack: EvidencePack, entityId: string): number | null {
  const entity = pack.entities.find((item) => item.id === entityId);
  const value = entity?.metadata.number;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
