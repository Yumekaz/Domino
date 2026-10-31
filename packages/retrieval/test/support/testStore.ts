import fs from "node:fs";
import { PgliteSqlClient } from "./pgliteClient.ts";
import { PostgresHistoryStore } from "../../src/postgresStore.ts";

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export interface TestStore {
  client: PgliteSqlClient;
  store: PostgresHistoryStore;
  close(): Promise<void>;
}

export async function createTestStore(dataDir?: string): Promise<TestStore> {
  const client = await PgliteSqlClient.create(dataDir);
  await client.exec(schema);
  return {
    client,
    store: new PostgresHistoryStore(client),
    async close() {
      await client.close();
    },
  };
}

export async function openTestStore(dataDir: string): Promise<TestStore> {
  const client = await PgliteSqlClient.create(dataDir);
  return {
    client,
    store: new PostgresHistoryStore(client),
    async close() {
      await client.close();
    },
  };
}
