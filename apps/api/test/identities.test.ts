import { generateKeyPairSync } from "node:crypto";

import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthRepository,
  CreateSessionInput,
  CreateUserInput,
  StoredUser
} from "../src/auth/repository.js";
import { hashSessionToken, sessionCookieName } from "../src/auth/session.js";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { Database } from "../src/database/database.js";
import {
  userIdentityAlgorithm,
  type IdentityRepository,
  type RegisterIdentityResult,
  type StoredUserCryptoIdentity
} from "../src/identities/repository.js";

const config: AppConfig = {
  AUTH_RATE_LIMIT_MAX: 10,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
  CORS_ORIGINS: ["http://localhost:5173"],
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  DATABASE_POOL_MAX: 10,
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3000,
  REQUEST_BODY_LIMIT_BYTES: 1_500_000,
  SESSION_COOKIE_SAME_SITE: "strict",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  SESSION_TTL_HOURS: 168,
  TRUST_PROXY: false
};
const user: StoredUser = {
  createdAt: new Date("2026-08-21T10:00:00.000Z"),
  email: "identity@example.com",
  id: "00000000-0000-4000-8000-000000000001",
  passwordHash: "unused"
};

class TestAuthRepository implements AuthRepository {
  private readonly tokenHash: string;

  public constructor(token: string) {
    this.tokenHash = hashSessionToken(token, config.SESSION_SECRET);
  }

  public async createSession(_input: CreateSessionInput): Promise<void> {}
  public async createUser(_input: CreateUserInput): Promise<StoredUser | null> { return null; }
  public async deleteSession(_tokenHash: string): Promise<void> {}
  public async findUserByEmail(_email: string): Promise<StoredUser | null> { return null; }
  public async findUserBySessionTokenHash(tokenHash: string): Promise<StoredUser | null> {
    return tokenHash === this.tokenHash ? user : null;
  }
}

class TestIdentityRepository implements IdentityRepository {
  public stored: StoredUserCryptoIdentity | null = null;

  public async findCurrent(userId: string) {
    return this.stored?.userId === userId ? this.stored : null;
  }

  public async register(input: {
    algorithm: typeof userIdentityAlgorithm;
    keyVersion: number;
    publicKey: string;
    userId: string;
  }): Promise<RegisterIdentityResult> {
    if (this.stored) {
      return this.stored.publicKey === input.publicKey && this.stored.keyVersion === input.keyVersion
        ? { identity: this.stored, status: "unchanged" }
        : { status: "version_conflict" };
    }
    this.stored = {
      ...input,
      createdAt: user.createdAt,
      updatedAt: user.createdAt
    };
    return { identity: this.stored, status: "created" };
  }
}

const database: Database = {
  close: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] }) as unknown as QueryResult),
  transaction: vi.fn(async (operation) => operation(database))
};
const token = "identity-session-token";
const cookie = `${sessionCookieName}=${token}`;
let app: ReturnType<typeof buildApp>;
let identities: TestIdentityRepository;

beforeEach(() => {
  identities = new TestIdentityRepository();
  app = buildApp({
    authRepository: new TestAuthRepository(token),
    config,
    database,
    identityRepository: identities,
    logger: false
  });
});

afterEach(async () => {
  await app.close();
});

describe("user crypto identity routes", () => {
  it("registers and returns only a validated public identity key", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const encodedPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const response = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: {
        algorithm: userIdentityAlgorithm,
        keyVersion: 1,
        publicKey: encodedPublicKey
      },
      url: "/api/crypto/identity"
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().identity).toMatchObject({
      algorithm: userIdentityAlgorithm,
      keyVersion: 1,
      publicKey: encodedPublicKey,
      userId: user.id
    });
    expect(identities.stored).not.toHaveProperty("privateKey");

    const current = await app.inject({ headers: { cookie }, method: "GET", url: "/api/crypto/identity" });
    expect(current.statusCode).toBe(200);
    expect(current.json().identity).not.toHaveProperty("privateKey");
  });

  it("rejects private key fields at the API boundary", async () => {
    const response = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: {
        algorithm: userIdentityAlgorithm,
        keyVersion: 1,
        privateKey: "must-never-be-accepted",
        publicKey: "AAAA"
      },
      url: "/api/crypto/identity"
    });
    expect(response.statusCode).toBe(400);
    expect(identities.stored).toBeNull();
  });
});
