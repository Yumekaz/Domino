import type {
  BuildEvidencePackInput,
  EvidencePack,
  EvidenceRetriever,
} from "../../core/evidence/src/types.ts";
import type { HistoryStore } from "../../core/history/src/ports.ts";
import type {
  EntityKind,
  EntityRecord,
  EvidenceChunkRecord,
  EvidenceSearchHit,
  RelationshipRecord,
} from "../../core/history/src/types.ts";
import { HistoryError } from "../../core/history/src/errors.ts";

export interface DefaultEvidenceRetrieverOptions {
  store: HistoryStore;
  clock?: { isoNow(): string };
}

export class DefaultEvidenceRetriever implements EvidenceRetriever {
  private readonly options: DefaultEvidenceRetrieverOptions;

  constructor(options: DefaultEvidenceRetrieverOptions) {
    this.options = options;
  }

  async buildPack(input: BuildEvidencePackInput): Promise<EvidencePack> {
    if (input.question.trim().length === 0) {
      throw new HistoryError("INVALID_REQUEST", "Question must not be empty");
    }
    const snapshot = await this.options.store.getSnapshot(input.repoId, input.snapshotId);
    if (snapshot === null) {
      throw new HistoryError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", {
        details: { snapshotId: input.snapshotId },
      });
    }
    if (snapshot.status !== "ready" && snapshot.status !== "partial") {
      throw new HistoryError("INVALID_REQUEST", "Snapshot is not published for retrieval", {
        details: { status: snapshot.status },
      });
    }
    const maxChunks = Math.max(1, Math.min(50, input.maxChunks));
    const maxNeighbors = Math.max(0, Math.min(20, input.maxNeighbors));
    const maxNeighborChunks = Math.max(0, Math.min(3, input.maxNeighborChunks));
    const warnings: string[] = [...snapshot.coverage.warnings];

    const generalHits = await this.options.store.searchEvidence({
      repoId: input.repoId,
      snapshotId: input.snapshotId,
      query: input.question,
      limit: Math.min(100, Math.max(24, maxChunks * 4)),
    });
    const discussionKinds: EntityKind[] = [
      "Issue",
      "PullRequest",
      "DiscussionComment",
      "Document",
      "Commit",
    ];
    const discussionHits = await this.options.store.searchEvidence({
      repoId: input.repoId,
      snapshotId: input.snapshotId,
      query: input.question,
      limit: maxChunks,
      entityKinds: discussionKinds,
    });
    let searchHits = dedupeHits([...generalHits, ...discussionHits]);

    let focusEntity: EntityRecord | null = null;
    if (input.focusEntityId !== undefined) {
      focusEntity = await this.options.store.getEntity(input.repoId, input.focusEntityId);
      if (focusEntity === null) {
        throw new HistoryError("INVALID_REQUEST", "Focus entity was not found in this repository", {
          details: { focusEntityId: input.focusEntityId },
        });
      }
    }

    // A question such as "why was this code written this way?" refers to
    // the selected record, not every source matching common words like "code".
    // Search hits may seed broader exploration only for non-relative questions.
    const focusRelative = focusEntity !== null && refersToSelection(input.question);
    const seedEntityIds = focusRelative ? [focusEntity.id] : [
      ...new Set([
        ...searchHits.map((hit) => hit.entityId),
        ...(focusEntity === null ? [] : [focusEntity.id]),
      ]),
    ].slice(0, 24);
    const neighborEntities: EntityRecord[] = [];
    const neighborEdges: RelationshipRecord[] = [];
    let graphTruncated = false;
    if (seedEntityIds.length > 0 && maxNeighbors > 0) {
      const neighbors = await this.options.store.getNeighbors({
        repoId: input.repoId,
        snapshotId: input.snapshotId,
        entityIds: seedEntityIds,
        depth: 1,
        maxNodes: seedEntityIds.length + maxNeighbors,
        maxEdges: Math.max(32, seedEntityIds.length * 3),
      });
      for (const entity of neighbors.nodes) {
        if (!seedEntityIds.includes(entity.id)) {
          neighborEntities.push(entity);
        }
      }
      neighborEdges.push(...neighbors.edges);
      graphTruncated = neighbors.truncated;
      if (neighbors.truncated) {
        warnings.push("Graph expansion was truncated; the evidence pack is bounded.");
      }
    }
    if (focusRelative) {
      const allowedEntities = new Set([focusEntity.id, ...neighborEntities.map((entity) => entity.id)]);
      searchHits = searchHits.filter((hit) => allowedEntities.has(hit.entityId));
    }

    const scoreById = new Map<string, { chunk: EvidenceChunkRecord; score: number; reason: string }>();
    for (const hit of searchHits) {
      scoreById.set(hit.id, { chunk: hit, score: hit.score, reason: "search" });
    }
    if (focusEntity !== null) {
      const focusChunks = await this.options.store.getEvidenceForEntities({
        repoId: input.repoId,
        snapshotId: input.snapshotId,
        entityIds: [focusEntity.id],
        limitPerEntity: 3,
      });
      for (const chunk of focusChunks) {
        const existing = scoreById.get(chunk.id);
        if (existing === undefined || existing.reason !== "focus") {
          scoreById.set(chunk.id, {
            chunk,
            score: Math.max(existing?.score ?? 0, 1),
            reason: "focus",
          });
        }
      }
    }
    if (neighborEntities.length > 0 && maxNeighborChunks > 0) {
      const neighborChunks = await this.options.store.getEvidenceForEntities({
        repoId: input.repoId,
        snapshotId: input.snapshotId,
        entityIds: neighborEntities.map((entity) => entity.id),
        limitPerEntity: maxNeighborChunks,
      });
      for (const chunk of neighborChunks) {
        if (!scoreById.has(chunk.id)) {
          scoreById.set(chunk.id, { chunk, score: 0.2, reason: "neighbor" });
        }
      }
    }

    const ranked = [...scoreById.values()].sort(
      (left, right) =>
        right.score - left.score ||
        (right.chunk.sourceTimestamp ?? "").localeCompare(left.chunk.sourceTimestamp ?? "") ||
        left.chunk.id.localeCompare(right.chunk.id),
    );
    const selected: typeof ranked = [];
    const selectedIds = new Set<string>();
    const seenKinds = new Set<string>();
    // The user explicitly chose this record. Reserve one slot for its
    // evidence before diversity selection and prompt-budget truncation.
    const focused = ranked.find((entry) => entry.reason === "focus");
    if (focused !== undefined) {
      selected.push(focused);
      selectedIds.add(focused.chunk.id);
      if (focused.chunk.sourceKind !== "file_excerpt") {
        seenKinds.add(focused.chunk.sourceKind);
      }
    }
    // Keep the pack from collapsing into file excerpts when discussion and
    // document evidence is what answers a "why" question.
    for (const entry of ranked) {
      if (selectedIds.has(entry.chunk.id)) {
        continue;
      }
      if (entry.chunk.sourceKind === "file_excerpt") {
        continue;
      }
      if (seenKinds.has(entry.chunk.sourceKind)) {
        continue;
      }
      if (selected.length >= Math.min(6, maxChunks)) {
        break;
      }
      selected.push(entry);
      selectedIds.add(entry.chunk.id);
      seenKinds.add(entry.chunk.sourceKind);
    }
    for (const entry of ranked) {
      if (selected.length >= maxChunks) {
        break;
      }
      if (selectedIds.has(entry.chunk.id)) {
        continue;
      }
      selected.push(entry);
      selectedIds.add(entry.chunk.id);
    }
    const truncated = ranked.length > selected.length;
    const chunks = selected.map((entry) => entry.chunk);
    if (
      chunks.length > 0 &&
      !chunks.some((chunk) => chunk.sourceKind !== "file_excerpt")
    ) {
      warnings.push("The pack contains only file excerpts; no discussion or document text matched.");
    }
    if (searchHits.length === 0 && chunks.length > 0) {
      warnings.push("No direct full-text hits; the pack is limited to focus/neighbor evidence.");
    }
    if (truncated) {
      warnings.push("The evidence pack was truncated at the configured chunk limit.");
    }

    const entities = dedupeEntities([
      ...(focusEntity === null ? [] : [focusEntity]),
      ...neighborEntities,
      ...(await this.options.store.getEntities(
        input.repoId,
        [...new Set(chunks.map((chunk) => chunk.entityId))],
      )),
    ]).slice(0, 32);
    const edges = dedupeEdges(neighborEdges).slice(0, 64);
    const noEvidence = chunks.length === 0;
    return {
      repoId: input.repoId,
      snapshotId: input.snapshotId,
      snapshotSha: snapshot.headSha,
      snapshotStatus: snapshot.status,
      question: input.question,
      focusEntityId: focusEntity?.id ?? null,
      chunks,
      entities,
      edges,
      coverage: snapshot.coverage,
      warnings: [...new Set(warnings)],
      noEvidence,
      truncated: truncated || graphTruncated,
      generatedAt: (this.options.clock ?? { isoNow: () => new Date().toISOString() }).isoNow(),
    };
  }
}

function refersToSelection(question: string): boolean {
  return /\b(?:this|that|selected|current)\s+(?:code|file|record|commit|change|issue|pull\s+request|pr|comment|discussion|document|implementation|function|method|decision)\b/i.test(question);
}

function dedupeEntities(entities: EntityRecord[]): EntityRecord[] {
  const map = new Map<string, EntityRecord>();
  for (const entity of entities) {
    map.set(entity.id, entity);
  }
  return [...map.values()];
}

function dedupeEdges(edges: RelationshipRecord[]): RelationshipRecord[] {
  const map = new Map<string, RelationshipRecord>();
  for (const edge of edges) {
    map.set(edge.id, edge);
  }
  return [...map.values()];
}

function dedupeHits(hits: EvidenceSearchHit[]): EvidenceSearchHit[] {
  const map = new Map<string, EvidenceSearchHit>();
  for (const hit of hits) {
    const existing = map.get(hit.id);
    if (existing === undefined || hit.score > existing.score) {
      map.set(hit.id, hit);
    }
  }
  return [...map.values()];
}
