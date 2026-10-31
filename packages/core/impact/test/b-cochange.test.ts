import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCoChangeDataset,
  computeCoChange,
} from "../../../core/history/src/cochange.ts";
import type { GitCommitRecord, GitFileChange, GitIdentity } from "../../../core/history/src/types.ts";
import { adaptCoChangeResults } from "../src/cochange.ts";
import { computeStructuralImpact } from "../src/impact.ts";

const SHA = "a".repeat(40);

const identity: GitIdentity = {
  key: "person@example.test",
  name: "Person",
  email: "person@example.test",
  rawNames: ["Person"],
  rawEmails: ["person@example.test"],
  mailmapped: false,
};

function change(path: string): GitFileChange {
  return {
    status: "modified",
    path,
    currentPath: null,
    previousPath: null,
    similarity: null,
    isBinary: false,
    blobSha: null,
    size: null,
  };
}

function commit(sha: string, authoredAt: string, files: string[]): GitCommitRecord {
  return {
    sha,
    parents: [SHA],
    author: identity,
    committer: identity,
    authoredAt,
    committedAt: authoredAt,
    message: `Change ${files.join(", ")}`,
    subject: `Change ${files.join(", ")}`,
    changes: files.map(change),
    isMerge: false,
  };
}

describe("B's observed co-change feeds C's association signal", () => {
  it("preserves B's real sample, support and observation window", () => {
    const dataset = buildCoChangeDataset([
      commit("1".repeat(40), "2026-01-01T00:00:00Z", ["src/auth.ts", "src/history.ts"]),
      commit("2".repeat(40), "2026-01-02T00:00:00Z", ["src/auth.ts", "src/history.ts"]),
      commit("3".repeat(40), "2026-01-03T00:00:00Z", ["src/auth.ts", "src/unrelated.ts"]),
    ]);
    const result = computeCoChange(dataset, "src/auth.ts", {
      minSupport: 2,
      maxResults: 5,
      maxFilesPerCommit: 50,
      maxSampleCommits: 5,
      window: null,
      includeDocs: true,
    });
    const adapted = adaptCoChangeResults([result], ["src/auth.ts"]);
    assert.equal(adapted.associations.length, 1);
    const association = adapted.associations[0]!;
    assert.equal(association.file, "src/history.ts");
    assert.equal(association.sharedCommits, 2);
    assert.equal(association.targetCommits, 3);
    assert.equal(association.window.from, "2026-01-01T00:00:00Z");
    assert.equal(association.window.to, "2026-01-02T00:00:00Z");
    assert.ok(association.caveats.some((caveat) => caveat.includes("not an import path")));

    const impact = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts"], coChange: [result] },
      [],
    );
    assert.equal(impact.affected.length, 0);
    assert.equal(impact.associations.length, 1);
    assert.equal(impact.coverage.affectedReturned, 0);
  });
});
