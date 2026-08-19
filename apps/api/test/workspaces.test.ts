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
  AddMemberResult,
  RemoveMemberResult,
  StoredWorkspace,
  StoredWorkspaceMember,
  UpdateMemberResult,
  WorkspaceRepository,
  WorkspaceRole
} from "../src/workspaces/repository.js";

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
  owner: "00000000-0000-4000-8000-000000000001",
  outsider: "00000000-0000-4000-8000-000000000004",
  viewer: "00000000-0000-4000-8000-000000000003"
};
const now = new Date("2026-08-19T12:00:00.000Z");

class InMemoryAuthRepository implements AuthRepository {
  public readonly sessions = new Map<string, CreateSessionInput>();
  public readonly users = new Map<string, StoredUser>();

  public seedUser(id: string, email: string): string {
    this.users.set(email, { createdAt: now, email, id, passwordHash: "unused" });
    const token = `session-token-${id}`;
    this.sessions.set(hashSessionToken(token, testConfig.SESSION_SECRET), {
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      id: `session-${id}`,
      tokenHash: hashSessionToken(token, testConfig.SESSION_SECRET),
      userId: id
    });
    return `${sessionCookieName}=${token}`;
  }

  public async createUser(_input: CreateUserInput): Promise<StoredUser | null> {
    throw new Error("Not used by workspace tests");
  }

  public async findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }

  public async createSession(input: CreateSessionInput): Promise<void> {
    this.sessions.set(input.tokenHash, input);
  }

  public async findUserBySessionTokenHash(tokenHash: string): Promise<StoredUser | null> {
    const session = this.sessions.get(tokenHash);
    return session
      ? [...this.users.values()].find((user) => user.id === session.userId) ?? null
      : null;
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

interface InMemoryWorkspace {
  createdAt: Date;
  id: string;
  name: string;
  updatedAt: Date;
}

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly memberships = new Map<string, StoredWorkspaceMember>();
  private readonly workspaces = new Map<string, InMemoryWorkspace>();

  public constructor(private readonly users: Map<string, StoredUser>) {}

  private key(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  private storedWorkspace(workspace: InMemoryWorkspace, role: WorkspaceRole): StoredWorkspace {
    return { ...workspace, role };
  }

  public async createWorkspace(input: {
    creatorUserId: string;
    id: string;
    name: string;
  }): Promise<StoredWorkspace> {
    const workspace = { createdAt: now, id: input.id, name: input.name, updatedAt: now };
    this.workspaces.set(input.id, workspace);
    const user = [...this.users.values()].find(({ id }) => id === input.creatorUserId)!;
    this.memberships.set(this.key(input.id, input.creatorUserId), {
      addedAt: now,
      email: user.email,
      role: "owner",
      userId: input.creatorUserId
    });
    return this.storedWorkspace(workspace, "owner");
  }

  public async listWorkspaces(userId: string): Promise<StoredWorkspace[]> {
    return [...this.workspaces.values()]
      .flatMap((workspace) => {
        const membership = this.memberships.get(this.key(workspace.id, userId));
        return membership ? [this.storedWorkspace(workspace, membership.role)] : [];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public async findWorkspaceForMember(
    workspaceId: string,
    userId: string
  ): Promise<StoredWorkspace | null> {
    const workspace = this.workspaces.get(workspaceId);
    const membership = this.memberships.get(this.key(workspaceId, userId));
    return workspace && membership ? this.storedWorkspace(workspace, membership.role) : null;
  }

  public async findMember(
    workspaceId: string,
    userId: string
  ): Promise<StoredWorkspaceMember | null> {
    return this.memberships.get(this.key(workspaceId, userId)) ?? null;
  }

  public async listMembers(workspaceId: string): Promise<StoredWorkspaceMember[]> {
    return [...this.memberships.entries()]
      .filter(([key]) => key.startsWith(`${workspaceId}:`))
      .map(([, member]) => member);
  }

  public async findUserByEmail(email: string): Promise<{ id: string } | null> {
    const user = this.users.get(email.toLowerCase());
    return user ? { id: user.id } : null;
  }

  public async findUserById(userId: string): Promise<{ id: string } | null> {
    const user = [...this.users.values()].find(({ id }) => id === userId);
    return user ? { id: user.id } : null;
  }

  public async addMember(input: {
    actorUserId: string;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<AddMemberResult> {
    if (!this.workspaces.has(input.workspaceId)) return "workspace_not_found";
    if (this.memberships.get(this.key(input.workspaceId, input.actorUserId))?.role !== "owner") {
      return "forbidden";
    }
    const key = this.key(input.workspaceId, input.targetUserId);
    if (this.memberships.has(key)) return "already_member";
    const user = [...this.users.values()].find(({ id }) => id === input.targetUserId)!;
    this.memberships.set(key, {
      addedAt: now,
      email: user.email,
      role: input.role,
      userId: input.targetUserId
    });
    return "added";
  }

  public async updateMemberRole(input: {
    actorUserId: string;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<UpdateMemberResult> {
    if (!this.workspaces.has(input.workspaceId)) return "workspace_not_found";
    if (this.memberships.get(this.key(input.workspaceId, input.actorUserId))?.role !== "owner") {
      return "forbidden";
    }
    const key = this.key(input.workspaceId, input.targetUserId);
    const target = this.memberships.get(key);
    if (!target) return "member_not_found";
    if (target.role === "owner" && input.role !== "owner" && this.ownerCount(input.workspaceId) === 1) {
      return "last_owner";
    }
    this.memberships.set(key, { ...target, role: input.role });
    return "updated";
  }

  public async removeMember(input: {
    actorUserId: string;
    targetUserId: string;
    workspaceId: string;
  }): Promise<RemoveMemberResult> {
    if (!this.workspaces.has(input.workspaceId)) return "workspace_not_found";
    if (this.memberships.get(this.key(input.workspaceId, input.actorUserId))?.role !== "owner") {
      return "forbidden";
    }
    const key = this.key(input.workspaceId, input.targetUserId);
    const target = this.memberships.get(key);
    if (!target) return "member_not_found";
    if (target.role === "owner" && this.ownerCount(input.workspaceId) === 1) return "last_owner";
    this.memberships.delete(key);
    return "removed";
  }

  private ownerCount(workspaceId: string): number {
    return [...this.memberships.entries()].filter(
      ([key, member]) => key.startsWith(`${workspaceId}:`) && member.role === "owner"
    ).length;
  }
}

const database: Database = {
  close: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] }) as unknown as QueryResult),
  transaction: vi.fn(async (operation) => operation(database))
};
const apps: ReturnType<typeof buildApp>[] = [];
let app: ReturnType<typeof buildApp>;
let authRepository: InMemoryAuthRepository;
let cookies: Record<keyof typeof ids, string>;

beforeEach(() => {
  authRepository = new InMemoryAuthRepository();
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
    workspaceRepository: new InMemoryWorkspaceRepository(authRepository.users)
  });
  apps.push(app);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

async function createWorkspace(cookie = cookies.owner, name = "Product") {
  const response = await app.inject({
    headers: { cookie },
    method: "POST",
    payload: { name },
    url: "/api/workspaces"
  });
  expect(response.statusCode).toBe(201);
  return response.json().workspace as { id: string; name: string; role: WorkspaceRole };
}

async function addMember(
  workspaceId: string,
  payload: { email?: string; role: WorkspaceRole; userId?: string },
  cookie = cookies.owner
) {
  return app.inject({
    headers: { cookie },
    method: "POST",
    payload,
    url: `/api/workspaces/${workspaceId}/members`
  });
}

describe("workspace routes", () => {
  it("creates a workspace with the creator as owner and lists only the user's workspaces", async () => {
    const ownWorkspace = await createWorkspace();
    await createWorkspace(cookies.outsider, "Outsider workspace");

    expect(ownWorkspace).toMatchObject({ name: "Product", role: "owner" });
    const list = await app.inject({
      headers: { cookie: cookies.owner },
      method: "GET",
      url: "/api/workspaces"
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().workspaces).toEqual([expect.objectContaining({ id: ownWorkspace.id })]);
  });

  it("allows members to read workspace details and hides them from non-members", async () => {
    const workspace = await createWorkspace();
    expect(
      (await addMember(workspace.id, { email: "editor@example.com", role: "editor" })).statusCode
    ).toBe(201);

    const memberAccess = await app.inject({
      headers: { cookie: cookies.editor },
      method: "GET",
      url: `/api/workspaces/${workspace.id}`
    });
    const outsiderAccess = await app.inject({
      headers: { cookie: cookies.outsider },
      method: "GET",
      url: `/api/workspaces/${workspace.id}`
    });
    expect(memberAccess.statusCode).toBe(200);
    expect(memberAccess.json().workspace).toMatchObject({ id: workspace.id, role: "editor" });
    expect(outsiderAccess.statusCode).toBe(404);
    expect(outsiderAccess.json()).toMatchObject({ error: { code: "workspace_not_found" } });
  });

  it("lets an owner add existing users by email or user id with every supported role", async () => {
    const workspace = await createWorkspace();
    const editor = await addMember(workspace.id, { email: "EDITOR@example.com", role: "editor" });
    const viewer = await addMember(workspace.id, { role: "viewer", userId: ids.viewer });
    const owner = await addMember(workspace.id, { role: "owner", userId: ids.outsider });

    expect(editor.statusCode).toBe(201);
    expect(editor.json().member).toMatchObject({ email: "editor@example.com", role: "editor" });
    expect(viewer.statusCode).toBe(201);
    expect(viewer.json().member).toMatchObject({ role: "viewer", userId: ids.viewer });
    expect(owner.statusCode).toBe(201);
    expect(owner.json().member).toMatchObject({ role: "owner", userId: ids.outsider });

    const members = await app.inject({
      headers: { cookie: cookies.viewer },
      method: "GET",
      url: `/api/workspaces/${workspace.id}/members`
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "owner", userId: ids.owner }),
        expect.objectContaining({ role: "editor", userId: ids.editor }),
        expect.objectContaining({ role: "viewer", userId: ids.viewer })
      ])
    );
  });

  it("denies member management to non-owners", async () => {
    const workspace = await createWorkspace();
    await addMember(workspace.id, { role: "editor", userId: ids.editor });

    const response = await addMember(
      workspace.id,
      { role: "viewer", userId: ids.viewer },
      cookies.editor
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "workspace_management_forbidden" }
    });
  });

  it("validates membership roles and member references", async () => {
    const workspace = await createWorkspace();
    const invalidRole = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: { role: "admin", userId: ids.editor },
      url: `/api/workspaces/${workspace.id}/members`
    });
    const ambiguousReference = await app.inject({
      headers: { cookie: cookies.owner },
      method: "POST",
      payload: { email: "editor@example.com", role: "editor", userId: ids.editor },
      url: `/api/workspaces/${workspace.id}/members`
    });
    expect(invalidRole.statusCode).toBe(400);
    expect(ambiguousReference.statusCode).toBe(400);
  });

  it("prevents the last owner from being downgraded or removed", async () => {
    const workspace = await createWorkspace();
    const downgrade = await app.inject({
      headers: { cookie: cookies.owner },
      method: "PATCH",
      payload: { role: "editor" },
      url: `/api/workspaces/${workspace.id}/members/${ids.owner}`
    });
    const removal = await app.inject({
      headers: { cookie: cookies.owner },
      method: "DELETE",
      url: `/api/workspaces/${workspace.id}/members/${ids.owner}`
    });
    expect(downgrade.statusCode).toBe(409);
    expect(removal.statusCode).toBe(409);
    expect(downgrade.json()).toMatchObject({ error: { code: "last_owner_required" } });
  });

  it("lets owners change roles and remove members when another owner remains", async () => {
    const workspace = await createWorkspace();
    await addMember(workspace.id, { role: "owner", userId: ids.outsider });

    const downgrade = await app.inject({
      headers: { cookie: cookies.owner },
      method: "PATCH",
      payload: { role: "viewer" },
      url: `/api/workspaces/${workspace.id}/members/${ids.outsider}`
    });
    const removal = await app.inject({
      headers: { cookie: cookies.owner },
      method: "DELETE",
      url: `/api/workspaces/${workspace.id}/members/${ids.outsider}`
    });
    expect(downgrade.statusCode).toBe(200);
    expect(downgrade.json().member).toMatchObject({ role: "viewer", userId: ids.outsider });
    expect(removal.statusCode).toBe(204);
  });
});
