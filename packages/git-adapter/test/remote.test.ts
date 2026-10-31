import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubRemote } from "../src/remote.ts";

test("accepts canonical public GitHub repository URLs", () => {
  assert.deepEqual(parseGithubRemote("https://github.com/sindresorhus/yocto-queue"), {
    owner: "sindresorhus",
    repo: "yocto-queue",
    host: "github.com",
    canonicalUrl: "https://github.com/sindresorhus/yocto-queue",
    cloneUrl: "https://github.com/sindresorhus/yocto-queue.git",
  });
  const dotted = parseGithubRemote("https://github.com/pmndrs/zustand.git/");
  assert.equal(dotted.repo, "zustand");
  const trailing = parseGithubRemote("https://github.com/pmndrs/zustand/");
  assert.equal(trailing.canonicalUrl, "https://github.com/pmndrs/zustand");
});

test("rejects non-HTTPS, non-GitHub, credentialed, local and nested locations", () => {
  const invalid = [
    "http://github.com/a/b",
    "git@github.com:a/b.git",
    "ssh://github.com/a/b.git",
    "git://github.com/a/b.git",
    "https://gitlab.com/a/b",
    "https://github.com.evil.example/a/b",
    "https://user:token@github.com/a/b",
    "https://github.com:443/a/b",
    "https://github.com/a/b?x=1",
    "https://github.com/a/b#readme",
    "https://github.com/a/b/tree/main",
    "https://github.com/a",
    "https://github.com/a/b/c",
    "file:///tmp/repo",
    "C:/repo",
    "../repo",
    "https://github.com/a/..",
  ];
  for (const value of invalid) {
    assert.throws(
      () => parseGithubRemote(value),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        ["INVALID_REMOTE", "UNSUPPORTED_REMOTE"].includes(
          (error as { code: string }).code,
        ),
      value,
    );
  }
});
