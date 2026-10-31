import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OpenAiCompatibleProvider, createOpenAiProviderFromEnv } from "../src/openai.ts";
import { HistoryError } from "../../core/history/src/errors.ts";

interface TestServer {
  url: string;
  close(): Promise<void>;
}

async function startServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    },
  };
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

test("sends a structured chat request and normalizes the provider response", async () => {
  let seenAuthorization = "";
  let seenBody: Record<string, unknown> = {};
  const server = await startServer(async (request, response) => {
    seenAuthorization = String(request.headers.authorization ?? "");
    seenBody = JSON.parse(await readBody(request)) as Record<string, unknown>;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model: "test-model-2026",
        choices: [{ message: { content: '{"status":"not_found","claims":[]}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 8 },
      }),
    );
  });
  try {
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key-not-real",
      model: "test-model",
      baseUrl: server.url,
    });
    const result = await provider.generate({
      system: "SYSTEM",
      user: "USER",
      maxOutputTokens: 256,
      timeoutMs: 5_000,
    });
    assert.equal(result.text, '{"status":"not_found","claims":[]}');
    assert.equal(result.provider, "openai");
    assert.equal(result.model, "test-model-2026");
    assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 8 });
    assert.equal(seenAuthorization, "Bearer test-key-not-real");
    assert.equal(seenBody.model, "test-model");
    assert.equal(seenBody.max_completion_tokens, 256);
    assert.deepEqual(seenBody.response_format, { type: "json_object" });
    const messages = seenBody.messages as Array<{ role: string; content: string }>;
    assert.deepEqual(messages.map((message) => message.role), ["system", "user"]);
    assert.equal(messages[0].content, "SYSTEM");
    assert.equal(messages[1].content, "USER");
  } finally {
    await server.close();
  }
});

test("maps provider quota, outage and auth failures to typed errors", async () => {
  for (const [status, code] of [
    [429, "LLM_RATE_LIMITED"],
    [500, "LLM_UNAVAILABLE"],
    [401, "LLM_UNAVAILABLE"],
  ] as const) {
    const server = await startServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "provider error" } }));
    });
    try {
      const provider = new OpenAiCompatibleProvider({
        apiKey: "test-key",
        model: "test-model",
        baseUrl: server.url,
      });
      await assert.rejects(
        provider.generate({
          system: "s",
          user: "u",
          maxOutputTokens: 64,
          timeoutMs: 5_000,
        }),
        (error: unknown) =>
          error instanceof HistoryError &&
          error.code === code &&
          error.recoverable === true,
      );
    } finally {
      await server.close();
    }
  }
});

test("rejects malformed provider payloads without leaking a canned answer", async () => {
  for (const payload of [
    "not json",
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ message: { content: "" } }] }),
    JSON.stringify({ choices: [{ message: { content: 42 } }] }),
  ]) {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(payload);
    });
    try {
      const provider = new OpenAiCompatibleProvider({
        apiKey: "test-key",
        model: "test-model",
        baseUrl: server.url,
      });
      await assert.rejects(
        provider.generate({
          system: "s",
          user: "u",
          maxOutputTokens: 64,
          timeoutMs: 5_000,
        }),
        (error: unknown) =>
          error instanceof HistoryError && error.code === "LLM_BAD_OUTPUT",
      );
    } finally {
      await server.close();
    }
  }
});

test("enforces a timeout and external cancellation", async () => {
  const server = await startServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ choices: [{ message: { content: "late" } }] }),
      );
    }, 1_500);
  });
  try {
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: server.url,
    });
    await assert.rejects(
      provider.generate({
        system: "s",
        user: "u",
        maxOutputTokens: 64,
        timeoutMs: 1_000,
      }),
      (error: unknown) => error instanceof HistoryError && error.code === "LLM_TIMEOUT",
    );

    const controller = new AbortController();
    const pending = provider.generate({
      system: "s",
      user: "u",
      maxOutputTokens: 64,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof HistoryError && error.code === "LLM_TIMEOUT",
    );
  } finally {
    await server.close();
  }
});

test("does not construct a provider without a key and reads the documented environment names", () => {
  assert.throws(
    () =>
      new OpenAiCompatibleProvider({
        apiKey: "",
        model: "test-model",
        baseUrl: "http://127.0.0.1:1/v1",
      }),
    (error: unknown) => error instanceof HistoryError && error.code === "LLM_UNAVAILABLE",
  );
  const previousKey = process.env.DOMINO_OPENAI_API_KEY;
  const previousModel = process.env.DOMINO_LLM_MODEL;
  process.env.DOMINO_OPENAI_API_KEY = "env-key";
  process.env.DOMINO_LLM_MODEL = "env-model";
  try {
    const provider = createOpenAiProviderFromEnv();
    assert.equal(provider.model, "env-model");
    assert.equal(provider.provider, "openai");
  } finally {
    if (previousKey === undefined) {
      delete process.env.DOMINO_OPENAI_API_KEY;
    } else {
      process.env.DOMINO_OPENAI_API_KEY = previousKey;
    }
    if (previousModel === undefined) {
      delete process.env.DOMINO_LLM_MODEL;
    } else {
      process.env.DOMINO_LLM_MODEL = previousModel;
    }
  }
});
