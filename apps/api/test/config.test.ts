import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:password@localhost:5432/cipherspace",
  NODE_ENV: "production",
  SESSION_SECRET: "8ee5584457819ebd76d03c3f72f52c9f93dcafc3bf74f8b08ad882436d20d31d"
} satisfies NodeJS.ProcessEnv;

describe("environment configuration", () => {
  it("requires an explicit production CORS policy", () => {
    expect(() => loadConfig(validEnvironment)).toThrow(/CORS_ORIGINS must be set in production/);

    expect(loadConfig({ ...validEnvironment, CORS_ORIGINS: "" }).CORS_ORIGINS).toEqual([]);
  });

  it("rejects wildcard, path-based, and credential-bearing CORS origins", () => {
    for (const CORS_ORIGINS of [
      "*",
      "https://app.example.com/path",
      "https://user:password@app.example.com"
    ]) {
      expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS })).toThrow(/CORS_ORIGINS/);
    }
  });

  it("rejects placeholder production secrets while allowing documented development defaults", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        CORS_ORIGINS: "",
        SESSION_SECRET: "dev-only-change-me-before-running-32-bytes-minimum"
      })
    ).toThrow(/randomly generated production secret/);

    expect(
      loadConfig({
        DATABASE_URL: validEnvironment.DATABASE_URL,
        NODE_ENV: "development",
        SESSION_SECRET: "dev-only-change-me-before-running-32-bytes-minimum"
      }).NODE_ENV
    ).toBe("development");
  });

  it("validates PostgreSQL URLs and bounded numeric security settings", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        CORS_ORIGINS: "",
        DATABASE_URL: "https://database.example.com",
        AUTH_RATE_LIMIT_MAX: "0"
      })
    ).toThrow(/AUTH_RATE_LIMIT_MAX|DATABASE_URL/);
  });

  it("supports hosted Postgres migration URLs and cross-site production cookies", () => {
    const config = loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "https://cipherspace.pages.dev",
      DATABASE_POOL_MAX: "5",
      DATABASE_URL:
        "postgresql://user:password@project-pooler.example.com/cipherspace?sslmode=require",
      MIGRATIONS_DATABASE_URL:
        "postgresql://user:password@project.example.com/cipherspace?sslmode=require",
      SESSION_COOKIE_SAME_SITE: "none",
      TRUST_PROXY: "true"
    });

    expect(config.DATABASE_POOL_MAX).toBe(5);
    expect(config.MIGRATIONS_DATABASE_URL).toContain("sslmode=require");
    expect(config.SESSION_COOKIE_SAME_SITE).toBe("none");
    expect(config.TRUST_PROXY).toBe(true);
  });

  it("rejects cross-site cookies outside secure production mode", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: validEnvironment.DATABASE_URL,
        NODE_ENV: "development",
        SESSION_COOKIE_SAME_SITE: "none",
        SESSION_SECRET: validEnvironment.SESSION_SECRET
      })
    ).toThrow(/requires NODE_ENV=production/);
  });
});
