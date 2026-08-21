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
import type {
  EncryptedVersionInput,
  NoteRepository,
  StoredEncryptedNote,
  StoredNoteVersion,
  StoredNoteWithLatestVersion
} from "../src/notes/repository.js";
import type { StoredWorkspaceMember, WorkspaceRepository } from "../src/workspaces/repository.js";

const testConfig: AppConfig = {
  AUTH_RATE_LIMIT_MAX: 10,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
  CORS_ORIGINS: ["http://localhost:5173"],
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3000,
  REQUEST_BODY_LIMIT_BYTES: 1_500_000,
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  SESSION_TTL_HOURS: 168
};

const ids = {
  editor: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000001",
  outsider: "00000000-0000-4000-8000-000000000004",
  viewer: "00000000-0000-4000-8000-000000000003",
  workspace: "10000000-0000-4000-8000-000000000001"
};
const now = new Date("2026-08-19T12:00:00.000Z");

class InMemoryAuthRepository implements AuthRepository {
  private readonly sessions = new Map<string, CreateSessionInput>();
  private readonly users = new Map<string, StoredUser>();

  public seedUser(id: string, email: string): string {
    this.users.set(id, { createdAt: now, email, id, passwordHash: "unused" });
    const token = `note-session-${id}`;
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
    throw new Error("Not used by note tests");
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

class InMemoryNoteRepository implements NoteRepository {
  private readonly notes = new Map<string, StoredEncryptedNote>();
  private readonly versions = new Map<string, StoredNoteVersion[]>();

  public async createNote(input: {
    encryptedTitle: Buffer | null;
    encryptedTitleNonce: Buffer | null;
    id: string;
    syncChangeId: string;
    userId: string;
    version: EncryptedVersionInput;
    workspaceId: string;
  }): Promise<StoredNoteWithLatestVersion> {
    const version = this.makeVersion(input.id, input.version, 1, null);
    const note: StoredEncryptedNote = {
      createdAt: now,
      creatorUserId: input.userId,
      currentVersionId: version.id,
      deletedAt: null,
      encryptedTitle: input.encryptedTitle,
      encryptedTitleNonce: input.encryptedTitleNonce,
      id: input.id,
      updatedAt: now,
      workspaceId: input.workspaceId
    };
    this.notes.set(note.id, note);
    this.versions.set(note.id, [version]);
    return { latestVersion: version, note };
  }

  public async listNotes(workspaceId: string): Promise<StoredEncryptedNote[]> {
    return [...this.notes.values()].filter(
      (note) => note.workspaceId === workspaceId && note.deletedAt === null
    );
  }

  public async findNoteWithLatestVersion(
    workspaceId: string,
    noteId: string
  ): Promise<StoredNoteWithLatestVersion | null> {
    const note = this.notes.get(noteId);
    if (!note || note.workspaceId !== workspaceId || note.deletedAt) {
      return null;
    }
    const latestVersion = this.versions.get(noteId)?.at(-1);
    return latestVersion ? { latestVersion, note } : null;
  }

  public async appendVersion(input: {
    noteId: string;
    syncChangeId: string;
    version: EncryptedVersionInput;
    workspaceId: string;
  }): Promise<StoredNoteVersion | null> {
    const note = this.notes.get(input.noteId);
    if (!note || note.workspaceId !== input.workspaceId || note.deletedAt) {
      return null;
    }
    const history = this.versions.get(note.id)!;
    const version = this.makeVersion(
      note.id,
      input.version,
      history.length + 1,
      note.currentVersionId
    );
    history.push(version);
    note.currentVersionId = version.id;
    note.updatedAt = new Date(now.getTime() + history.length * 1_000);
    return version;
  }

  public async listVersions(
    workspaceId: string,
    noteId: string
  ): Promise<StoredNoteVersion[]> {
    const note = this.notes.get(noteId);
    return note && note.workspaceId === workspaceId && !note.deletedAt
      ? [...(this.versions.get(noteId) ?? [])]
      : [];
  }

  public async softDeleteNote(workspaceId: string, noteId: string): Promise<boolean> {
    const note = this.notes.get(noteId);
    if (!note || note.workspaceId !== workspaceId || note.deletedAt) {
      return false;
    }
    note.deletedAt = new Date(now.getTime() + 10_000);
    note.updatedAt = note.deletedAt;
    return true;
  }

  private makeVersion(
    noteId: string,
    input: EncryptedVersionInput,
    versionNumber: number,
    parentVersionId: string | null
  ): StoredNoteVersion {
    return {
      authorUserId: input.authorUserId,
      clientVersion: input.clientVersion,
      createdAt: new Date(now.getTime() + versionNumber * 1_000),
      encryptedPayload: input.encryptedPayload,
      encryptionAlgorithm: input.encryptionAlgorithm,
      envelopeVersion: input.envelopeVersion,
      id: input.id,
      noteId,
      parentVersionId,
      payloadKeyId: input.payloadKeyId,
      payloadNonce: input.payloadNonce,
      versionNumber
    };
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
const notePayload = {
  clientVersion: "device-revision-1",
  contentNonce: Buffer.alloc(12, 7).toString("base64"),
  encryptedContent: Buffer.alloc(32, 9).toString("base64"),
  encryptedTitle: Buffer.alloc(24, 5).toString("base64"),
  encryptedTitleNonce: Buffer.alloc(12, 3).toString("base64"),
  encryptionMetadata: { algorithm: "AES-GCM", envelopeVersion: 1, keyId: "workspace-key-1" }
};

const apps: ReturnType<typeof buildApp>[] = [];
let app: ReturnType<typeof buildApp>;
let cookies: Record<"editor" | "owner" | "outsider" | "viewer", string>;

beforeEach(() => {
  memberships.clear();
  memberships.set(ids.owner, {
    addedAt: now,
    email: "owner@example.com",
    role: "owner",
    userId: ids.owner
  });
  memberships.set(ids.editor, {
    addedAt: now,
    email: "editor@example.com",
    role: "editor",
    userId: ids.editor
  });
  memberships.set(ids.viewer, {
    addedAt: now,
    email: "viewer@example.com",
    role: "viewer",
    userId: ids.viewer
  });

  const authRepository = new InMemoryAuthRepository();
  cookies = {
    editor: authRepository.seedUser(ids.editor, "editor@example.com"),
    owner: authRepository.seedUser(ids.owner, "owner@example.com"),
    outsider: authRepository.seedUser(ids.outsider, "outsider@example.com"),
    viewer: authRepository.seedUser(ids.viewer, "viewer@example.com")
  };
  app = buildApp({
    authRepository,
    config: testConfig,
    database,
    logger: false,
    noteRepository: new InMemoryNoteRepository(),
    workspaceRepository
  });
  apps.push(app);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

async function createNote(cookie = cookies.owner) {
  return app.inject({
    headers: { cookie },
    method: "POST",
    payload: notePayload,
    url: `/api/workspaces/${ids.workspace}/notes`
  });
}

describe("encrypted note routes", () => {
  it.each(["owner", "editor"] as const)("allows the %s role to create an encrypted note", async (role) => {
    const response = await createNote(cookies[role]);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      latestVersion: {
        clientVersion: "device-revision-1",
        encryptedContent: notePayload.encryptedContent,
        parentVersionId: null,
        versionNumber: 1
      },
      note: {
        createdBy: ids[role],
        encryptedTitle: notePayload.encryptedTitle,
        workspaceId: ids.workspace
      }
    });
  });

  it("denies note mutations to viewers", async () => {
    const viewerCreate = await createNote(cookies.viewer);
    expect(viewerCreate.statusCode).toBe(403);
    expect(viewerCreate.json()).toMatchObject({ error: { code: "note_write_forbidden" } });

    const created = await createNote();
    const noteId = created.json().note.id as string;
    const viewerAppend = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "POST",
      payload: {
        ...notePayload,
        encryptedTitle: undefined,
        encryptedTitleNonce: undefined
      },
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}/versions`
    });
    const viewerDelete = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    expect(viewerAppend.statusCode).toBe(403);
    expect(viewerDelete.statusCode).toBe(403);
    expect(viewerDelete.json()).toMatchObject({ error: { code: "note_delete_forbidden" } });
  });

  it("hides workspace notes from non-members", async () => {
    const created = await createNote();
    const noteId = created.json().note.id as string;
    const list = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    const get = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    const history = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}/versions`
    });
    const create = await createNote(cookies.outsider);
    const append = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "POST",
      payload: {
        ...notePayload,
        encryptedTitle: undefined,
        encryptedTitleNonce: undefined
      },
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}/versions`
    });
    const remove = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    expect(list.statusCode).toBe(404);
    expect(get.statusCode).toBe(404);
    expect(history.statusCode).toBe(404);
    expect(create.statusCode).toBe(404);
    expect(append.statusCode).toBe(404);
    expect(remove.statusCode).toBe(404);
    expect(get.json()).toMatchObject({ error: { code: "workspace_not_found" } });
  });

  it("rejects malformed encrypted envelopes at the API boundary", async () => {
    const invalidBase64 = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: { ...notePayload, encryptedContent: "not-base64!" },
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    const unpairedTitleNonce = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: { ...notePayload, encryptedTitleNonce: undefined },
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    const invalidNonce = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: { ...notePayload, contentNonce: Buffer.alloc(13).toString("base64") },
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    const unsupportedAlgorithm = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: {
        ...notePayload,
        encryptionMetadata: { ...notePayload.encryptionMetadata, algorithm: "AES-CBC" }
      },
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    const canonicalCiphertext = Buffer.alloc(16).toString("base64");
    const nonCanonicalBase64 = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: {
        ...notePayload,
        encryptedContent: `${canonicalCiphertext.slice(0, -3)}B==`
      },
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    expect(invalidBase64.statusCode).toBe(400);
    expect(unpairedTitleNonce.statusCode).toBe(400);
    expect(invalidNonce.statusCode).toBe(400);
    expect(unsupportedAlgorithm.statusCode).toBe(400);
    expect(nonCanonicalBase64.statusCode).toBe(400);
    expect(invalidBase64.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("appends immutable versions and returns ordered history to viewers", async () => {
    const created = await createNote();
    const first = created.json().latestVersion as { id: string };
    const noteId = created.json().note.id as string;
    const secondPayload = {
      clientVersion: "device-revision-2",
      contentNonce: Buffer.alloc(12, 8).toString("base64"),
      encryptedContent: Buffer.alloc(32, 4).toString("base64"),
      encryptionMetadata: notePayload.encryptionMetadata
    };
    const appended = await app.inject({
      headers: { cookie: cookies.editor },
      method: "POST",
      payload: secondPayload,
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}/versions`
    });
    expect(appended.statusCode).toBe(201);
    expect(appended.json().version).toMatchObject({
      createdBy: ids.editor,
      encryptedContent: secondPayload.encryptedContent,
      parentVersionId: first.id,
      versionNumber: 2
    });

    const history = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}/versions`
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().versions).toEqual([
      expect.objectContaining({ parentVersionId: null, versionNumber: 1 }),
      expect.objectContaining({ parentVersionId: first.id, versionNumber: 2 })
    ]);

    const detail = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    expect(detail.json()).toMatchObject({
      latestVersion: { encryptedContent: secondPayload.encryptedContent, versionNumber: 2 },
      note: { latestVersionId: appended.json().version.id }
    });
  });

  it("soft-deletes notes as an owner and excludes them from normal reads", async () => {
    const created = await createNote();
    const noteId = created.json().note.id as string;
    const editorDelete = await app.inject({
      headers: { cookie: cookies.editor },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    expect(editorDelete.statusCode).toBe(403);

    const deleted = await app.inject({
      headers: { cookie: cookies.owner },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    expect(deleted.statusCode).toBe(204);

    const list = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes`
    });
    const detail = await app.inject({
      headers: { cookie: cookies.owner },
      method: "GET",
      url: `/api/workspaces/${ids.workspace}/notes/${noteId}`
    });
    expect(list.json()).toEqual({ notes: [] });
    expect(detail.statusCode).toBe(404);
    expect(detail.json()).toMatchObject({ error: { code: "note_not_found" } });
  });
});
