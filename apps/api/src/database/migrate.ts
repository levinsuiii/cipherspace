import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Pool, type PoolClient } from "pg";

import { loadConfig } from "../config.js";

interface AppliedMigration {
  checksum: string;
  name: string;
}

interface MigrationFile {
  checksum: string;
  name: string;
  sql: string;
}

const migrationLockName = "cipherspace:migrations";

function defaultMigrationsDirectory(): string {
  const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
  return resolve(currentDirectory, "../../migrations");
}

async function readMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), "utf8");
      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        name,
        sql
      };
    })
  );
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<AppliedMigration>(
    "SELECT name, checksum FROM schema_migrations ORDER BY name"
  );
  return new Map(result.rows.map((migration) => [migration.name, migration.checksum]));
}

export async function runMigrations(
  databaseUrl: string,
  directory = defaultMigrationsDirectory()
): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const completed: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [migrationLockName]);
    await ensureMigrationTable(client);

    const applied = await appliedMigrations(client);
    const migrations = await readMigrations(directory);

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.name);

      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(`Applied migration has changed: ${migration.name}`);
      }

      if (existingChecksum) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum]
        );
        await client.query("COMMIT");
        completed.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return completed;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [migrationLockName]);
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const completed = await runMigrations(config.DATABASE_URL);

  if (completed.length === 0) {
    process.stdout.write("Database is already up to date.\n");
    return;
  }

  process.stdout.write(`Applied migrations: ${completed.join(", ")}\n`);
}

const isEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown migration failure";
    process.stderr.write(`Migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
