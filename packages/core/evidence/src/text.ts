const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "might",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "maintainer",
  "maintainers",
  "author",
  "authors",
  "commenter",
  "commenters",
  "contributor",
  "contributors",
  "developer",
  "developers",
  "reviewer",
  "reviewers",
  "user",
  "users",
]);

const TOKEN_PATTERN = /#\d+|[\p{L}\p{N}][\p{L}\p{N}_./#@+-]*/gu;

export function contentTokens(text: string): string[] {
  const tokens = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const result: string[] = [];
  for (const rawToken of tokens) {
    const token = normalizeToken(rawToken);
    if (token.length === 0 || STOPWORDS.has(token)) {
      continue;
    }
    if (token.length < 2 && !/\d/.test(token)) {
      continue;
    }
    if (!result.includes(token)) {
      result.push(token);
    }
  }
  return result;
}

function normalizeToken(token: string): string {
  if (/^#\d+$/.test(token) || /^[0-9a-f]{40}$/.test(token)) {
    return token;
  }
  const trimmed = token.replace(/^[._/]+/, "").replace(/[._/#@+-]+$/, "");
  return trimmed.length > 0 ? trimmed : token;
}

export function tokenCoverage(claimTokens: readonly string[], text: string): number {
  if (claimTokens.length === 0) {
    return 0;
  }
  const textTokens = new Set(contentTokens(text));
  let present = 0;
  for (const token of claimTokens) {
    if (textTokens.has(token)) {
      present += 1;
    }
  }
  return present / claimTokens.length;
}

export function sentenceWindows(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const sentences = normalized
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 80);
  const windows: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const one = sentences[index];
    if (one.length <= 4_000) {
      windows.push(one);
    }
    if (index + 1 < sentences.length) {
      const two = `${one} ${sentences[index + 1]}`;
      if (two.length <= 4_000) {
        windows.push(two);
      }
    }
  }
  return windows;
}

export function maxSentenceCoverage(claimTokens: readonly string[], text: string): number {
  let best = 0;
  for (const window of sentenceWindows(text)) {
    const coverage = tokenCoverage(claimTokens, window);
    if (coverage > best) {
      best = coverage;
    }
  }
  return best;
}

export function extractAnchors(text: string): string[] {
  const anchors = new Set<string>();
  for (const match of text.matchAll(/#\d+/g)) {
    anchors.add(match[0].toLowerCase());
  }
  for (const match of text.matchAll(/\b[0-9a-f]{40}\b/gi)) {
    anchors.add(match[0].toLowerCase());
  }
  return [...anchors];
}

export function extractQuotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of text.matchAll(/["“](.{8,300}?)["”]/g)) {
    const span = match[1]?.trim() ?? "";
    if (span.length >= 8) {
      spans.push(span);
    }
  }
  return spans;
}

export function containsAllAnchors(text: string, anchors: readonly string[]): boolean {
  if (anchors.length === 0) {
    return true;
  }
  const lower = text.toLowerCase();
  return anchors.every((anchor) => lower.includes(anchor));
}

export function containsAllQuotes(text: string, quotes: readonly string[]): boolean {
  if (quotes.length === 0) {
    return true;
  }
  const lower = text.toLowerCase();
  return quotes.every((quote) => lower.includes(quote.toLowerCase()));
}

export function detectInstructionRisk(text: string): boolean {
  const patterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i,
    /system\s*prompt/i,
    /\byou\s+are\s+(chatgpt|an?\s+ai|the\s+assistant)\b/i,
    /\b(create|add|insert|mark)\b.{0,60}\b(edge|relationship|verified)\b/i,
    /\boverride\b.{0,40}\b(policy|source|rules)\b/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function extractIssueNumbers(text: string): number[] {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/#(\d{1,9})\b/g)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0) {
      numbers.add(value);
    }
  }
  return [...numbers];
}
