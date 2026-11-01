import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicRepository, resolvePullRequest } from "../../apps/api/src/github.ts";

const repository = {
  id: 123,
  private: false,
  default_branch: "main",
  name: "repo",
  owner: { login: "owner" },
  html_url: "https://github.com/owner/repo",
};
afterEach(() => vi.unstubAllGlobals());

describe("public GitHub resolver", () => {
  it("requests only the allowlisted API host and resolves an exact SHA", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(repository))
      .mockResolvedValueOnce(Response.json({ sha: "a".repeat(40) }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolvePublicRepository(
      "https://github.com/owner/repo",
    );
    expect(result).toMatchObject({ githubId: 123, headSha: "a".repeat(40) });
    for (const [url, options] of fetchMock.mock.calls) {
      expect(new URL(String(url)).hostname).toBe("api.github.com");
      expect(options.redirect).toBe("error");
    }
  });
  it("rejects private or unexpected repository identities", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ...repository, private: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      resolvePublicRepository("https://github.com/owner/repo"),
    ).rejects.toMatchObject({ code: "REPO_NOT_PUBLIC" });
    fetchMock.mockResolvedValue(
      Response.json({
        ...repository,
        html_url: "https://evil.example/owner/repo",
      }),
    );
    await expect(
      resolvePublicRepository("https://github.com/owner/repo"),
    ).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
  });
  it("rejects oversized streamed responses even without a content-length header", async () => {
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1_000_001));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(oversized, { status: 200 })),
    );
    await expect(
      resolvePublicRepository("https://github.com/owner/repo"),
    ).rejects.toMatchObject({ code: "GITHUB_RESPONSE_TOO_LARGE" });
  });
});

describe("PR revision and source boundaries", () => {
  const sha = "a".repeat(40), head = "b".repeat(40);
  const pr = { number: 12, html_url: "https://github.com/owner/repo/pull/12", base: { sha }, head: { sha: head } };
  function mock(final = pr, url = pr.html_url, filename = "new.ts") {
    const fn = vi.fn().mockResolvedValueOnce(Response.json(repository)).mockResolvedValueOnce(Response.json({ sha }))
      .mockResolvedValueOnce(Response.json({ ...pr, html_url: url }))
      .mockResolvedValueOnce(Response.json([{ filename, previous_filename: "old.ts", status: "renamed" }]))
      .mockResolvedValueOnce(Response.json(final));
    vi.stubGlobal("fetch", fn); return fn;
  }
  it("retains stable repository identity and rename metadata at a confirmed PR head", async () => {
    mock(); const result = await resolvePullRequest("https://github.com/owner/repo", 12);
    expect(result.repositoryId).toBe(123);
    expect(result.fileChanges).toEqual([{ filename: "new.ts", previousFilename: "old.ts", status: "renamed" }]);
  });
  it("rejects a head that changes while changed files are fetched", async () => {
    mock({ ...pr, head: { sha: "c".repeat(40) } });
    await expect(resolvePullRequest("https://github.com/owner/repo", 12)).rejects.toMatchObject({ code: "INDEX_STALE" });
  });
  it("rejects source links from another repository and unsafe changed paths", async () => {
    mock(pr, "https://github.com/other/repo/pull/12");
    await expect(resolvePullRequest("https://github.com/owner/repo", 12)).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    mock(pr, pr.html_url, "../secret.ts");
    await expect(resolvePullRequest("https://github.com/owner/repo", 12)).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
  });
});
