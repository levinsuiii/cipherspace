import { Pool, type QueryResult, type QueryResultRow } from "pg";

export interface Database {
  close(): Promise<void>;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export function createDatabase(databaseUrl: string): Database {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    close: () => pool.end(),
    query: (text, values) => pool.query(text, values ? [...values] : undefined)
  };
}
