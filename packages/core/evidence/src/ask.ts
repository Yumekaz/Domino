import type {
  AskAuditRecord,
  AskDeps,
  AskRequest,
  AskResult,
  AskLimits,
  EvidencePack,
  RawLlmAnswer,
} from "./types.ts";
import { DEFAULT_ASK_LIMITS } from "./types.ts";
import { buildEvidencePrompt } from "./prompt.ts";
import { parseLlmAnswer, validateAnswer, type ValidationResult } from "./validate.ts";
import { HistoryError, isHistoryError } from "../../history/src/errors.ts";

export async function askQuestion(request: AskRequest, deps: AskDeps): Promise<AskResult> {
  const limits: AskLimits = { ...DEFAULT_ASK_LIMITS, ...(deps.limits ?? {}) };
  const question = request.question.trim();
  if (question.length === 0 || question.length > limits.maxQuestionChars) {
    throw new HistoryError(
      "INVALID_REQUEST",
      `Question must be between 1 and ${limits.maxQuestionChars} characters`,
      { details: { length: question.length, maxQuestionChars: limits.maxQuestionChars } },
    );
  }
  if (request.repoId.trim().length === 0 || request.snapshotId.trim().length === 0) {
    throw new HistoryError("INVALID_REQUEST", "repoId and snapshotId are required");
  }

  const pack = await deps.retriever.buildPack({
    repoId: request.repoId,
    snapshotId: request.snapshotId,
    question,
    ...(request.focusEntityId === undefined ? {} : { focusEntityId: request.focusEntityId }),
    maxChunks: limits.maxChunks,
    maxNeighbors: limits.maxNeighbors,
    maxNeighborChunks: limits.maxNeighborChunks,
  });
  const base = {
    repoId: request.repoId,
    snapshotId: request.snapshotId,
    snapshotSha: pack.snapshotSha,
    searchAvailable: true,
    retrieval: {
      chunksConsidered: pack.chunks.length,
      chunksUsed: 0,
      focusEntityId: pack.focusEntityId,
    },
    generatedAt: deps.clock.isoNow(),
  };

  if (pack.chunks.length === 0 || pack.noEvidence) {
    const result: AskResult = {
      ...base,
      status: "not_found",
      answer: "No supporting project history found.",
      claims: [],
      sources: [],
      unknowns: ["No indexed source text matched the question."],
      warnings: pack.warnings,
      errorCode: null,
      recoverable: false,
      model: null,
      validation: null,
    };
    await audit(deps, result, question, [], null);
    return result;
  }

  const prompt = buildEvidencePrompt(pack, question, limits.maxInputChars);
  if (prompt.includedChunks.length === 0) {
    const result: AskResult = {
      ...base,
      status: "not_found",
      answer: "No supporting project history found.",
      claims: [],
      sources: [],
      unknowns: ["The evidence pack exceeded the prompt budget before any source could be supplied."],
      warnings: pack.warnings,
      errorCode: null,
      recoverable: false,
      model: null,
      validation: null,
    };
    await audit(deps, result, question, [], null);
    return result;
  }

  if (deps.signal?.aborted === true) {
    return await unavailable(
      deps,
      base,
      "LLM_TIMEOUT",
      "Generated synthesis was cancelled; search and original sources remain available.",
      prompt.includedChunks.length,
      [...prompt.includedEvidenceIds],
      null,
      question,
    );
  }

  let response;
  try {
    response = await deps.llm.generate({
      system: prompt.system,
      user: prompt.user,
      maxOutputTokens: limits.maxOutputTokens,
      timeoutMs: limits.timeoutMs,
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });
  } catch (error) {
    const code =
      isHistoryError(error) && error.code.startsWith("LLM_")
        ? error.code
        : "LLM_UNAVAILABLE";
    return await unavailable(
      deps,
      base,
      code,
      "Generated synthesis is unavailable. Evidence search, original sources, graph data and deterministic analysis remain available.",
      prompt.includedChunks.length,
      [...prompt.includedEvidenceIds],
      null,
      question,
    );
  }

  const model = {
    provider: response.provider.length > 0 ? response.provider : deps.llm.provider,
    model: response.model.length > 0 ? response.model : deps.llm.model,
  };

  let raw: RawLlmAnswer;
  try {
    raw = parseLlmAnswer(response.text, limits.maxClaims);
  } catch (error) {
    return await unavailable(
      deps,
      base,
      isHistoryError(error) ? error.code : "LLM_BAD_OUTPUT",
      "The model response could not be validated. No answer was accepted.",
      prompt.includedChunks.length,
      [...prompt.includedEvidenceIds],
      model,
      question,
    );
  }

  let validation: ValidationResult;
  try {
    validation = await validateAnswer({
      raw,
      pack,
      allowedEvidenceIds: prompt.includedEvidenceIds,
      store: deps.store,
      supportThreshold: limits.supportThreshold,
      downgradeThreshold: limits.downgradeThreshold,
    });
  } catch (error) {
    const code = isHistoryError(error) ? error.code : "STORE_FAILED";
    return await unavailable(
      deps,
      base,
      code,
      "The answer could not be validated against stored sources. No answer was accepted.",
      prompt.includedChunks.length,
      [...prompt.includedEvidenceIds],
      model,
      question,
    );
  }

  const result: AskResult = {
    ...base,
    status: validation.status,
    answer: validation.answer,
    claims: validation.claims,
    sources: validation.sources,
    unknowns: validation.unknowns,
    warnings: [
      ...pack.warnings,
      ...validation.warnings,
      ...(prompt.truncated
        ? ["The evidence pack was truncated to the configured prompt budget."]
        : []),
    ],
    errorCode: null,
    recoverable: false,
    model,
    retrieval: {
      ...base.retrieval,
      chunksUsed: prompt.includedChunks.length,
    },
    validation: validation.validation,
  };
  await audit(
    deps,
    result,
    question,
    [...prompt.includedEvidenceIds],
    raw.status,
  );
  return result;
}

async function unavailable(
  deps: AskDeps,
  base: Omit<AskResult, "status" | "answer" | "claims" | "sources" | "unknowns" | "warnings" | "errorCode" | "recoverable" | "model" | "validation">,
  errorCode: string,
  message: string,
  chunksUsed: number,
  promptEvidenceIds: string[],
  model: { provider: string; model: string } | null,
  question: string,
): Promise<AskResult> {
  const result: AskResult = {
    ...base,
    status: "unavailable",
    answer: null,
    claims: [],
    sources: [],
    unknowns: [message],
    warnings: [],
    errorCode,
    recoverable: true,
    searchAvailable: errorCode !== "STORE_FAILED",
    model,
    retrieval: {
      ...base.retrieval,
      chunksUsed,
    },
    validation: null,
  };
  await audit(deps, result, question, promptEvidenceIds, null);
  return result;
}

async function audit(
  deps: AskDeps,
  result: AskResult,
  question: string,
  promptEvidenceIds: string[],
  modelStatus: RawLlmAnswer["status"] | null,
): Promise<void> {
  if (deps.onAudit === undefined) {
    return;
  }
  const record: AskAuditRecord = {
    repoId: result.repoId,
    snapshotId: result.snapshotId,
    question,
    outcome: result.status,
    errorCode: result.errorCode,
    promptEvidenceIds,
    acceptedEvidenceIds: [...new Set(result.claims.flatMap((claim) => claim.evidenceIds))],
    rejectedEvidenceIds: result.validation?.rejectedEvidenceIds ?? [],
    modelStatus: modelStatus ?? result.validation?.modelStatus ?? null,
    timestamp: result.generatedAt,
  };
  try {
    await deps.onAudit(record);
  } catch {
    // Auditing must not change the user-visible answer or leak model details.
  }
}
