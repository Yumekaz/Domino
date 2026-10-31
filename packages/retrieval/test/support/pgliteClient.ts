import { PGlite } from "@electric-sql/pglite";
import type { SqlClient, SqlQueryResult } from "../../src/sqlClient.ts";

export class PgliteSqlClient implements SqlClient {
  private readonly db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  static async create(dataDir?: string): Promise<PgliteSqlClient> {
    const db = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
    await db.waitReady;
    return new PgliteSqlClient(db);
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<SqlQueryResult<T>> {
    const result = await this.db.query<T>(sql, params as unknown[]);
    return {
      rows: result.rows as T[],
      rowCount: typeof result.affectedRows === "number" ? result.affectedRows : null,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    await this.exec("BEGIN");
    try {
      const result = await fn(this);
      await this.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
