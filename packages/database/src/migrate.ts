import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

export async function migrate(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [89206761]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS domino_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
    for (const name of (await readdir(directory))
      .filter((n) => /^\d+_[a-z0-9_]+\.sql$/.test(n))
      .sort()) {
      const sql = await readFile(
        new URL(`../migrations/${name}`, import.meta.url),
        "utf8",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM domino_migrations WHERE name=$1",
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO domino_migrations(name, checksum) VALUES ($1,$2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      process.stdout.write(`Applied ${name}\n`);
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [89206761])
      .catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  await migrate(databaseUrl);
}
