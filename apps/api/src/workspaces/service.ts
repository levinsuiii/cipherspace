import { randomUUID } from "node:crypto";

import type {
  StoredWorkspace,
  StoredWorkspaceMember,
  WorkspaceRepository,
  WorkspaceRole
} from "./repository.js";

export interface Workspace {
  createdAt: string;
  id: string;
  name: string;
  role: WorkspaceRole;
  updatedAt: string;
}

export interface WorkspaceMember {
  addedAt: string;
  email: string;
  role: WorkspaceRole;
  userId: string;
}

export type MemberReference = { email: string } | { userId: string };

export class WorkspaceNotFoundError extends Error {}
export class WorkspaceManagementForbiddenError extends Error {}
export class UserNotFoundError extends Error {}
export class MemberAlreadyExistsError extends Error {}
export class MemberNotFoundError extends Error {}
export class LastOwnerError extends Error {}

function publicWorkspace(workspace: StoredWorkspace): Workspace {
  return {
    createdAt: workspace.createdAt.toISOString(),
    id: workspace.id,
    name: workspace.name,
    role: workspace.role,
    updatedAt: workspace.updatedAt.toISOString()
  };
}

function publicMember(member: StoredWorkspaceMember): WorkspaceMember {
  return {
    addedAt: member.addedAt.toISOString(),
    email: member.email,
    role: member.role,
    userId: member.userId
  };
}

export class WorkspaceService {
  public constructor(private readonly repository: WorkspaceRepository) {}

  public async createWorkspace(userId: string, name: string): Promise<Workspace> {
    return publicWorkspace(
      await this.repository.createWorkspace({ creatorUserId: userId, id: randomUUID(), name })
    );
  }

  public async listWorkspaces(userId: string): Promise<Workspace[]> {
    return (await this.repository.listWorkspaces(userId)).map(publicWorkspace);
  }

  public async getWorkspace(workspaceId: string, userId: string): Promise<Workspace> {
    const workspace = await this.repository.findWorkspaceForMember(workspaceId, userId);
    if (!workspace) {
      throw new WorkspaceNotFoundError();
    }
    return publicWorkspace(workspace);
  }

  public async listMembers(workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
    await this.requireMembership(workspaceId, userId);
    return (await this.repository.listMembers(workspaceId)).map(publicMember);
  }

  public async addMember(
    workspaceId: string,
    actorUserId: string,
    reference: MemberReference,
    role: WorkspaceRole
  ): Promise<WorkspaceMember> {
    await this.requireOwner(workspaceId, actorUserId);

    const user =
      "email" in reference
        ? await this.repository.findUserByEmail(reference.email)
        : await this.repository.findUserById(reference.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const result = await this.repository.addMember({
      actorUserId,
      role,
      targetUserId: user.id,
      workspaceId
    });
    if (result === "forbidden") {
      throw new WorkspaceManagementForbiddenError();
    }
    if (result === "workspace_not_found") {
      throw new WorkspaceNotFoundError();
    }
    if (result === "already_member") {
      throw new MemberAlreadyExistsError();
    }

    const member = await this.repository.findMember(workspaceId, user.id);
    if (!member) {
      throw new Error("Created workspace membership could not be read");
    }
    return publicMember(member);
  }

  public async updateMemberRole(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    role: WorkspaceRole
  ): Promise<WorkspaceMember> {
    await this.requireOwner(workspaceId, actorUserId);
    const result = await this.repository.updateMemberRole({
      actorUserId,
      role,
      targetUserId,
      workspaceId
    });
    this.handleMutationResult(result);

    const member = await this.repository.findMember(workspaceId, targetUserId);
    if (!member) {
      throw new Error("Updated workspace membership could not be read");
    }
    return publicMember(member);
  }

  public async removeMember(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string
  ): Promise<void> {
    await this.requireOwner(workspaceId, actorUserId);
    const result = await this.repository.removeMember({ actorUserId, targetUserId, workspaceId });
    this.handleMutationResult(result);
  }

  private async requireMembership(workspaceId: string, userId: string): Promise<void> {
    if (!(await this.repository.findMember(workspaceId, userId))) {
      throw new WorkspaceNotFoundError();
    }
  }

  private async requireOwner(workspaceId: string, userId: string): Promise<void> {
    const member = await this.repository.findMember(workspaceId, userId);
    if (!member) {
      throw new WorkspaceNotFoundError();
    }
    if (member.role !== "owner") {
      throw new WorkspaceManagementForbiddenError();
    }
  }

  private handleMutationResult(result: string): void {
    if (result === "forbidden") {
      throw new WorkspaceManagementForbiddenError();
    }
    if (result === "workspace_not_found") {
      throw new WorkspaceNotFoundError();
    }
    if (result === "member_not_found") {
      throw new MemberNotFoundError();
    }
    if (result === "last_owner") {
      throw new LastOwnerError();
    }
  }
}
