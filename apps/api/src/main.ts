import { PgBoss } from "pg-boss";
import { createPool } from "../../../packages/database/src/index.ts";
import { HISTORY_QUEUE } from "../../../packages/database/src/jobs.ts";
import {
  ANALYSIS_QUEUE,
  enqueuePrAnalysis,
} from "../../../packages/database/src/analysis-jobs.ts";
import { createApp } from "./app.ts";
import {
  createHistoryServices,
  type HistoryServices,
} from "./history-services.ts";
import { createImpactServices } from "./impact-services.ts";
import { createPrCheckService } from "./pr-services.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const host = process.env.HOST || "127.0.0.1";
const token = process.env.DOMINO_API_TOKEN;
if (!["127.0.0.1", "::1", "localhost"].includes(host) && !token)
  throw new Error("DOMINO_API_TOKEN is required for non-loopback API binding");
const pool = createPool(databaseUrl);
const boss = new PgBoss(databaseUrl);
boss.on("error", (error) => console.error("Queue error:", error.message));
await boss.start();
await boss.createQueue(HISTORY_QUEUE, { retryLimit: 1, expireInSeconds: 600 });
await boss.createQueue(ANALYSIS_QUEUE, { retryLimit: 0, expireInSeconds: 360 });
let history: HistoryServices | null = null;
try {
  history = await createHistoryServices(pool, databaseUrl);
} catch {
  console.warn(
    "History service is not installed; history-dependent routes are unavailable.",
  );
}
let impact: ReturnType<typeof createImpactServices>["impact"] | undefined;
let prCheck: ReturnType<typeof createPrCheckService> | undefined;
let closeImpact: (() => Promise<void>) | undefined;
try {
  const services = createImpactServices(pool, databaseUrl);
  impact = services.impact;
  closeImpact = services.close;
  prCheck = createPrCheckService({
    pool,
    enqueue: (repoId, input) => enqueuePrAnalysis(pool, boss, repoId, input),
    token: process.env.DOMINO_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN,
  });
} catch (error) {
  console.warn(
    "Impact services are unavailable; impact and PR routes will return typed errors.",
    error instanceof Error ? error.message : "unknown error",
  );
}
const allowedOrigins = process.env.DOMINO_ALLOWED_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const app = createApp({
  pool,
  boss,
  history,
  impact,
  prCheck,
  token,
  allowedOrigins,
});
await app.listen({ host, port: Number(process.env.PORT || 3000) });
process.send?.({ type: "domino.ready", role: "api" });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  if (history) await history.close();
  if (closeImpact) await closeImpact();
  await boss.stop({ graceful: true });
  await pool.end();
  if (process.connected) process.disconnect();
}
process.on("message", (message) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "domino.shutdown"
  )
    void stop();
});
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
