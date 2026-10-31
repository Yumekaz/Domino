import pg from "pg";
import type { SqlClient, SqlQueryResult } from "./sqlClient.ts";

type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

class PgTransactionClient implements SqlClient {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<SqlQueryResult<T>> {
    const result = await this.client.query(sql, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? null };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    return await fn(this);
  }

  async close(): Promise<void> {
    this.client.release();
  }
}

export class PgSqlClient implements SqlClient {
  private readonly pool: Pool;

  constructor(options: {
    connectionString?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }) {
    this.pool = new pg.Pool({
      ...(options.connectionString === undefined
        ? {}
        : { connectionString: options.connectionString }),
      max: options.max ?? 4,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    });
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<SqlQueryResult<T>> {
    const result = await this.pool.query(sql, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? null };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PgTransactionClient(client);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPgSqlClient(options: {
  connectionString?: string;
  max?: number;
} = {}): PgSqlClient {
  return new PgSqlClient(options);
}
