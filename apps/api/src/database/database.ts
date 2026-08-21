import { Pool, type QueryResult, type QueryResultRow } from "pg";

export interface DatabaseSession {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export interface Database extends DatabaseSession {
  close(): Promise<void>;
  transaction<Result>(operation: (database: DatabaseSession) => Promise<Result>): Promise<Result>;
}

export function createDatabase(databaseUrl: string, maxConnections = 10): Database {
  const pool = new Pool({ connectionString: databaseUrl, max: maxConnections });

  return {
    close: () => pool.end(),
    query: (text, values) => pool.query(text, values ? [...values] : undefined),
    transaction: async (operation) => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const result = await operation({
          query: (text, values) => client.query(text, values ? [...values] : undefined)
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
