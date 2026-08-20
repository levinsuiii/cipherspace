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
import type {
  CommentRepository,
  CreateStoredCommentInput,
  StoredComment
} from "../src/comments/repository.js";
import type { AppConfig } from "../src/config.js";
import type { Database } from "../src/database/database.js";
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
  editor: "00000000-0000-4000-8000-000000000002",
  note: "30000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000001",
  outsider: "00000000-0000-4000-8000-000000000004",
  viewer: "00000000-0000-4000-8000-000000000003",
  workspace: "10000000-0000-4000-8000-000000000001"
};
const now = new Date("2026-08-20T12:00:00.000Z");

class InMemoryAuthRepository implements AuthRepository {
  private readonly sessions = new Map<string, CreateSessionInput>();
  private readonly users = new Map<string, StoredUser>();

  public seedUser(id: string, email: string): string {
    this.users.set(id, { createdAt: now, email, id, passwordHash: "unused" });
    const token = `comment-session-${id}`;
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
    throw new Error("Not used by comment tests");
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

class InMemoryCommentRepository implements CommentRepository {
  private readonly comments = new Map<string, StoredComment>();

  public async createComment(input: CreateStoredCommentInput): Promise<StoredComment | null> {
    if (!(await this.findActiveNote(input.workspaceId, input.noteId))) return null;
    if (input.parentCommentId && !this.comments.has(input.parentCommentId)) return null;
    const comment: StoredComment = {
      authorUserId: input.authorUserId,
      contentKeyId: input.contentKeyId,
      contentNonce: input.contentNonce,
      createdAt: new Date(now.getTime() + this.comments.size * 1_000),
      deletedAt: null,
      encryptedContent: input.encryptedContent,
      encryptionAlgorithm: input.encryptionAlgorithm,
      envelopeVersion: input.envelopeVersion,
      id: input.id,
      noteId: input.noteId,
      parentCommentId: input.parentCommentId,
      updatedAt: new Date(now.getTime() + this.comments.size * 1_000),
      workspaceId: input.workspaceId
    };
    this.comments.set(comment.id, comment);
    return comment;
  }

  public async findActiveNote(workspaceId: string, noteId: string): Promise<boolean> {
    return workspaceId === ids.workspace && noteId === ids.note;
  }

  public async findComment(
    workspaceId: string,
    noteId: string,
    commentId: string
  ): Promise<StoredComment | null> {
    const comment = this.comments.get(commentId);
    return comment?.workspaceId === workspaceId && comment.noteId === noteId ? comment : null;
  }

  public async listComments(workspaceId: string, noteId: string): Promise<StoredComment[]> {
    return [...this.comments.values()].filter(
      (comment) => comment.workspaceId === workspaceId && comment.noteId === noteId
    );
  }

  public async softDeleteComment(
    workspaceId: string,
    noteId: string,
    commentId: string,
    userId: string
  ): Promise<boolean> {
    const comment = await this.findComment(workspaceId, noteId, commentId);
    const role = memberships.get(userId)?.role;
    if (!comment || comment.deletedAt || (role !== "owner" && !(role === "editor" && comment.authorUserId === userId))) {
      return false;
    }
    comment.contentKeyId = null;
    comment.contentNonce = null;
    comment.deletedAt = new Date(now.getTime() + 10_000);
    comment.encryptedContent = null;
    comment.encryptionAlgorithm = null;
    comment.envelopeVersion = null;
    comment.updatedAt = comment.deletedAt;
    return true;
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
const commentPayload = {
  contentNonce: Buffer.alloc(12, 7).toString("base64"),
  encryptedContent: Buffer.alloc(32, 9).toString("base64"),
  encryptionMetadata: { algorithm: "AES-GCM", envelopeVersion: 1, keyId: "workspace-key-v1" }
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
    commentRepository: new InMemoryCommentRepository(),
    config: testConfig,
    database,
    logger: false,
    workspaceRepository
  });
  apps.push(app);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

function createComment(cookie: string, payload: Record<string, unknown> = commentPayload) {
  return app.inject({
    headers: { cookie },
    method: "POST",
    payload,
    url: `/api/workspaces/${ids.workspace}/notes/${ids.note}/comments`
  });
}

function listComments(cookie: string) {
  return app.inject({
    headers: { cookie },
    method: "GET",
    url: `/api/workspaces/${ids.workspace}/notes/${ids.note}/comments`
  });
}

describe("encrypted comment routes", () => {
  it.each(["owner", "editor"] as const)("allows the %s role to create encrypted comments", async (role) => {
    const response = await createComment(cookies[role]);

    expect(response.statusCode).toBe(201);
    expect(response.json().comment).toMatchObject({
      authorId: ids[role],
      contentNonce: commentPayload.contentNonce,
      deletedAt: null,
      encryptedContent: commentPayload.encryptedContent,
      encryptionMetadata: commentPayload.encryptionMetadata,
      noteId: ids.note,
      parentCommentId: null,
      workspaceId: ids.workspace
    });
  });

  it("allows members to list comments and preserves parent-linked replies", async () => {
    const root = await createComment(cookies.owner);
    const rootId = root.json().comment.id as string;
    const reply = await createComment(cookies.editor, {
      ...commentPayload,
      parentCommentId: rootId
    });

    expect(reply.statusCode).toBe(201);
    const listed = await listComments(cookies.viewer);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().comments).toEqual([
      expect.objectContaining({ id: rootId, parentCommentId: null }),
      expect.objectContaining({ parentCommentId: rootId })
    ]);
  });

  it("keeps viewers read-only", async () => {
    await createComment(cookies.owner);

    expect((await listComments(cookies.viewer)).statusCode).toBe(200);
    const create = await createComment(cookies.viewer);
    expect(create.statusCode).toBe(403);
    expect(create.json()).toMatchObject({ error: { code: "comment_write_forbidden" } });
  });

  it("hides comment reads and writes from non-members", async () => {
    await createComment(cookies.owner);

    const list = await listComments(cookies.outsider);
    const create = await createComment(cookies.outsider);
    expect(list.statusCode).toBe(404);
    expect(create.statusCode).toBe(404);
    expect(list.json()).toMatchObject({ error: { code: "workspace_not_found" } });
  });

  it("lets editors delete their own comments but not another member's comment", async () => {
    const ownerComment = await createComment(cookies.owner);
    const editorDeleteOther = await app.inject({
      headers: { cookie: cookies.editor },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${ids.note}/comments/${ownerComment.json().comment.id}`
    });
    expect(editorDeleteOther.statusCode).toBe(403);

    const created = await createComment(cookies.editor);
    const commentId = created.json().comment.id as string;

    const viewerDelete = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${ids.note}/comments/${commentId}`
    });
    expect(viewerDelete.statusCode).toBe(403);

    const editorDelete = await app.inject({
      headers: { cookie: cookies.editor },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${ids.note}/comments/${commentId}`
    });
    expect(editorDelete.statusCode).toBe(204);
  });

  it("lets owners moderate comments and never exposes deleted ciphertext", async () => {
    const created = await createComment(cookies.editor);
    const commentId = created.json().comment.id as string;

    const deleted = await app.inject({
      headers: { cookie: cookies.owner },
      method: "DELETE",
      url: `/api/workspaces/${ids.workspace}/notes/${ids.note}/comments/${commentId}`
    });
    expect(deleted.statusCode).toBe(204);

    const listed = await listComments(cookies.viewer);
    expect(listed.json().comments).toEqual([
      expect.objectContaining({
        contentNonce: null,
        deletedAt: expect.any(String),
        encryptedContent: null,
        encryptionMetadata: null,
        id: commentId
      })
    ]);
  });
});
