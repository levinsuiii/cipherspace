import type { Database, DatabaseSession } from "../database/database.js";
import { userIdentityAlgorithm, userSigningAlgorithm } from "../identities/repository.js";

export const workspaceRoles = ["owner", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export interface SignedWorkspaceKeyShare {
  operationId: string;
  protocolVersion: 2;
  recipient: {
    bundleSequence: number;
    encryptionKeyFingerprint: string;
    encryptionKeyVersion: number;
    signingKeyFingerprint: string;
    userId: string;
  };
  role: WorkspaceRole;
  sender: {
    bundleSequence: number;
    signingKeyFingerprint: string;
    signingKeyVersion: number;
    userId: string;
  };
  signature: { algorithm: typeof userSigningAlgorithm; value: string };
  workspaceId: string;
  workspaceKey: { commitment: string; version: number };
  wrapping: { algorithm: typeof userIdentityAlgorithm; ciphertext: string; labelVersion: 2 };
}

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
  keyShareStatus: "available" | "missing";
  role: WorkspaceRole;
  userId: string;
}

export interface StoredWorkspaceKeyShare {
  createdAt: Date;
  signedShare: SignedWorkspaceKeyShare | null;
  userId: string;
  workspaceId: string;
}

export interface WorkspaceKeyAccess {
  canInitialize: boolean;
  keyShareAvailable: boolean;
  keyShareProtocolVersion: number | null;
}

export interface WorkspaceKeyShareInput {
  signedShare: SignedWorkspaceKeyShare;
}

export type AddMemberResult = "added" | "already_member" | "forbidden" | "workspace_not_found";
export type PutKeyShareResult =
  | "stored"
  | "forbidden"
  | "member_not_found"
  | "workspace_not_found";
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
    keyShare: WorkspaceKeyShareInput;
    role: WorkspaceRole;
    targetUserId: string;
    workspaceId: string;
  }): Promise<AddMemberResult>;
  createWorkspace(input: { creatorUserId: string; id: string; name: string }): Promise<StoredWorkspace>;
  findMember(workspaceId: string, userId: string): Promise<StoredWorkspaceMember | null>;
  findUserByEmail(email: string): Promise<{ email: string; id: string } | null>;
  findUserById(userId: string): Promise<{ email: string; id: string } | null>;
  findWorkspaceForMember(workspaceId: string, userId: string): Promise<StoredWorkspace | null>;
  getKeyAccess(workspaceId: string, userId: string): Promise<WorkspaceKeyAccess | null>;
  getKeyShare(workspaceId: string, userId: string): Promise<StoredWorkspaceKeyShare | null>;
  listMembers(workspaceId: string): Promise<StoredWorkspaceMember[]>;
  listWorkspaces(userId: string): Promise<StoredWorkspace[]>;
  putKeyShare(input: {
    actorUserId: string;
    keyShare: WorkspaceKeyShareInput;
    targetUserId: string;
    workspaceId: string;
  }): Promise<PutKeyShareResult>;
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
  key_share_status: "available" | "missing";
  role: WorkspaceRole;
  user_id: string;
}

interface KeyShareRow {
  created_at: Date;
  protocol_version: number;
  signed_share: SignedWorkspaceKeyShare | null;
  user_id: string;
  workspace_id: string;
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
    keyShareStatus: row.key_share_status,
    role: row.role,
    userId: row.user_id
  };
}

function mapKeyShare(row: KeyShareRow): StoredWorkspaceKeyShare {
  return {
    createdAt: row.created_at,
    signedShare: row.protocol_version === 2 ? row.signed_share : null,
    userId: row.user_id,
    workspaceId: row.workspace_id
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
              workspace_members.added_at,
              CASE WHEN workspace_key_shares.id IS NULL THEN 'missing' ELSE 'available' END
                AS key_share_status
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       LEFT JOIN workspace_key_shares
         ON workspace_key_shares.workspace_id = workspace_members.workspace_id
        AND workspace_key_shares.user_id = workspace_members.user_id
        AND workspace_key_shares.revoked_at IS NULL
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
              workspace_members.added_at,
              CASE WHEN workspace_key_shares.id IS NULL THEN 'missing' ELSE 'available' END
                AS key_share_status
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       LEFT JOIN workspace_key_shares
         ON workspace_key_shares.workspace_id = workspace_members.workspace_id
        AND workspace_key_shares.user_id = workspace_members.user_id
        AND workspace_key_shares.revoked_at IS NULL
       WHERE workspace_members.workspace_id = $1
       ORDER BY workspace_members.added_at ASC, workspace_members.user_id ASC`,
      [workspaceId]
    );
    return result.rows.map(mapMember);
  }

  public async findUserByEmail(email: string): Promise<{ email: string; id: string } | null> {
    const result = await this.database.query<{ email: string; id: string }>(
      `SELECT id, email FROM users
       WHERE normalized_email = lower($1) AND email_verified_at IS NOT NULL
       LIMIT 1`,
      [email]
    );
    return result.rows[0] ?? null;
  }

  public async findUserById(userId: string): Promise<{ email: string; id: string } | null> {
    const result = await this.database.query<{ email: string; id: string }>(
      "SELECT id, email FROM users WHERE id = $1 AND email_verified_at IS NOT NULL LIMIT 1",
      [userId]
    );
    return result.rows[0] ?? null;
  }

  public async addMember(input: {
    actorUserId: string;
    keyShare: WorkspaceKeyShareInput;
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
      if (result.rowCount !== 1) return "already_member";
      await database.query(
        `INSERT INTO workspace_key_shares
           (id, workspace_id, user_id, encrypted_workspace_key, sender_user_id,
            sender_key_version, recipient_key_version, algorithm, protocol_version,
            share_operation_id, signed_share)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 2, $1, $9::jsonb)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET
           id = EXCLUDED.id,
           encrypted_workspace_key = EXCLUDED.encrypted_workspace_key,
           sender_user_id = EXCLUDED.sender_user_id,
           sender_key_version = EXCLUDED.sender_key_version,
           recipient_key_version = EXCLUDED.recipient_key_version,
           algorithm = EXCLUDED.algorithm,
           protocol_version = EXCLUDED.protocol_version,
           share_operation_id = EXCLUDED.share_operation_id,
           signed_share = EXCLUDED.signed_share,
           created_at = now(),
           revoked_at = NULL`,
        [
          input.keyShare.signedShare.operationId,
          input.workspaceId,
          input.targetUserId,
          input.keyShare.signedShare.wrapping.ciphertext,
          input.keyShare.signedShare.sender.userId,
          input.keyShare.signedShare.sender.signingKeyVersion,
          input.keyShare.signedShare.recipient.encryptionKeyVersion,
          input.keyShare.signedShare.wrapping.algorithm,
          JSON.stringify(input.keyShare.signedShare)
        ]
      );
      return "added";
    });
  }

  public async putKeyShare(input: {
    actorUserId: string;
    keyShare: WorkspaceKeyShareInput;
    targetUserId: string;
    workspaceId: string;
  }): Promise<PutKeyShareResult> {
    return this.database.transaction(async (database) => {
      if (!(await lockWorkspace(database, input.workspaceId))) return "workspace_not_found";
      if ((await membershipRole(database, input.workspaceId, input.actorUserId)) !== "owner") {
        return "forbidden";
      }
      if (!(await membershipRole(database, input.workspaceId, input.targetUserId))) {
        return "member_not_found";
      }
      await database.query(
        `INSERT INTO workspace_key_shares
           (id, workspace_id, user_id, encrypted_workspace_key, sender_user_id,
            sender_key_version, recipient_key_version, algorithm, revoked_at,
            protocol_version, share_operation_id, signed_share)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 2, $1, $9::jsonb)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET
           id = EXCLUDED.id,
           encrypted_workspace_key = EXCLUDED.encrypted_workspace_key,
           sender_user_id = EXCLUDED.sender_user_id,
           sender_key_version = EXCLUDED.sender_key_version,
           recipient_key_version = EXCLUDED.recipient_key_version,
           algorithm = EXCLUDED.algorithm,
           protocol_version = EXCLUDED.protocol_version,
           share_operation_id = EXCLUDED.share_operation_id,
           signed_share = EXCLUDED.signed_share,
           created_at = now(),
           revoked_at = NULL`,
        [
          input.keyShare.signedShare.operationId,
          input.workspaceId,
          input.targetUserId,
          input.keyShare.signedShare.wrapping.ciphertext,
          input.keyShare.signedShare.sender.userId,
          input.keyShare.signedShare.sender.signingKeyVersion,
          input.keyShare.signedShare.recipient.encryptionKeyVersion,
          input.keyShare.signedShare.wrapping.algorithm,
          JSON.stringify(input.keyShare.signedShare)
        ]
      );
      return "stored";
    });
  }

  public async getKeyShare(
    workspaceId: string,
    userId: string
  ): Promise<StoredWorkspaceKeyShare | null> {
    const result = await this.database.query<KeyShareRow>(
      `SELECT workspace_key_shares.workspace_id, workspace_key_shares.user_id,
              workspace_key_shares.protocol_version, workspace_key_shares.signed_share,
              workspace_key_shares.created_at
       FROM workspace_members
       JOIN workspace_key_shares
         ON workspace_key_shares.workspace_id = workspace_members.workspace_id
        AND workspace_key_shares.user_id = workspace_members.user_id
        AND workspace_key_shares.revoked_at IS NULL
       WHERE workspace_members.workspace_id = $1 AND workspace_members.user_id = $2
       LIMIT 1`,
      [workspaceId, userId]
    );
    const share = result.rows[0];
    return share ? mapKeyShare(share) : null;
  }

  public async getKeyAccess(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceKeyAccess | null> {
    const result = await this.database.query<{
      can_initialize: boolean;
      key_share_available: boolean;
      key_share_protocol_version: number | null;
    }>(
      `SELECT
         workspace_members.role = 'owner'
           AND (SELECT count(*) FROM workspace_members all_members
                WHERE all_members.workspace_id = $1) = 1
           AND NOT EXISTS (SELECT 1 FROM encrypted_notes WHERE workspace_id = $1)
           AND NOT EXISTS (SELECT 1 FROM workspace_key_shares
                           WHERE workspace_id = $1 AND revoked_at IS NULL)
           AS can_initialize,
         EXISTS (SELECT 1 FROM workspace_key_shares own_share
                 WHERE own_share.workspace_id = $1
                   AND own_share.user_id = $2
                   AND own_share.revoked_at IS NULL) AS key_share_available,
         (SELECT own_share.protocol_version FROM workspace_key_shares own_share
          WHERE own_share.workspace_id = $1 AND own_share.user_id = $2
            AND own_share.revoked_at IS NULL LIMIT 1) AS key_share_protocol_version
       FROM workspace_members
       WHERE workspace_members.workspace_id = $1 AND workspace_members.user_id = $2`,
      [workspaceId, userId]
    );
    const access = result.rows[0];
    return access
      ? {
          canInitialize: access.can_initialize,
          keyShareAvailable: access.key_share_available,
          keyShareProtocolVersion: access.key_share_protocol_version
        }
      : null;
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
      if (targetRole !== input.role) {
        await database.query(
          `UPDATE workspace_key_shares
           SET revoked_at = now()
           WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [input.workspaceId, input.targetUserId]
        );
      }
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
        `UPDATE workspace_key_shares
         SET revoked_at = now()
         WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [input.workspaceId, input.targetUserId]
      );
      await database.query(
        "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [input.workspaceId, input.targetUserId]
      );
      return "removed";
    });
  }
}
