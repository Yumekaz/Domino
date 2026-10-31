import type { EntityKind, EvidenceChunkRecord } from "../../core/history/src/types.ts";
import { evidenceChunkId } from "../../core/history/src/ids.ts";
import { clip, contentSha256 } from "../../core/history/src/paths.ts";

export interface ChunkSourceInput {
  repoId: string;
  snapshotId: string;
  entityId: string;
  entityKind: EntityKind;
  sourceKind: string;
  sourceId: string;
  sourceUrl: string;
  title: string;
  body: string;
  locatorPrefix: string;
  sourceTimestamp: string | null;
  revision: string;
  metadata?: Record<string, unknown>;
}

export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
  maxChunks: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 900,
  overlapChars: 120,
  maxChunks: 20,
};

export interface TextChunk {
  text: string;
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

export function chunkText(input: string, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const config = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const maxChars = Math.max(100, config.maxChars);
  const overlapChars = Math.min(Math.max(0, config.overlapChars), Math.floor(maxChars / 3));
  const maxChunks = Math.max(1, config.maxChunks);
  if (input.length === 0) {
    return [];
  }
  const lineStarts = [0];
  for (let index = 0; index < input.length; index += 1) {
    if (input.charCodeAt(index) === 10) {
      lineStarts.push(index + 1);
    }
  }
  const lineIndexAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (lineStarts[middle] <= offset) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return Math.max(0, high);
  };

  const chunks: TextChunk[] = [];
  let startChar = 0;
  while (startChar < input.length && chunks.length < maxChunks) {
    let endChar = Math.min(input.length, startChar + maxChars);
    if (endChar < input.length) {
      const newline = input.lastIndexOf("\n", endChar - 1);
      if (newline > startChar + Math.floor(maxChars / 2)) {
        endChar = newline + 1;
      } else {
        const whitespace = input.lastIndexOf(" ", endChar - 1);
        if (whitespace > startChar + Math.floor(maxChars / 2)) {
          endChar = whitespace + 1;
        }
      }
    }
    if (endChar <= startChar) {
      endChar = Math.min(input.length, startChar + maxChars);
    }
    const text = input.slice(startChar, endChar);
    chunks.push({
      text,
      lineStart: lineIndexAt(startChar) + 1,
      lineEnd: lineIndexAt(Math.max(startChar, endChar - 1)) + 1,
      charStart: startChar,
      charEnd: endChar,
    });
    if (endChar >= input.length) {
      break;
    }
    const nextStart = endChar - overlapChars;
    startChar = nextStart > startChar ? nextStart : endChar;
  }
  return chunks;
}

export function chunkSource(
  input: ChunkSourceInput,
  options: Partial<ChunkOptions> = {},
): EvidenceChunkRecord[] {
  let url: URL;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    throw new Error(`Invalid evidence source URL for ${input.sourceId}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Evidence source URL must be HTTPS for ${input.sourceId}`);
  }
  if (input.revision.trim().length === 0) {
    throw new Error(`Evidence source ${input.sourceId} has no revision`);
  }
  const text = input.body.length > 0 ? input.body : input.title;
  if (text.trim().length === 0) {
    return [];
  }
  const config = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const textChunks = chunkText(text, config);
  const chunks: EvidenceChunkRecord[] = [];
  for (let index = 0; index < textChunks.length; index += 1) {
    const textChunk = textChunks[index];
    const contentSha = contentSha256(textChunk.text);
    const locator =
      textChunk.lineStart === textChunk.lineEnd
        ? `${input.locatorPrefix} line ${textChunk.lineStart}`
        : `${input.locatorPrefix} lines ${textChunk.lineStart}-${textChunk.lineEnd}`;
    const isLast = index === textChunks.length - 1;
    const truncated = isLast && text.length > 0 && textChunk.charEnd < text.length;
    chunks.push({
      id: evidenceChunkId(input.entityId, index, contentSha),
      repoId: input.repoId,
      snapshotId: input.snapshotId,
      entityId: input.entityId,
      entityKind: input.entityKind,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceUrl: url.toString(),
      locator,
      body: textChunk.text,
      excerpt: clip(textChunk.text.replace(/\s+/g, " ").trim(), 280),
      contentSha,
      lineStart: textChunk.lineStart,
      lineEnd: textChunk.lineEnd,
      sourceTimestamp: input.sourceTimestamp,
      revision: input.revision,
      chunkIndex: index,
      metadata: {
        ...(input.metadata ?? {}),
        title: input.title,
        charStart: textChunk.charStart,
        charEnd: textChunk.charEnd,
        sourceTruncated: truncated,
      },
    });
  }
  return chunks;
}
