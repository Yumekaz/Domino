export interface SqlQueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface SqlClient {
  query<T>(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
