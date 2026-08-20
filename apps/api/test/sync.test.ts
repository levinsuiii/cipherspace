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
import type { StoredEncryptedNote, StoredNoteVersion } from "../src/notes/repository.js";
import type {
  ProcessSyncOperationResult,
  StoredPullChange,
  StoredSyncOutcome,
  SyncOperationInput,
  SyncRepository
} from "../src/sync/repository.js";
import type { StoredWorkspaceMember, WorkspaceRepository } from "../src/workspaces/repository.js";

const testConfig: AppConfig = {
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3000,
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  SESSION_TTL_HOURS: 168
};

const ids = {
  clientA: "20000000-0000-4000-8000-000000000001",
  clientB: "20000000-0000-4000-8000-000000000002",
  note: "30000000-0000-4000-8000-000000000001",
  operationA: "40000000-0000-4000-8000-000000000001",
  operationB: "40000000-0000-4000-8000-000000000002",
  operationC: "40000000-0000-4000-8000-000000000003",
  outsider: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000001"
};
const now = new Date("2026-08-20T10:00:00.000Z");

class InMemoryAuthRepository implements AuthRepository {
  private readonly sessions = new Map<string, CreateSessionInput>();
  private readonly users = new Map<string, StoredUser>();

  public seedUser(id: string, email: string): string {
    this.users.set(id, { createdAt: now, email, id, passwordHash: "unused" });
    const token = `sync-session-${id}`;
    const tokenHash = hashSessionToken(token, testConfig.SESSION_SECRET);
    this.sessions.set(tokenHash, {
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      id: `session-${id}`,
      tokenHash,
      userId: id
    });
    return `${sessionCookieName}=${token}`;
  }

  public async createUser(_input: CreateUserInput): Promise<StoredUser | null> {
    throw new Error("Not used by sync tests");
  }
  public async findUserByEmail(email: string): Promise<StoredUser | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }
  public async createSession(input: CreateSessionInput): Promise<void> {
    this.sessions.set(input.tokenHash, input);
  }
  public async findUserBySessionTokenHash(tokenHash: string): Promise<StoredUser | null> {
    const session = this.sessions.get(tokenHash);
    return session ? this.users.get(session.userId) ?? null : null;
  }
  public async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

class InMemorySyncRepository implements SyncRepository {
  private readonly changes: StoredPullChange[] = [];
  private readonly notes = new Map<string, StoredEncryptedNote>();
  private readonly operations = new Map<
    string,
    { clientId: string; outcome: StoredSyncOutcome; requestHash: string; userId: string; workspaceId: string }
  >();
  private readonly versions = new Map<string, StoredNoteVersion[]>();

  public versionCount(noteId: string): number {
    return this.versions.get(noteId)?.length ?? 0;
  }

  public async processOperation(input: SyncOperationInput): Promise<ProcessSyncOperationResult> {
    const existing = this.operations.get(input.operationId);
    if (existing) {
      if (
        existing.clientId !== input.clientId ||
        existing.requestHash !== input.requestHash ||
        existing.userId !== input.userId ||
        existing.workspaceId !== input.workspaceId
      ) {
        return { reason: "idempotency_mismatch", rejected: true };
      }
      return { outcome: existing.outcome, replayed: true };
    }

    const current = this.notes.get(input.noteId);
    if (input.operationType === "create_note" && current) {
      return this.storeConflict(input, current);
    }
    if (input.operationType !== "create_note" && !current) {
      return { reason: "note_not_found", rejected: true };
    }
    if (current && current.currentVersionId !== input.baseVersionId) {
      return this.storeConflict(input, current);
    }

    if (input.operationType === "create_note") {
      const version = this.makeVersion(input, 1, null);
      const note: StoredEncryptedNote = {
        createdAt: now,
        creatorUserId: input.userId,
        currentVersionId: version.id,
        deletedAt: null,
        encryptedTitle: null,
        encryptedTitleNonce: null,
        id: input.noteId,
        updatedAt: now,
        workspaceId: input.workspaceId
      };
      this.notes.set(note.id, note);
      this.versions.set(note.id, [version]);
      return this.storeAccepted(input, note, version, "note.version.created");
    }

    const note = current!;
    const history = this.versions.get(note.id)!;
    if (input.operationType === "delete_note") {
      note.deletedAt = new Date(now.getTime() + this.changes.length * 1_000);
      note.updatedAt = note.deletedAt;
      return this.storeAccepted(input, note, history.at(-1)!, "note.deleted");
    }
    const version = this.makeVersion(input, history.length + 1, note.currentVersionId);
    history.push(version);
    note.currentVersionId = version.id;
    note.updatedAt = version.createdAt;
    return this.storeAccepted(input, note, version, "note.version.created");
  }

  public async pullChanges(
    workspaceId: string,
    afterSequence: bigint,
    limit: number
  ): Promise<StoredPullChange[]> {
    return this.changes
      .filter(
        (change) =>
          change.note.workspaceId === workspaceId && change.sequenceNumber > afterSequence
      )
      .slice(0, limit);
  }

  private makeVersion(
    input: SyncOperationInput,
    versionNumber: number,
    parentVersionId: string | null
  ): StoredNoteVersion {
    if (!input.payload) throw new Error("Test update requires a payload");
    return {
      authorUserId: input.userId,
      clientVersion: String(input.clientRevision),
      createdAt: new Date(now.getTime() + (this.changes.length + 1) * 1_000),
      encryptedPayload: input.payload.ciphertext,
      encryptionAlgorithm: input.payload.encryptionAlgorithm,
      envelopeVersion: input.payload.envelopeVersion,
      id: input.versionId,
      noteId: input.noteId,
      parentVersionId,
      payloadKeyId: input.payload.keyId,
      payloadNonce: input.payload.nonce,
      versionNumber
    };
  }

  private storeAccepted(
    input: SyncOperationInput,
    note: StoredEncryptedNote,
    version: StoredNoteVersion,
    changeType: StoredPullChange["changeType"]
  ): ProcessSyncOperationResult {
    const outcome: StoredSyncOutcome = {
      note: { ...note },
      operationType: input.operationType,
      status: "accepted",
      version
    };
    this.operations.set(input.operationId, {
      clientId: input.clientId,
      outcome,
      requestHash: input.requestHash,
      userId: input.userId,
      workspaceId: input.workspaceId
    });
    this.changes.push({
      changeId: input.changeId,
      changeType,
      note: { ...note },
      sequenceNumber: BigInt(this.changes.length + 1),
      version
    });
    return { outcome, replayed: false };
  }

  private storeConflict(
    input: SyncOperationInput,
    note: StoredEncryptedNote
  ): ProcessSyncOperationResult {
    const remoteVersion = this.versions.get(note.id)!.at(-1)!;
    const outcome: StoredSyncOutcome = {
      note: { ...note },
      operationType: input.operationType,
      remoteVersion,
      status: "conflict"
    };
    this.operations.set(input.operationId, {
      clientId: input.clientId,
      outcome,
      requestHash: input.requestHash,
      userId: input.userId,
      workspaceId: input.workspaceId
    });
    return { outcome, replayed: false };
  }
}

const memberships = new Map<string, StoredWorkspaceMember>();
const workspaceRepository = {
  findMember: async (workspaceId: string, userId: string) =>
    workspaceId === ids.workspace ? memberships.get(userId) ?? null : null
} as WorkspaceRepository;
const database: Database = {
  close: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] }) as unknown as QueryResult),
  transaction: vi.fn(async (operation) => operation(database))
};

function payload(byte: number) {
  return {
    algorithm: "AES-GCM",
    ciphertext: Buffer.alloc(32, byte).toString("base64"),
    envelopeVersion: 1,
    keyVersion: 1,
    nonce: Buffer.alloc(12, byte).toString("base64")
  };
}

function change(
  operationId: string,
  operationType: "create_note" | "update_note",
  baseVersionId: string | null,
  revision: number
) {
  return {
    baseVersionId,
    clientRevision: revision,
    createdAtClient: `2026-08-20T10:00:0${revision}.000Z`,
    encryptedPayload: payload(revision),
    noteId: ids.note,
    operationId,
    operationType
  };
}

const apps: ReturnType<typeof buildApp>[] = [];
let app: ReturnType<typeof buildApp>;
let cookies: { outsider: string; owner: string };
let syncRepository: InMemorySyncRepository;

beforeEach(() => {
  memberships.clear();
  memberships.set(ids.owner, {
    addedAt: now,
    email: "owner@example.com",
    role: "owner",
    userId: ids.owner
  });
  const authRepository = new InMemoryAuthRepository();
  cookies = {
    outsider: authRepository.seedUser(ids.outsider, "outsider@example.com"),
    owner: authRepository.seedUser(ids.owner, "owner@example.com")
  };
  syncRepository = new InMemorySyncRepository();
  app = buildApp({
    authRepository,
    config: testConfig,
    database,
    logger: false,
    syncRepository,
    workspaceRepository
  });
  apps.push(app);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

async function push(clientId: string, changes: ReturnType<typeof change>[], cookie = cookies.owner) {
  return app.inject({
    headers: { cookie },
    method: "POST",
    payload: { changes, clientId },
    url: `/api/workspaces/${ids.workspace}/sync/push`
  });
}

describe("encrypted note sync routes", () => {
  it("pushes a note version and returns the same result without duplicating on replay", async () => {
    const create = change(ids.operationA, "create_note", null, 1);
    const first = await push(ids.clientA, [create]);
    const replay = await push(ids.clientA, [create]);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      results: [{ operationId: ids.operationA, status: "accepted", version: { versionNumber: 1 } }],
      workspaceId: ids.workspace
    });
    expect(replay.json()).toMatchObject({
      results: [{ operationId: ids.operationA, originalStatus: "accepted", status: "duplicate" }]
    });
    expect(syncRepository.versionCount(ids.note)).toBe(1);
  });

  it("pulls workspace changes after an opaque cursor", async () => {
    await push(ids.clientA, [change(ids.operationA, "create_note", null, 1)]);
    const firstPull = await app.inject({
      headers: { cookie: cookies.owner },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/sync/pull`
    });
    expect(firstPull.statusCode).toBe(200);
    expect(firstPull.json()).toMatchObject({
      changes: [{ note: { id: ids.note }, operationType: "upsert_note_version" }],
      hasMore: false,
      workspaceId: ids.workspace
    });

    const cursor = firstPull.json().nextCursor as string;
    const secondPull = await app.inject({
      headers: { cookie: cookies.owner },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/sync/pull?cursor=${encodeURIComponent(cursor)}`
    });
    expect(secondPull.json()).toMatchObject({ changes: [], nextCursor: cursor });
  });

  it("detects an update based on an old server version without overwriting", async () => {
    const created = await push(ids.clientA, [change(ids.operationA, "create_note", null, 1)]);
    const firstVersionId = created.json().results[0].version.id as string;
    const remote = await push(ids.clientB, [
      change(ids.operationB, "update_note", firstVersionId, 2)
    ]);
    const remoteVersionId = remote.json().results[0].version.id as string;
    const stale = await push(ids.clientA, [
      change(ids.operationC, "update_note", firstVersionId, 3)
    ]);

    expect(stale.json()).toMatchObject({
      results: [
        {
          operationId: ids.operationC,
          remoteVersion: { id: remoteVersionId, parentVersionId: firstVersionId },
          status: "conflict"
        }
      ]
    });
    expect(syncRepository.versionCount(ids.note)).toBe(2);
  });

  it("denies push and pull to non-members", async () => {
    const deniedPush = await push(
      ids.clientA,
      [change(ids.operationA, "create_note", null, 1)],
      cookies.outsider
    );
    const deniedPull = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/sync/pull`
    });
    expect(deniedPush.statusCode).toBe(404);
    expect(deniedPull.statusCode).toBe(404);
    expect(deniedPush.json()).toMatchObject({ error: { code: "workspace_not_found" } });
  });
});
