import type { QueryResult } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { Database } from "../src/database/database.js";

const testConfig: AppConfig = {
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3000,
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  SESSION_TTL_HOURS: 168
};

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function databaseWithQuery(query: Database["query"]): Database {
  return {
    close: vi.fn(async () => undefined),
    query
  };
}

describe("GET /health", () => {
  it("returns 200 when PostgreSQL is reachable", async () => {
    const query = vi.fn(async () => ({ rows: [] }) as unknown as QueryResult);
    const app = buildApp({
      config: testConfig,
      database: databaseWithQuery(query),
      logger: false
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ database: "reachable", status: "ok" });
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns 503 when PostgreSQL is unavailable", async () => {
    const query = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const app = buildApp({
      config: testConfig,
      database: databaseWithQuery(query),
      logger: false
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ database: "unreachable", status: "error" });
  });
});
