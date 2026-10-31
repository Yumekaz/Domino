import { describe, expect, it } from "vitest";
import {
  answerSchema,
  canonicalGithubUrl,
  graphQuerySchema,
  graphSchema,
  impactRequestSchema,
  impactSchema,
} from "../../packages/contracts/src/index.ts";

const uuid = "1fb0a804-339c-448e-af4a-e937e8e0e3ad";
const sha = "0123456789abcdef0123456789abcdef01234567";
describe("API contract boundaries", () => {
  it("accepts only plain github.com repository URLs", () => {
    expect(canonicalGithubUrl("https://github.com/example/repo.git")).toBe(
      "https://github.com/example/repo",
    );
    for (const value of [
      "http://github.com/example/repo",
      "https://github.com.evil.test/example/repo",
      "https://user:pass@github.com/example/repo",
      "https://github.com/example/repo?redirect=1",
      "https://github.com/example/repo/more",
      "file:///etc/passwd",
    ])
      expect(canonicalGithubUrl(value)).toBeUndefined();
  });
  it("parses repeated graph filters and false without treating the string as truthy", () => {
    const result = graphQuerySchema.parse({
      snapshotId: uuid,
      entityId: uuid,
      depth: "3",
      includeInferred: "false",
      nodeKinds: ["File", "Issue"],
    });
    expect(result).toMatchObject({
      depth: 3,
      includeInferred: false,
      nodeKinds: ["File", "Issue"],
    });
    expect(
      graphQuerySchema.safeParse({
        snapshotId: uuid,
        entityId: uuid,
        depth: "4",
      }).success,
    ).toBe(false);
  });
  it("rejects dangling graph edges and invalid citations", () => {
    expect(
      graphSchema.safeParse({
        nodes: [],
        edges: [
          {
            id: uuid,
            source: uuid,
            target: uuid,
            kind: "IMPORTS",
            verification: "observed",
            snapshotSha: sha,
          },
        ],
        truncated: false,
        warnings: [],
        snapshotSha: sha,
      }).success,
    ).toBe(false);
    expect(
      answerSchema.safeParse({
        answer: "A reason",
        status: "supported",
        claims: [
          { text: "A reason", evidenceIds: [uuid], support: "documented" },
        ],
        sources: [],
        unknowns: [],
        warnings: [],
        snapshotSha: sha,
        errorCode: null,
        searchAvailable: true,
      }).success,
    ).toBe(false);
  });
  it("rejects ambiguous, unsafe or oversized change requests", () => {
    expect(
      impactRequestSchema.safeParse({
        snapshotId: uuid,
        changedFiles: ["../secret"],
      }).success,
    ).toBe(false);
    expect(
      impactRequestSchema.safeParse({
        snapshotId: uuid,
        changedFiles: ["src/a.ts"],
        proposedDiff: "diff",
      }).success,
    ).toBe(false);
    expect(
      impactRequestSchema.safeParse({
        snapshotId: uuid,
        changedFiles: ["src/a.ts"],
      }).success,
    ).toBe(true);
  });
  it("requires complete structural paths and observed sample metadata for co-change", () => {
    const base = {
      changedFiles: ["src/a.ts"],
      snapshotSha: sha,
      warnings: [],
      truncated: false,
    };
    const record = {
      file: "src/b.ts",
      signal: "static_reverse_dependency",
      depth: 2,
      path: ["src/b.ts", "src/a.ts"],
      impact: "possible",
      explanation: "import",
      evidence: [],
    };
    expect(
      impactSchema.safeParse({ ...base, affected: [record] }).success,
    ).toBe(false);
    expect(
      impactSchema.safeParse({ ...base, affected: [{ ...record, depth: 1 }] })
        .success,
    ).toBe(true);
    expect(
      impactSchema.safeParse({
        ...base,
        affected: [{ ...record, signal: "historically_coupled" }],
      }).success,
    ).toBe(false);
    const cochange = {
      ...record,
      signal: "historically_coupled",
      cochange: {
        sampleSize: 4,
        targetCommits: 2,
        windowFrom: null,
        windowTo: null,
      },
    };
    expect(
      impactSchema.safeParse({ ...base, affected: [cochange] }).success,
    ).toBe(false);
    expect(
      impactSchema.safeParse({
        ...base,
        affected: [
          { ...cochange, cochange: { ...cochange.cochange, sampleSize: 2 } },
        ],
      }).success,
    ).toBe(true);
  });
});
