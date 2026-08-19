import type { Database, DatabaseSession } from "../database/database.js";

export const workspaceRoles = ["owner", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export interface StoredWorkspace {
  createdAt: Date;
  id: string;
  name: string;
  role: WorkspaceRole;
  updatedAt: Date;
}

export interface StoredWorkspaceMember {
  addedAt: Date;
  email: string;
  role: WorkspaceRole;
  userId: string;
}

export type AddMemberResult = "added" | "already_member" | "forbidden" | "workspace_not_found";
export type UpdateMemberResult =
  | "updated"
  | "forbidden"
  | "last_owner"
  | "member_not_found"
  | "workspace_not_found";
export type RemoveMemberResult =
  | "removed"
  | "forbidden"
  | "last_owner"
  | "member_not_found"
  | "workspace_not_found";

export interface WorkspaceRepository {
  addMember(input: {
    actorUserId: string;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<AddMemberResult>;
  createWorkspace(input: { creatorUserId: string; id: string; name: string }): Promise<StoredWorkspace>;
  findMember(workspaceId: string, userId: string): Promise<StoredWorkspaceMember | null>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  findUserById(userId: string): Promise<{ id: string } | null>;
  findWorkspaceForMember(workspaceId: string, userId: string): Promise<StoredWorkspace | null>;
  listMembers(workspaceId: string): Promise<StoredWorkspaceMember[]>;
  listWorkspaces(userId: string): Promise<StoredWorkspace[]>;
  removeMember(input: {
    actorUserId: string;
    targetUserId: string;
    workspaceId: string;
  }): Promise<RemoveMemberResult>;
  updateMemberRole(input: {
    actorUserId: string;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<UpdateMemberResult>;
}

interface WorkspaceRow {
  created_at: Date;
  id: string;
  name: string;
  role: WorkspaceRole;
  updated_at: Date;
}

interface MemberRow {
  added_at: Date;
  email: string;
  role: WorkspaceRole;
  user_id: string;
}

function mapWorkspace(row: WorkspaceRow): StoredWorkspace {
  return {
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    role: row.role,
    updatedAt: row.updated_at
  };
}

function mapMember(row: MemberRow): StoredWorkspaceMember {
  return {
    addedAt: row.added_at,
    email: row.email,
    role: row.role,
    userId: row.user_id
  };
}

async function lockWorkspace(database: DatabaseSession, workspaceId: string): Promise<boolean> {
  const result = await database.query(
    "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
    [workspaceId]
  );
  return result.rowCount === 1;
}

async function membershipRole(
  database: DatabaseSession,
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const result = await database.query<{ role: WorkspaceRole }>(
    `SELECT role
     FROM workspace_members
     WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  return result.rows[0]?.role ?? null;
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  public constructor(private readonly database: Database) {}

  public async createWorkspace(input: {
    creatorUserId: string;
    id: string;
    name: string;
  }): Promise<StoredWorkspace> {
    return this.database.transaction(async (database) => {
      const result = await database.query<WorkspaceRow>(
        `WITH created_workspace AS (
           INSERT INTO workspaces (id, creator_user_id, name)
           VALUES ($1, $2, $3)
           RETURNING id, name, created_at, updated_at
         ), created_membership AS (
           INSERT INTO workspace_members (workspace_id, user_id, role)
           SELECT id, $2, 'owner' FROM created_workspace
         )
         SELECT id, name, created_at, updated_at, 'owner'::text AS role
         FROM created_workspace`,
        [input.id, input.creatorUserId, input.name]
      );

      const workspace = result.rows[0];
      if (!workspace) {
        throw new Error("Workspace creation did not return a workspace");
      }
      return mapWorkspace(workspace);
    });
  }

  public async listWorkspaces(userId: string): Promise<StoredWorkspace[]> {
    const result = await this.database.query<WorkspaceRow>(
      `SELECT workspaces.id, workspaces.name, workspaces.created_at, workspaces.updated_at,
              workspace_members.role
       FROM workspace_members
       JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       WHERE workspace_members.user_id = $1
       ORDER BY workspaces.created_at ASC, workspaces.id ASC`,
      [userId]
    );
    return result.rows.map(mapWorkspace);
  }

  public async findWorkspaceForMember(
    workspaceId: string,
    userId: string
  ): Promise<StoredWorkspace | null> {
    const result = await this.database.query<WorkspaceRow>(
      `SELECT workspaces.id, workspaces.name, workspaces.created_at, workspaces.updated_at,
              workspace_members.role
       FROM workspace_members
       JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       WHERE workspace_members.workspace_id = $1 AND workspace_members.user_id = $2
       LIMIT 1`,
      [workspaceId, userId]
    );
    const workspace = result.rows[0];
    return workspace ? mapWorkspace(workspace) : null;
  }

  public async findMember(
    workspaceId: string,
    userId: string
  ): Promise<StoredWorkspaceMember | null> {
    const result = await this.database.query<MemberRow>(
      `SELECT workspace_members.user_id, users.email, workspace_members.role,
              workspace_members.added_at
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       WHERE workspace_members.workspace_id = $1 AND workspace_members.user_id = $2
       LIMIT 1`,
      [workspaceId, userId]
    );
    const member = result.rows[0];
    return member ? mapMember(member) : null;
  }

  public async listMembers(workspaceId: string): Promise<StoredWorkspaceMember[]> {
    const result = await this.database.query<MemberRow>(
      `SELECT workspace_members.user_id, users.email, workspace_members.role,
              workspace_members.added_at
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       WHERE workspace_members.workspace_id = $1
       ORDER BY workspace_members.added_at ASC, workspace_members.user_id ASC`,
      [workspaceId]
    );
    return result.rows.map(mapMember);
  }

  public async findUserByEmail(email: string): Promise<{ id: string } | null> {
    const result = await this.database.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [email]
    );
    return result.rows[0] ?? null;
  }

  public async findUserById(userId: string): Promise<{ id: string } | null> {
    const result = await this.database.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 LIMIT 1",
      [userId]
    );
    return result.rows[0] ?? null;
  }

  public async addMember(input: {
    actorUserId: string;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<AddMemberResult> {
    return this.database.transaction(async (database) => {
      if (!(await lockWorkspace(database, input.workspaceId))) {
        return "workspace_not_found";
      }
      if ((await membershipRole(database, input.workspaceId, input.actorUserId)) !== "owner") {
        return "forbidden";
      }

      const result = await database.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING
         RETURNING user_id`,
        [input.workspaceId, input.targetUserId, input.role]
      );
      return result.rowCount === 1 ? "added" : "already_member";
    });
  }

  public async updateMemberRole(input: {
    actorUserId: string;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<UpdateMemberResult> {
    return this.database.transaction(async (database) => {
      if (!(await lockWorkspace(database, input.workspaceId))) {
        return "workspace_not_found";
      }
      if ((await membershipRole(database, input.workspaceId, input.actorUserId)) !== "owner") {
        return "forbidden";
      }

      const targetRole = await membershipRole(database, input.workspaceId, input.targetUserId);
      if (!targetRole) {
        return "member_not_found";
      }
      if (targetRole === "owner" && input.role !== "owner") {
        const owners = await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM workspace_members
           WHERE workspace_id = $1 AND role = 'owner'`,
          [input.workspaceId]
        );
        if (Number(owners.rows[0]?.count ?? 0) <= 1) {
          return "last_owner";
        }
      }

      await database.query(
        `UPDATE workspace_members
         SET role = $3
         WHERE workspace_id = $1 AND user_id = $2`,
        [input.workspaceId, input.targetUserId, input.role]
      );
      return "updated";
    });
  }

  public async removeMember(input: {
    actorUserId: string;
    targetUserId: string;
    workspaceId: string;
  }): Promise<RemoveMemberResult> {
    return this.database.transaction(async (database) => {
      if (!(await lockWorkspace(database, input.workspaceId))) {
        return "workspace_not_found";
      }
      if ((await membershipRole(database, input.workspaceId, input.actorUserId)) !== "owner") {
        return "forbidden";
      }

      const targetRole = await membershipRole(database, input.workspaceId, input.targetUserId);
      if (!targetRole) {
        return "member_not_found";
      }
      if (targetRole === "owner") {
        const owners = await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM workspace_members
           WHERE workspace_id = $1 AND role = 'owner'`,
          [input.workspaceId]
        );
        if (Number(owners.rows[0]?.count ?? 0) <= 1) {
          return "last_owner";
        }
      }

      await database.query(
        "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [input.workspaceId, input.targetUserId]
      );
      return "removed";
    });
  }
}
