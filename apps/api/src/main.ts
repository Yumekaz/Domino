import { PgBoss } from "pg-boss";
import { createPool } from "../../../packages/database/src/index.ts";
import { HISTORY_QUEUE } from "../../../packages/database/src/jobs.ts";
import { createApp } from "./app.ts";
import {
  createHistoryServices,
  type HistoryServices,
} from "./history-services.ts";

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
let history: HistoryServices | null = null;
try {
  history = await createHistoryServices(pool, databaseUrl);
} catch {
  console.warn(
    "History service is not installed; history-dependent routes are unavailable.",
  );
}
const allowedOrigins = process.env.DOMINO_ALLOWED_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const app = createApp({ pool, boss, history, token, allowedOrigins });
await app.listen({ host, port: Number(process.env.PORT || 3000) });
async function stop() {
  await app.close();
  if (history) await history.close();
  await boss.stop({ graceful: true });
  await pool.end();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
