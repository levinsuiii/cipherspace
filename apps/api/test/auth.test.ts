import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyPassword } from "../src/auth/password.js";
import type {
  AuthRepository,
  CreateSessionInput,
  CreateUserInput,
  StoredUser
} from "../src/auth/repository.js";
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

class InMemoryAuthRepository implements AuthRepository {
  public readonly sessions = new Map<string, CreateSessionInput>();
  public readonly users = new Map<string, StoredUser>();

  public async createUser(input: CreateUserInput): Promise<StoredUser | null> {
    const key = input.email.toLowerCase();
    if (this.users.has(key)) {
      return null;
    }

    const user: StoredUser = {
      createdAt: new Date("2026-08-19T12:00:00.000Z"),
      email: input.email,
      id: input.id,
      passwordHash: input.passwordHash
    };
    this.users.set(key, user);
    return user;
  }

  public async findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }

  public async createSession(input: CreateSessionInput): Promise<void> {
    this.sessions.set(input.tokenHash, input);
  }

  public async findUserBySessionTokenHash(tokenHash: string): Promise<StoredUser | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= new Date()) {
      return null;
    }

    return [...this.users.values()].find((user) => user.id === session.userId) ?? null;
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

const database: Database = {
  close: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] }) as unknown as QueryResult)
};

const apps: ReturnType<typeof buildApp>[] = [];
let repository: InMemoryAuthRepository;

beforeEach(() => {
  repository = new InMemoryAuthRepository();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp() {
  const app = buildApp({
    authRepository: repository,
    config: testConfig,
    database,
    logger: false
  });
  apps.push(app);
  return app;
}

function sessionCookie(setCookieHeader: string | string[] | undefined): string {
  const value = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!value) {
    throw new Error("Expected a session cookie");
  }

  return value.split(";", 1)[0] ?? "";
}

describe("authentication routes", () => {
  it("registers a user, hashes the password, creates a session, and returns the current user", async () => {
    const app = createApp();
    const password = "correct horse battery staple";

    const registration = await app.inject({
      method: "POST",
      payload: { email: "  Person@Example.COM ", password },
      url: "/api/auth/register"
    });

    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toMatchObject({
      user: { createdAt: "2026-08-19T12:00:00.000Z", email: "person@example.com" }
    });
    expect(registration.body).not.toContain(password);
    expect(registration.headers["set-cookie"]).toContain("HttpOnly");
    expect(registration.headers["set-cookie"]).toContain("SameSite=Lax");

    const storedUser = repository.users.get("person@example.com");
    expect(storedUser?.passwordHash).not.toBe(password);
    expect(storedUser?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(storedUser?.passwordHash ?? "", password)).toBe(true);

    const cookie = sessionCookie(registration.headers["set-cookie"]);
    const rawToken = cookie.split("=", 2)[1];
    const storedTokenHash = [...repository.sessions.keys()][0];
    expect(storedTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedTokenHash).not.toBe(rawToken);

    const currentUser = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/auth/me"
    });
    expect(currentUser.statusCode).toBe(200);
    expect(currentUser.json()).toEqual(registration.json());
  });

  it("logs in with valid credentials and rejects invalid credentials generically", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      payload: { email: "person@example.com", password: "correct horse battery staple" },
      url: "/api/auth/register"
    });

    const login = await app.inject({
      method: "POST",
      payload: { email: "PERSON@example.com", password: "correct horse battery staple" },
      url: "/api/auth/login"
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { email: "person@example.com" } });
    expect(login.headers["set-cookie"]).toContain("cipherspace_session=");

    const wrongPassword = await app.inject({
      method: "POST",
      payload: { email: "person@example.com", password: "this password is incorrect" },
      url: "/api/auth/login"
    });
    const unknownEmail = await app.inject({
      method: "POST",
      payload: { email: "unknown@example.com", password: "this password is incorrect" },
      url: "/api/auth/login"
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json()).toEqual({
      error: { code: "invalid_credentials", message: "Invalid email or password." }
    });
  });

  it("rejects duplicate accounts without exposing the existing account", async () => {
    const app = createApp();
    const payload = { email: "person@example.com", password: "correct horse battery staple" };
    await app.inject({ method: "POST", payload, url: "/api/auth/register" });

    const duplicate = await app.inject({
      method: "POST",
      payload: { ...payload, email: "PERSON@example.com" },
      url: "/api/auth/register"
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: {
        code: "account_creation_failed",
        message: "Unable to create an account with those credentials."
      }
    });
  });

  it("requires a valid session and invalidates it on logout", async () => {
    const app = createApp();
    const unauthorized = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(unauthorized.statusCode).toBe(401);

    const registration = await app.inject({
      method: "POST",
      payload: { email: "person@example.com", password: "correct horse battery staple" },
      url: "/api/auth/register"
    });
    const cookie = sessionCookie(registration.headers["set-cookie"]);

    const logout = await app.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/auth/logout"
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("cipherspace_session=;");

    const afterLogout = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/auth/me"
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it.each([
    { email: "not-an-email", password: "correct horse battery staple" },
    { email: "person@example.com", password: "too-short" },
    { email: "person@example.com", password: "x".repeat(129) }
  ])("validates email and password inputs", async (payload) => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      payload,
      url: "/api/auth/register"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "validation_failed" } });
    expect(repository.users.size).toBe(0);
  });
});
