import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  access,
  readdir,
  rename,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { migrate } from "../packages/database/src/migrate.ts";
import { recoverOwnedWork } from "../packages/database/src/worker-recovery.ts";

const root = process.cwd(),
  statePath = resolve(".domino/runtime.json");
const mode = process.argv[2] || "run";
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const readState = () =>
  readFile(statePath, "utf8").then(JSON.parse, () => null);
const apiPort = Number(process.env.PORT || 3000),
  webPort = Number(process.env.DOMINO_WEB_PORT || 5173);
if (
  ![apiPort, webPort].every(
    (p) => Number.isInteger(p) && p > 1024 && p <= 65535,
  )
)
  throw new Error("Use valid non-privileged local ports");
const api = `http://127.0.0.1:${apiPort}/api/v1`,
  web = `http://127.0.0.1:${webPort}`;
const auth = process.env.DOMINO_API_TOKEN
  ? { Authorization: `Bearer ${process.env.DOMINO_API_TOKEN}` }
  : {};
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("Configure DATABASE_URL in the ignored root .env first");
const dbUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(dbUrl.hostname))
  throw new Error(
    "This launcher is local-only; it will not provision or access a hosted database",
  );

if (mode === "stop") {
  const state = await readState();
  if (!state || state.root !== root)
    throw new Error("No managed local Domino runtime found");
  const r = await fetch(state.url + "/__local/stop", {
    method: "POST",
    headers: { "x-domino-local-control": state.control },
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok)
    throw new Error("Managed runtime refused shutdown; inspect its terminal");
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && (await readState())?.status !== "stopped")
    await delay(100);
  if ((await readState())?.status !== "stopped")
    throw new Error(
      "Shutdown is still in progress. Inspect the demo terminal; no unowned process was stopped.",
    );
  console.log("Owned local services stopped. PostgreSQL data stays available.");
} else if (mode === "doctor") {
  const result = {
    node: process.version,
    modelConfigured: !!(
      process.env.DOMINO_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    ),
    cbmEnabled: process.env.DOMINO_CODE_INTELLIGENCE === "cbm",
    cbmExecutable: await exists(process.env.DOMINO_CBM_BINARY || ""),
    productionBuild: await exists("apps/web/dist/index.html"),
  };
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    result.database = "ok";
    result.postgres = (
      await client.query("SHOW server_version")
    ).rows[0].server_version;
  } catch {
    result.database = "unavailable";
  } finally {
    await client.end().catch(() => {});
  }
  result.api = await fetch(api + "/health", {
    headers: auth,
    signal: AbortSignal.timeout(3000),
  }).then(
    async (r) => ({ status: r.status, ...(await r.json()) }),
    () => ({ status: "unavailable" }),
  );
  result.web = await fetch(web, { signal: AbortSignal.timeout(3000) }).then(
    (r) => r.status,
    () => "unavailable",
  );
  const state = await readState();
  result.managedRuntime =
    state?.root === root
      ? { startedAt: state.startedAt, status: state.status, roles: state.roles }
      : null;
  console.log(JSON.stringify(result, null, 2));
  if (
    result.database !== "ok" ||
    result.api.status !== "ok" ||
    result.web !== 200
  )
    process.exitCode = 1;
} else if (mode === "run") {
  await mkdir(".domino/logs", { recursive: true });
  if (
    await fetch(web, { signal: AbortSignal.timeout(1000) }).then(
      () => true,
      () => false,
    )
  )
    throw new Error(
      `Port ${webPort} is already used. Stop that terminal first; this launcher never kills unowned processes.`,
    );
  if (
    await fetch(api + "/health", {
      headers: auth,
      signal: AbortSignal.timeout(1000),
    }).then(
      () => true,
      () => false,
    )
  )
    throw new Error(
      `API port ${apiPort} is already used. Stop the existing API first.`,
    );
  const testDb = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
  });
  let reachable = false;
  try {
    await testDb.connect();
    reachable = true;
  } catch (error) {
    if (!["ECONNREFUSED", "ETIMEDOUT"].includes(error.code))
      throw new Error(
        "Database connection failed. Check credentials and the local PostgreSQL terminal.",
      );
  } finally {
    await testDb.end().catch(() => {});
  }
  if (!reachable) {
    const bin = process.env.DOMINO_PG_BIN_DIR,
      data = process.env.DOMINO_PG_DATA_DIR;
    if (!bin || !data || !(await exists(join(data, "PG_VERSION"))))
      throw new Error(
        "Start local PostgreSQL or configure DOMINO_PG_BIN_DIR and DOMINO_PG_DATA_DIR. Existing data is never initialized or reset automatically.",
      );
    if ((await readFile(join(data, "PG_VERSION"), "utf8")).trim() !== "17")
      throw new Error(
        "This native helper supports the verified PostgreSQL 17 cluster only",
      );
    // Ignore inherited pipes: pg_ctl starts a resident server on Windows.
    execFileSync(
      join(bin, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl"),
      [
        "-D",
        resolve(data),
        "-l",
        resolve(".domino/logs/postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${Number(dbUrl.port || 5432)}`,
        "-w",
        "start",
      ],
      { windowsHide: true, stdio: "ignore", timeout: 30000 },
    );
  }
  await migrate(databaseUrl);
  if (
    process.env.DOMINO_CODE_INTELLIGENCE === "cbm" &&
    !(await exists(process.env.DOMINO_CBM_BINARY || ""))
  )
    throw new Error(
      "CBM is enabled but its executable is missing. Run npm run setup:cbm.",
    );
  const npm =
    process.env.npm_execpath ||
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  console.log("Building the actual production frontend…");
  execFileSync(process.execPath, [npm, "run", "build"], {
    cwd: resolve("apps/web"),
    windowsHide: true,
    stdio: "inherit",
    env: { ...process.env, VITE_API_BASE_URL: "", VITE_DATA_MODE: "live" },
  });
  execFileSync(process.execPath, [npm, "run", "verify:production"], {
    cwd: resolve("apps/web"),
    windowsHide: true,
    stdio: "inherit",
  });
  for (const name of await readdir("apps/web/dist/assets"))
    if (name.endsWith(".js")) {
      const contents = await readFile(
        join("apps/web/dist/assets", name),
        "utf8",
      );
      for (const key of [
        "DOMINO_OPENAI_API_KEY",
        "OPENAI_API_KEY",
        "DOMINO_GITHUB_TOKEN",
        "GITHUB_TOKEN",
        "DOMINO_API_TOKEN",
      ]) {
        const value = process.env[key];
        if (value && value.length > 8 && contents.includes(value))
          throw new Error(
            `A server credential leaked into ${name}; refusing to serve it`,
          );
      }
    }
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    DOMINO_WEB_PORT: String(webPort),
  };
  if (!env.DOMINO_GITHUB_TOKEN && !env.GITHUB_TOKEN) {
    try {
      env.DOMINO_GITHUB_TOKEN = execFileSync("gh", ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim();
      console.log("Using existing GitHub CLI sign-in in server memory.");
    } catch {
      console.log(
        "No GitHub token configured; public imports use the lower anonymous quota.",
      );
    }
  }
  const state = {
    root,
    pid: process.pid,
    url: web,
    startedAt: new Date().toISOString(),
    status: "starting",
    control: randomBytes(32).toString("hex"),
    roles: {},
  };
  const children = new Map(),
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const pending = new Set();
  let stopping = false,
    restarts = 0;
  let persistQueue = Promise.resolve();
  const persist = () => {
    const contents = JSON.stringify(state, null, 2);
    persistQueue = persistQueue.then(async () => {
      await writeFile(statePath + ".tmp", contents);
      await rename(statePath + ".tmp", statePath);
    });
    return persistQueue;
  };
  const launch = (role, file) => {
    const instance = role === "worker" ? randomUUID() : undefined;
    const childEnv = {
      ...env,
      DOMINO_WORKER_INSTANCE: instance,
      DOMINO_LOCAL_CONTROL: role === "web" ? state.control : "",
    };
    if (role === "web")
      for (const key of [
        "DOMINO_OPENAI_API_KEY",
        "OPENAI_API_KEY",
        "DOMINO_GITHUB_TOKEN",
        "GITHUB_TOKEN",
        "DATABASE_URL",
      ])
        delete childEnv[key];
    const child = spawn(
      process.execPath,
      ["--use-system-ca", "--import", "tsx", resolve(file)],
      {
        env: childEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.set(role, { child, instance });
    state.roles[role] = { pid: child.pid, ready: false };
    void persist();
    child.stdout.on("data", (data) =>
      process.stdout.write(`[${role}] ${data}`),
    );
    child.stderr.on("data", (data) =>
      process.stderr.write(`[${role}] ${data}`),
    );
    const ready = new Promise((accept, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${role} did not become ready`)),
        45000,
      );
      child.on("message", (message) => {
        if (message?.type === "domino.ready") {
          clearTimeout(timer);
          state.roles[role].ready = true;
          void persist();
          accept();
        }
        if (message?.type === "domino.stop") void stop();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`${role} exited before readiness (${code})`));
      });
    });
    child.once("exit", () => {
      state.roles[role].ready = false;
      void persist();
      const recovery = instance
        ? recoverOwnedWork(pool, instance)
            .then((counts) =>
              console.log("Recovered interrupted local work:", counts),
            )
            .catch(() =>
              console.error(
                "Recovery could not reach PostgreSQL. Run demo:doctor before retrying.",
              ),
            )
        : Promise.resolve();
      pending.add(recovery);
      void recovery.finally(() => pending.delete(recovery));
      if (!stopping) {
        if (role === "worker" && restarts++ < 2) {
          console.error(
            "Local worker exited; restarting after marking its interrupted work retryable.",
          );
          void recovery
            .then(() => launch("worker", "apps/worker/src/main.ts"))
            .catch(() => stop(1));
        } else void stop(1);
      }
    });
    return ready;
  };
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    state.status = "stopping";
    await persist();
    console.log("Stopping owned local services…");
    await Promise.all(
      [...children.values()].map(
        ({ child }) =>
          new Promise((accept) => {
            if (child.exitCode !== null) {
              accept();
              return;
            }
            const timer = setTimeout(() => child.kill(), 35000);
            child.once("exit", () => {
              clearTimeout(timer);
              accept();
            });
            if (child.connected) child.send({ type: "domino.shutdown" });
            else child.kill();
          }),
      ),
    );
    await Promise.allSettled([...pending]);
    await pool.end();
    state.status = "stopped";
    await persist();
    process.exitCode = code;
  }
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  try {
    await Promise.all([
      launch("api", "apps/api/src/main.ts"),
      launch("worker", "apps/worker/src/main.ts"),
    ]);
    await launch("web", "tools/local-server.mjs");
    state.status = "ready";
    await persist();
    console.log(
      `\nREADY: ${web}\nAPI and both worker queues are live. Ctrl+C stops the app; indexed data stays on disk.`,
    );
  } catch (error) {
    console.error(error.message);
    await stop(1);
  }
} else throw new Error("Expected run, doctor or stop");
