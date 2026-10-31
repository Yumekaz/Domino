import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkoutRepository } from "../src/checkout.ts";

const live = process.env.DOMINO_LIVE_GIT === "1";
const YOCTO_MERGE_SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";

test(
  "LIVE: checks out the exact public SHA, exposes read-only data, and cleans up",
  { skip: !live, timeout: 180_000 },
  async () => {
    const handle = await checkoutRepository({
      remoteUrl: "https://github.com/sindresorhus/yocto-queue",
      sha: YOCTO_MERGE_SHA,
      historyDepth: 20,
      maxFiles: 1000,
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 150_000,
    });
    try {
      assert.equal(handle.sha, YOCTO_MERGE_SHA);
      assert.equal(handle.readOnly, true);
      assert.ok(fs.existsSync(handle.directory));
      assert.ok(path.resolve(handle.directory).startsWith(path.resolve(os.tmpdir())));

      const files = await handle.listFiles();
      const index = files.find((file) => file.path === "index.js");
      assert.ok(index);
      assert.match(index.blobSha, /^[0-9a-f]{40}$/);

      const source = await handle.readFile("index.js");
      assert.match(source, /\*\s*drain\(\)/);

      const changes = await handle.getChangeSet(YOCTO_MERGE_SHA);
      const changedPaths = changes.map((change) => change.path);
      assert.ok(changedPaths.includes("index.js"));
      assert.ok(changedPaths.includes("index.d.ts"));
      assert.ok(changedPaths.includes("readme.md"));
      assert.ok(changedPaths.includes("test.js"));

      const commit = await handle.getCommit(YOCTO_MERGE_SHA);
      assert.equal(commit.sha, YOCTO_MERGE_SHA);
      assert.ok(commit.message.includes("drain"));

      const renameMap = await handle.getRenameMap();
      assert.equal(renameMap instanceof Map, true);
      assert.equal(renameMap.get("index.js"), "index.js");

      assert.throws(
        () => fs.appendFileSync(path.join(handle.directory, "index.js"), "tamper"),
        (error: unknown) => error instanceof Error,
      );
      await assert.rejects(
        handle.readFile("../package.json"),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "INVALID_PATH",
      );
      await assert.rejects(
        handle.readFile("C:/Windows/win.ini"),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "INVALID_PATH",
      );
    } finally {
      const directory = handle.directory;
      await handle.dispose();
      assert.equal(fs.existsSync(directory), false);
    }
  },
);

test(
  "LIVE: rejects invalid remotes and times out without leaking workspaces",
  { skip: !live, timeout: 60_000 },
  async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domino-checkout-boundary-"));
    try {
      await assert.rejects(
        checkoutRepository({
          remoteUrl: "file:///tmp/not-github",
          sha: YOCTO_MERGE_SHA,
          tempRoot,
        }),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          ["INVALID_REMOTE", "UNSUPPORTED_REMOTE"].includes(
            (error as { code: string }).code,
          ),
      );
      assert.deepEqual(fs.readdirSync(tempRoot), []);

      await assert.rejects(
        checkoutRepository({
          remoteUrl: "https://github.com/sindresorhus/yocto-queue",
          sha: YOCTO_MERGE_SHA,
          tempRoot,
          timeoutMs: 1_000,
        }),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "CHECKOUT_TIMEOUT",
      );
      assert.deepEqual(fs.readdirSync(tempRoot), []);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
);
