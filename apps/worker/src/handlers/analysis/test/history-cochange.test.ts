import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CoChangeConsumerPort } from "../../../../../../packages/core/history/src/ports.ts";
import { createHistoryCoChangeReader } from "../history-cochange.ts";
import { makeCoChange } from "./memory.ts";

describe("B co-change port adapter", () => {
  it("passes repository scope, target and bounded options to B", async () => {
    const calls: unknown[][] = [];
    const port: CoChangeConsumerPort = {
      async getCoChange(repoId, snapshotId, targetFile, options) {
        calls.push([repoId, snapshotId, targetFile, options]);
        return makeCoChange();
      },
    };
    const reader = createHistoryCoChangeReader(port);
    const result = await reader.getCoChange({
      repoId: "repo-1",
      snapshotId: "snapshot-1",
      targetFile: "src/auth.ts",
    });
    assert.equal(result.targetFile, "src/auth.ts");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.[0], "repo-1");
    assert.deepEqual(calls[0]?.[1], "snapshot-1");
    assert.deepEqual(calls[0]?.[2], "src/auth.ts");
    assert.deepEqual(calls[0]?.[3], {
      minSupport: 2,
      maxResults: 20,
      maxFilesPerCommit: 50,
    });
    assert.equal(makeCoChange().targetFile, "src/auth.ts");
  });
});
