import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyPassword } from "../src/auth/password.js";
import {
  DisabledEmailVerificationDelivery,
  hashEmailVerificationToken,
  InMemoryEmailVerificationDelivery,
  type EmailVerificationRepository
} from "../src/auth/email-verification.js";
import type {
  AuthRepository,
  CreateSessionInput,
  CreateUserInput,
  StoredUser
} from "../src/auth/repository.js";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import type { Database } from "../src/database/database.js";

const testConfig: AppConfig = {
  AUTH_RATE_LIMIT_MAX: 10,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
  BETA_ALLOWED_EMAILS: [],
  CORS_ORIGINS: ["http://localhost:5173"],
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  DATABASE_POOL_MAX: 10,
  EMAIL_VERIFICATION_TTL_MINUTES: 30,
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3000,
  REQUEST_BODY_LIMIT_BYTES: 1_500_000,
  REGISTRATION_MODE: "open",
  SESSION_COOKIE_SAME_SITE: "strict",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  SESSION_TTL_HOURS: 168,
  TRUST_PROXY: false
};

interface StoredChallenge {
  accountId: string;
  email: string;
  expiresAt: Date;
  kind: "account" | "reclaim";
  passwordHash: string | null;
}

class InMemoryAuthRepository implements AuthRepository, EmailVerificationRepository {
  public readonly challenges = new Map<string, StoredChallenge>();
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
      emailVerifiedAt: null,
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

  public async replaceAccountEmailVerification(input: {
    email: string;
    expiresAt: Date;
    id: string;
    tokenHash: string;
    userId: string;
  }): Promise<boolean> {
    const user = [...this.users.values()].find(({ id }) => id === input.userId);
    if (!user || user.email.toLowerCase() !== input.email || user.emailVerifiedAt) return false;
    for (const [hash, challenge] of this.challenges) {
      if (challenge.kind === "account" && challenge.accountId === input.userId) {
        this.challenges.delete(hash);
      }
    }
    this.challenges.set(input.tokenHash, {
      accountId: input.userId,
      email: input.email,
      expiresAt: input.expiresAt,
      kind: "account",
      passwordHash: null
    });
    return true;
  }

  public async replacePendingEmailReclaim(input: {
    email: string;
    expiresAt: Date;
    id: string;
    passwordHash: string;
    replacementUserId: string;
    tokenHash: string;
  }): Promise<boolean> {
    const claimed = this.users.get(input.email);
    if (!claimed || claimed.emailVerifiedAt) return false;
    for (const [hash, challenge] of this.challenges) {
      if (challenge.kind === "reclaim" && challenge.email === input.email) {
        this.challenges.delete(hash);
      }
    }
    this.challenges.set(input.tokenHash, {
      accountId: input.replacementUserId,
      email: input.email,
      expiresAt: input.expiresAt,
      kind: "reclaim",
      passwordHash: input.passwordHash
    });
    return true;
  }

  public async findEmailVerificationPasswordHash(tokenHash: string): Promise<string | null> {
    const challenge = this.challenges.get(tokenHash);
    if (!challenge || challenge.expiresAt <= new Date()) return null;
    if (challenge.kind === "reclaim") return challenge.passwordHash;
    return [...this.users.values()].find(({ id }) => id === challenge.accountId)?.passwordHash ?? null;
  }

  public async consumeEmailVerification(tokenHash: string, verifiedAt: Date): Promise<StoredUser | null> {
    const challenge = this.challenges.get(tokenHash);
    if (!challenge || challenge.expiresAt <= verifiedAt) {
      this.challenges.delete(tokenHash);
      return null;
    }
    let user: StoredUser | undefined;
    if (challenge.kind === "account") {
      const existing = [...this.users.values()].find(({ id }) => id === challenge.accountId);
      if (!existing || existing.email !== challenge.email || existing.emailVerifiedAt) return null;
      user = { ...existing, emailVerifiedAt: verifiedAt };
      this.users.set(challenge.email, user);
    } else {
      const existing = this.users.get(challenge.email);
      if (existing?.emailVerifiedAt) return null;
      if (existing) {
        this.users.delete(challenge.email);
        const reclaimedEmail = `reclaimed-${existing.id}@invalid.example`;
        this.users.set(reclaimedEmail, { ...existing, email: reclaimedEmail });
      }
      user = {
        createdAt: verifiedAt,
        email: challenge.email,
        emailVerifiedAt: verifiedAt,
        id: challenge.accountId,
        passwordHash: challenge.passwordHash!
      };
      this.users.set(challenge.email, user);
    }
    for (const [hash, candidate] of this.challenges) {
      if (candidate.email === challenge.email) this.challenges.delete(hash);
    }
    return user;
  }
}

const database: Database = {
  close: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] }) as unknown as QueryResult),
  transaction: vi.fn(async (operation) => operation(database))
};

const apps: ReturnType<typeof buildApp>[] = [];
let repository: InMemoryAuthRepository;
let verificationDelivery: InMemoryEmailVerificationDelivery;

beforeEach(() => {
  repository = new InMemoryAuthRepository();
  verificationDelivery = new InMemoryEmailVerificationDelivery("test");
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp(configOverrides: Partial<AppConfig> = {}) {
  const config = { ...testConfig, ...configOverrides };
  const app = buildApp({
    authRepository: repository,
    emailVerificationDelivery:
      config.NODE_ENV === "production"
        ? { sendVerification: async (message) => { verificationDelivery.messages.push(message); } }
        : verificationDelivery,
    emailVerificationRepository: repository,
    config,
    database,
    logger: false
  });
  apps.push(app);
  return app;
}

function closedConfigFromEnvironment(BETA_ALLOWED_EMAILS: string | undefined): AppConfig {
  return loadConfig({
    BETA_ALLOWED_EMAILS,
    DATABASE_URL: testConfig.DATABASE_URL,
    NODE_ENV: "test",
    REGISTRATION_MODE: "closed",
    SESSION_SECRET: testConfig.SESSION_SECRET
  });
}

function sessionCookie(setCookieHeader: string | string[] | undefined): string {
  const value = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!value) {
    throw new Error("Expected a session cookie");
  }

  return value.split(";", 1)[0] ?? "";
}

function deliveredToken(index = verificationDelivery.messages.length - 1): string {
  const token = verificationDelivery.messages[index]?.token;
  if (!token) throw new Error("Expected a delivered verification token");
  return token;
}

describe("authentication routes", () => {
  it("cannot enable token-inspecting or disabled delivery in production", () => {
    expect(() => new InMemoryEmailVerificationDelivery("production")).toThrow(/cannot run in production/);
    expect(() => buildApp({
      authRepository: repository,
      config: { ...testConfig, NODE_ENV: "production" },
      database,
      emailVerificationDelivery: verificationDelivery,
      emailVerificationRepository: repository,
      logger: false
    })).toThrow(/production email verification delivery is required/i);
    expect(() => buildApp({
      authRepository: repository,
      config: { ...testConfig, NODE_ENV: "production" },
      database,
      emailVerificationDelivery: new DisabledEmailVerificationDelivery(),
      emailVerificationRepository: repository,
      logger: false
    })).toThrow(/production email verification delivery is required/);
  });

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
    expect(registration.headers["cache-control"]).toBe("no-store");
    expect(registration.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(registration.headers["x-content-type-options"]).toBe("nosniff");
    expect(registration.headers["set-cookie"]).toContain("HttpOnly");
    expect(registration.headers["set-cookie"]).toContain("Priority=High");
    expect(registration.headers["set-cookie"]).toContain("SameSite=Strict");

    const storedUser = repository.users.get("person@example.com");
    expect(storedUser?.passwordHash).not.toBe(password);
    expect(storedUser?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(storedUser?.passwordHash).toContain("m=19456,p=1,t=2");
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

  it("admits only allowlisted new accounts in closed mode and keeps CS-002 verification", async () => {
    const app = createApp({
      BETA_ALLOWED_EMAILS: ["person@example.com"],
      REGISTRATION_MODE: "closed"
    });

    const registration = await app.inject({
      method: "POST",
      payload: {
        email: "  Person@Example.COM ",
        password: "correct horse battery staple"
      },
      url: "/api/auth/register"
    });

    expect(registration.statusCode).toBe(201);
    expect(registration.json().user).toMatchObject({
      email: "person@example.com",
      emailVerifiedAt: null
    });
    expect(repository.users.has("person@example.com")).toBe(true);
    expect(repository.sessions.size).toBe(1);
    expect(repository.challenges.size).toBe(1);
    expect(verificationDelivery.messages).toHaveLength(1);
  });

  it("rejects non-allowlisted registration before creating any account state", async () => {
    const app = createApp({
      BETA_ALLOWED_EMAILS: ["invited@example.com"],
      REGISTRATION_MODE: "closed"
    });

    const registration = await app.inject({
      method: "POST",
      payload: {
        email: "outsider@example.com",
        password: "correct horse battery staple"
      },
      url: "/api/auth/register"
    });

    expect(registration.statusCode).toBe(403);
    expect(registration.json()).toEqual({
      error: {
        code: "registration_closed",
        message: "CipherSpace befindet sich derzeit in einer geschlossenen Beta. Registrierungen sind nur für eingeladene Tester möglich."
      }
    });
    expect(registration.headers["set-cookie"]).toBeUndefined();
    expect(repository.users.size).toBe(0);
    expect(repository.sessions.size).toBe(0);
    expect(repository.challenges.size).toBe(0);
    expect(verificationDelivery.messages).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", " \t\r\n "]
  ])("permits no new accounts with a closed %s allowlist", async (_label, allowlist) => {
    const app = createApp(closedConfigFromEnvironment(allowlist));
    const registration = await app.inject({
      method: "POST",
      payload: {
        email: "person@example.com",
        password: "correct horse battery staple"
      },
      url: "/api/auth/register"
    });

    expect(registration.statusCode).toBe(403);
    expect(repository.users.size).toBe(0);
  });

  it("does not allow body, query, or header fields to override closed registration config", async () => {
    const app = createApp({ BETA_ALLOWED_EMAILS: [], REGISTRATION_MODE: "closed" });
    const credentials = {
      email: "outsider@example.com",
      password: "correct horse battery staple"
    };
    const attempts = [
      {
        expectedStatus: 400,
        label: "body REGISTRATION_MODE",
        payload: { ...credentials, REGISTRATION_MODE: "open" },
        url: "/api/auth/register"
      },
      {
        expectedStatus: 403,
        label: "query REGISTRATION_MODE",
        payload: credentials,
        url: "/api/auth/register?REGISTRATION_MODE=open"
      },
      {
        expectedStatus: 403,
        headers: { REGISTRATION_MODE: "open" },
        label: "header REGISTRATION_MODE",
        payload: credentials,
        url: "/api/auth/register"
      },
      {
        expectedStatus: 400,
        label: "body BETA_ALLOWED_EMAILS",
        payload: { ...credentials, BETA_ALLOWED_EMAILS: credentials.email },
        url: "/api/auth/register"
      },
      {
        expectedStatus: 403,
        label: "query BETA_ALLOWED_EMAILS",
        payload: credentials,
        url: "/api/auth/register?BETA_ALLOWED_EMAILS=outsider%40example.com"
      },
      {
        expectedStatus: 403,
        headers: { BETA_ALLOWED_EMAILS: credentials.email },
        label: "header BETA_ALLOWED_EMAILS",
        payload: credentials,
        url: "/api/auth/register"
      }
    ];

    for (const attempt of attempts) {
      const response = await app.inject({
        headers: attempt.headers,
        method: "POST",
        payload: attempt.payload,
        url: attempt.url
      });
      expect(response.statusCode, attempt.label).toBe(attempt.expectedStatus);
    }

    expect(repository.users.size).toBe(0);
    expect(repository.sessions.size).toBe(0);
    expect(repository.challenges.size).toBe(0);
    expect(verificationDelivery.messages).toHaveLength(0);
  });

  it("keeps existing-user login and reclaim independent of the current allowlist", async () => {
    const openApp = createApp();
    const password = "correct horse battery staple";
    await openApp.inject({
      method: "POST",
      payload: { email: "existing@example.com", password },
      url: "/api/auth/register"
    });

    const closedApp = createApp({ BETA_ALLOWED_EMAILS: [], REGISTRATION_MODE: "closed" });
    const login = await closedApp.inject({
      method: "POST",
      payload: { email: "EXISTING@example.com", password },
      url: "/api/auth/login"
    });
    const reclaim = await closedApp.inject({
      method: "POST",
      payload: { email: "existing@example.com", password: "replacement password is long" },
      url: "/api/auth/register"
    });

    expect(login.statusCode).toBe(200);
    expect(reclaim.statusCode).toBe(202);
    expect(repository.users.size).toBe(1);
    expect(verificationDelivery.messages).toHaveLength(2);
  });

  it("keeps verified-user verification and reclaim behavior after allowlist removal", async () => {
    const openApp = createApp();
    const password = "correct horse battery staple";
    const registration = await openApp.inject({
      method: "POST",
      payload: { email: "verified@example.com", password },
      url: "/api/auth/register"
    });
    const originalUserId = registration.json().user.id;
    const verification = await openApp.inject({
      method: "POST",
      payload: { password, token: deliveredToken() },
      url: "/api/auth/email-verification/confirm"
    });
    expect(verification.statusCode).toBe(200);

    const deliveriesBefore = verificationDelivery.messages.length;
    const closedApp = createApp({ BETA_ALLOWED_EMAILS: [], REGISTRATION_MODE: "closed" });
    const login = await closedApp.inject({
      method: "POST",
      payload: { email: "VERIFIED@example.com", password },
      url: "/api/auth/login"
    });
    const cookie = sessionCookie(login.headers["set-cookie"]);
    const resend = await closedApp.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/auth/email-verification/request"
    });
    const reclaim = await closedApp.inject({
      method: "POST",
      payload: { email: "verified@example.com", password: "replacement password is long" },
      url: "/api/auth/register"
    });

    expect(login.statusCode).toBe(200);
    expect(resend.statusCode).toBe(202);
    expect(reclaim.statusCode).toBe(202);
    expect(repository.users.get("verified@example.com")).toMatchObject({
      emailVerifiedAt: expect.any(Date),
      id: originalUserId
    });
    expect(repository.challenges.size).toBe(0);
    expect(verificationDelivery.messages).toHaveLength(deliveriesBefore);
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

  it("can issue secure cross-site cookies for a separate production frontend", async () => {
    const app = createApp({ NODE_ENV: "production", SESSION_COOKIE_SAME_SITE: "none" });
    const registration = await app.inject({
      method: "POST",
      payload: { email: "person@example.com", password: "correct horse battery staple" },
      url: "/api/auth/register"
    });

    expect(registration.headers["set-cookie"]).toContain("SameSite=None");
    expect(registration.headers["set-cookie"]).toContain("Secure");
  });

  it("responds generically while starting reclaim only for an unverified duplicate", async () => {
    const app = createApp();
    const payload = { email: "person@example.com", password: "correct horse battery staple" };
    await app.inject({ method: "POST", payload, url: "/api/auth/register" });

    const duplicate = await app.inject({
      method: "POST",
      payload: { ...payload, email: "PERSON@example.com" },
      url: "/api/auth/register"
    });

    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toEqual({
      message: "If this address can be registered, verification instructions will be sent.",
      verificationPending: true
    });
    expect(verificationDelivery.messages).toHaveLength(2);
  });

  it("verifies a mailbox once and never stores or returns the raw token", async () => {
    const app = createApp();
    const password = "correct horse battery staple";
    const registration = await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password },
      url: "/api/auth/register"
    });
    const token = deliveredToken();
    const storedUser = repository.users.get("victim@example.test")!;

    expect(registration.json().user.emailVerifiedAt).toBeNull();
    expect(storedUser.emailVerifiedAt).toBeNull();
    expect(repository.challenges.has(token)).toBe(false);
    expect(repository.challenges.has(hashEmailVerificationToken(token))).toBe(true);
    expect(registration.body).not.toContain(token);

    const confirmation = await app.inject({
      method: "POST",
      payload: { password, token },
      url: "/api/auth/email-verification/confirm"
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json().user.emailVerifiedAt).toEqual(expect.any(String));
    expect(confirmation.body).not.toContain(token);
    expect(repository.users.get("victim@example.test")?.emailVerifiedAt).toBeInstanceOf(Date);

    const replay = await app.inject({
      method: "POST",
      payload: { password, token },
      url: "/api/auth/email-verification/confirm"
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({
      error: { code: "verification_failed", message: "The verification token is invalid or expired." }
    });
  });

  it("rejects wrong tokens, wrong passwords, and expired tokens generically", async () => {
    const app = createApp();
    const password = "correct horse battery staple";
    await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password },
      url: "/api/auth/register"
    });
    const token = deliveredToken();

    const wrongToken = await app.inject({
      method: "POST",
      payload: { password, token: "A".repeat(43) },
      url: "/api/auth/email-verification/confirm"
    });
    const wrongPassword = await app.inject({
      method: "POST",
      payload: { password: "this password is incorrect", token },
      url: "/api/auth/email-verification/confirm"
    });
    repository.challenges.get(hashEmailVerificationToken(token))!.expiresAt = new Date(0);
    const expired = await app.inject({
      method: "POST",
      payload: { password, token },
      url: "/api/auth/email-verification/confirm"
    });

    expect(wrongToken.statusCode).toBe(400);
    expect(wrongPassword.json()).toEqual(wrongToken.json());
    expect(expired.json()).toEqual(wrongToken.json());
    expect(repository.users.get("victim@example.test")?.emailVerifiedAt).toBeNull();
  });

  it("invalidates an older token when a new account verification is requested", async () => {
    const app = createApp();
    const password = "correct horse battery staple";
    const registration = await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password },
      url: "/api/auth/register"
    });
    const cookie = sessionCookie(registration.headers["set-cookie"]);
    const oldToken = deliveredToken();
    const requested = await app.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/auth/email-verification/request"
    });
    const newToken = deliveredToken();

    expect(requested.statusCode).toBe(202);
    expect(newToken).not.toBe(oldToken);
    expect(repository.challenges.has(hashEmailVerificationToken(oldToken))).toBe(false);
    expect((await app.inject({
      method: "POST",
      payload: { password, token: oldToken },
      url: "/api/auth/email-verification/confirm"
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST",
      payload: { password, token: newToken },
      url: "/api/auth/email-verification/confirm"
    })).statusCode).toBe(200);
  });

  it("throttles repeated verification resend requests", async () => {
    const app = createApp();
    const registration = await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password: "correct horse battery staple" },
      url: "/api/auth/register"
    });
    const cookie = sessionCookie(registration.headers["set-cookie"]);

    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(await app.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/auth/email-verification/request"
      }));
    }

    expect(responses.slice(0, 3).every(({ statusCode }) => statusCode === 202)).toBe(true);
    expect(responses[3]?.statusCode).toBe(429);
    expect(responses[3]?.json()).toMatchObject({ error: { code: "rate_limit_exceeded" } });
  });

  it("lets the mailbox owner replace only an unverified pre-claim without taking its resources", async () => {
    const app = createApp();
    const attackerPassword = "attacker password is long enough";
    const ownerPassword = "mailbox owner password is secure";
    const attackerRegistration = await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password: attackerPassword },
      url: "/api/auth/register"
    });
    const attackerCookie = sessionCookie(attackerRegistration.headers["set-cookie"]);
    const attackerId = attackerRegistration.json().user.id;
    const reclaim = await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password: ownerPassword },
      url: "/api/auth/register"
    });
    const reclaimToken = deliveredToken();

    expect(reclaim.statusCode).toBe(202);
    const confirmation = await app.inject({
      method: "POST",
      payload: { password: ownerPassword, token: reclaimToken },
      url: "/api/auth/email-verification/confirm"
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json().user).toMatchObject({
      email: "victim@example.test",
      emailVerifiedAt: expect.any(String)
    });
    expect(confirmation.json().user.id).not.toBe(attackerId);
    const attackerSession = await app.inject({
      headers: { cookie: attackerCookie }, method: "GET", url: "/api/auth/me"
    });
    expect(attackerSession.statusCode).toBe(200);
    expect(attackerSession.json().user.id).toBe(attackerId);
    expect(attackerSession.json().user.email).toMatch(/^reclaimed-/);

    expect((await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password: ownerPassword },
      url: "/api/auth/login"
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password: attackerPassword },
      url: "/api/auth/login"
    })).statusCode).toBe(401);
  });

  it("never starts reclaim for an already verified account", async () => {
    const app = createApp();
    const password = "correct horse battery staple";
    await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password },
      url: "/api/auth/register"
    });
    const token = deliveredToken();
    await app.inject({
      method: "POST",
      payload: { password, token },
      url: "/api/auth/email-verification/confirm"
    });
    const deliveriesBefore = verificationDelivery.messages.length;
    const duplicate = await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password: "new attacker password is long" },
      url: "/api/auth/register"
    });

    expect(duplicate.statusCode).toBe(202);
    expect(verificationDelivery.messages).toHaveLength(deliveriesBefore);
    expect(repository.users.get("victim@example.test")?.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await app.inject({
      method: "POST",
      payload: { email: "victim@example.test", password },
      url: "/api/auth/login"
    })).statusCode).toBe(200);
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

  it("allows only configured credentialed CORS origins", async () => {
    const app = createApp();
    const allowed = await app.inject({
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST"
      },
      method: "OPTIONS",
      url: "/api/auth/login"
    });
    const allowedIdentityRegistration = await app.inject({
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "PUT"
      },
      method: "OPTIONS",
      url: "/api/crypto/identity"
    });
    const denied = await app.inject({
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST"
      },
      method: "OPTIONS",
      url: "/api/auth/login"
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowedIdentityRegistration.statusCode).toBe(204);
    expect(allowedIdentityRegistration.headers["access-control-allow-methods"]).toContain("PUT");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate limits authentication attempts with a safe response", async () => {
    const app = createApp({ AUTH_RATE_LIMIT_MAX: 2 });
    const request = () =>
      app.inject({ method: "POST", payload: {}, url: "/api/auth/login" });

    expect((await request()).statusCode).toBe(400);
    expect((await request()).statusCode).toBe(400);
    const limited = await request();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: {
        code: "rate_limit_exceeded",
        message: "Too many authentication attempts. Try again later."
      }
    });
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("rejects oversized auth bodies without echoing their content", async () => {
    const app = createApp();
    const marker = "sensitive-password-marker";
    const response = await app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: JSON.stringify({ email: "person@example.com", password: marker.repeat(300) }),
      url: "/api/auth/login"
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: { code: "request_too_large", message: "The request body is too large." }
    });
    expect(response.body).not.toContain(marker);
  });

  it("does not expose unexpected internal errors", async () => {
    const app = createApp();
    vi.spyOn(repository, "findUserByEmail").mockRejectedValueOnce(
      new Error("database-internal-secret-token")
    );
    const response = await app.inject({
      method: "POST",
      payload: { email: "person@example.com", password: "correct horse battery staple" },
      url: "/api/auth/login"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "internal_error", message: "An unexpected error occurred." }
    });
    expect(response.body).not.toContain("database-internal-secret-token");
  });
});
