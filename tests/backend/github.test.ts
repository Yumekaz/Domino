import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicRepository } from "../../apps/api/src/github.ts";

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
