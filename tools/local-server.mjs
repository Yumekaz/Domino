import http from "node:http";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, extname, join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const port = Number(process.env.DOMINO_WEB_PORT || 5173),
  apiPort = Number(process.env.PORT || 3000);
const root = resolve("apps/web/dist");
const qa = process.env.DOMINO_LOCAL_QA === "1";
const origins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
async function body(request, max = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw new Error("Payload exceeds local limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const server = http.createServer(async (request, response) => {
  try {
    if (
      ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(
        request.headers.host,
      )
    ) {
      response.writeHead(421).end("Local host required");
      return;
    }
    if (request.headers.origin && !origins.has(request.headers.origin)) {
      response.writeHead(403).end("Origin not allowed");
      return;
    }
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__local/stop" && request.method === "POST") {
      const actual = Buffer.from(
          String(request.headers["x-domino-local-control"] || ""),
        ),
        expected = Buffer.from(process.env.DOMINO_LOCAL_CONTROL || "");
      if (
        !expected.length ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(202).end("Stopping local demo");
      process.send?.({ type: "domino.stop" });
      return;
    }
    if (qa && url.pathname === "/__qa/results" && request.method === "POST") {
      const data = JSON.parse((await body(request)).toString());
      if (!["accessibility", "profile"].includes(data.type))
        throw new Error("Unknown review result");
      const directory = resolve(".domino/review");
      await mkdir(directory, { recursive: true });
      const filename = `${data.type}-${randomUUID()}.json`;
      await writeFile(join(directory, filename), JSON.stringify(data, null, 2));
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ saved: filename }));
      return;
    }
    if (qa && ["/__qa/review.js", "/__qa/axe.js"].includes(url.pathname)) {
      const file = url.pathname.endsWith("axe.js")
        ? require.resolve("axe-core/axe.min.js")
        : resolve("tools/local-review.js");
      response
        .writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(await readFile(file));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const headers = { ...request.headers, host: `127.0.0.1:${apiPort}` };
      // This same-origin server enforces Origin above; its internal request is server-to-server.
      delete headers.origin;
      delete headers["x-domino-local-control"];
      delete headers.authorization;
      if (process.env.DOMINO_API_TOKEN)
        headers.authorization = `Bearer ${process.env.DOMINO_API_TOKEN}`;
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: apiPort,
          path: url.pathname + url.search,
          method: request.method,
          headers,
          timeout: 30000,
        },
        (incoming) => {
          response.writeHead(incoming.statusCode || 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!response.headersSent)
          response.writeHead(502, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: "CONNECTION_UNAVAILABLE",
            message:
              "The local API is unavailable. Check the demo terminal and retry.",
          }),
        );
      });
      const data = await body(request, 300000);
      upstream.end(data);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    const candidate = resolve(root, "." + decodeURIComponent(url.pathname));
    if (relative(root, candidate).startsWith("..")) {
      response.writeHead(404).end();
      return;
    }
    const exists = await stat(candidate).then(
      (s) => s.isFile(),
      () => false,
    );
    if (!exists && extname(url.pathname)) {
      response.writeHead(404).end("Asset unavailable");
      return;
    }
    const file = exists ? candidate : join(root, "index.html");
    let contents = await readFile(file);
    if (qa && file.endsWith("index.html"))
      contents = Buffer.from(
        contents
          .toString()
          .replace(
            "</head>",
            '<script defer src="/__qa/axe.js"></script><script defer src="/__qa/review.js"></script></head>',
          ),
      );
    response.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": file.endsWith("index.html")
        ? "no-store"
        : "public,max-age=3600",
      "x-content-type-options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch {
    if (!response.headersSent)
      response.writeHead(500, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        code: "LOCAL_SERVER_ERROR",
        message: "The local server could not complete this request.",
      }),
    );
  }
});
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", accept);
});
console.log(
  `Domino local workspace: http://127.0.0.1:${port}${qa ? " (LOCAL QA TOOLS ENABLED)" : ""}`,
);
process.send?.({ type: "domino.ready", role: "web" });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    if (process.connected) process.disconnect();
  });
};
process.on("message", (message) => {
  if (message?.type === "domino.shutdown") stop();
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
