import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:password@localhost:5432/cipherspace",
  EMAIL_FROM: "security@example.com",
  NODE_ENV: "production",
  RESEND_API_KEY: "re_test_key",
  WEB_APP_URL: "https://app.example.com",
  SESSION_SECRET: "8ee5584457819ebd76d03c3f72f52c9f93dcafc3bf74f8b08ad882436d20d31d"
} satisfies NodeJS.ProcessEnv;

describe("environment configuration", () => {
  it("fails closed when production Resend configuration is missing", () => {
    expect(() => loadConfig({
      DATABASE_URL: validEnvironment.DATABASE_URL,
      CORS_ORIGINS: "",
      NODE_ENV: "production",
      SESSION_SECRET: validEnvironment.SESSION_SECRET
    })).toThrow(/EMAIL_FROM.*RESEND_API_KEY.*WEB_APP_URL/);
  });

  it("accepts valid bare and display-name email senders", () => {
    expect(loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "",
      EMAIL_FROM: "onboarding@resend.dev"
    }).EMAIL_FROM).toBe("onboarding@resend.dev");
    expect(loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "",
      EMAIL_FROM: "CipherSpace <noreply@example.com>"
    }).EMAIL_FROM).toBe("CipherSpace <noreply@example.com>");
  });

  it.each([
    "",
    "not-an-email",
    "https://example.com/sender",
    "CipherSpace <not-an-email>",
    "sender@example.com,other@example.com"
  ])("rejects malformed EMAIL_FROM value %j", (EMAIL_FROM) => {
    expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS: "", EMAIL_FROM }))
      .toThrow(/EMAIL_FROM/);
  });

  it("rejects header injection in EMAIL_FROM", () => {
    expect(() => loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "",
      EMAIL_FROM: "sender@example.com\r\nBcc: attacker@example.com"
    })).toThrow(/EMAIL_FROM.*control characters/);
  });

  it("requires HTTPS for the production web application URL", () => {
    expect(() => loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "",
      WEB_APP_URL: "http://app.example.com"
    })).toThrow(/WEB_APP_URL.*HTTPS.*production/);
    expect(loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "",
      WEB_APP_URL: "https://app.example.com/"
    }).WEB_APP_URL).toBe("https://app.example.com");
  });

  it.each([
    "https://user:password@app.example.com",
    "https://app.example.com/unroutable-base",
    "https://app.example.com?return=attacker",
    "https://app.example.com#attacker"
  ])("rejects constrained WEB_APP_URL value %j", (WEB_APP_URL) => {
    expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS: "", WEB_APP_URL }))
      .toThrow(/WEB_APP_URL/);
  });

  it("allows HTTP localhost only outside production", () => {
    const developmentEnvironment = {
      DATABASE_URL: validEnvironment.DATABASE_URL,
      NODE_ENV: "development",
      SESSION_SECRET: validEnvironment.SESSION_SECRET
    } satisfies NodeJS.ProcessEnv;

    expect(loadConfig({
      ...developmentEnvironment,
      WEB_APP_URL: "http://localhost:5173/"
    }).WEB_APP_URL).toBe("http://localhost:5173");
    expect(loadConfig({
      ...developmentEnvironment,
      WEB_APP_URL: "http://127.0.0.1:4173"
    }).WEB_APP_URL).toBe("http://127.0.0.1:4173");
    expect(() => loadConfig({
      ...developmentEnvironment,
      WEB_APP_URL: "http://app.example.com"
    })).toThrow(/WEB_APP_URL.*localhost.*loopback/);
    expect(() => loadConfig({
      ...developmentEnvironment,
      WEB_APP_URL: "http://127.0.0.1.evil.test"
    })).toThrow(/WEB_APP_URL.*localhost.*loopback/);
  });

  it("rejects malformed WEB_APP_URL values", () => {
    expect(() => loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: "",
      WEB_APP_URL: "javascript:alert(1)"
    })).toThrow(/WEB_APP_URL/);
  });

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
