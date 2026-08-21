import { randomUUID } from "node:crypto";

import {
  userIdentityAlgorithm,
  type IdentityRepository,
  type StoredUserCryptoIdentity
} from "../identities/repository.js";
import type {
  StoredWorkspace,
  StoredWorkspaceKeyShare,
  StoredWorkspaceMember,
  WorkspaceKeyAccess,
  WorkspaceKeyShareInput,
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
  keyShareStatus: "available" | "missing";
  role: WorkspaceRole;
  userId: string;
}

export interface InviteePublicKey {
  email: string;
  identity: {
    algorithm: typeof userIdentityAlgorithm;
    keyVersion: number;
    publicKey: string;
  };
  userId: string;
}

export interface WorkspaceKeyShare {
  algorithm: typeof userIdentityAlgorithm;
  createdAt: string;
  encryptedWorkspaceKey: string;
  recipientKeyVersion: number;
  senderKeyVersion: number;
  senderUserId: string;
  userId: string;
  workspaceId: string;
}

export interface EncryptedWorkspaceKeyInput {
  algorithm: typeof userIdentityAlgorithm;
  encryptedWorkspaceKey: string;
  recipientKeyVersion: number;
}

export type MemberReference = { email: string } | { userId: string };

export class WorkspaceNotFoundError extends Error {}
export class WorkspaceManagementForbiddenError extends Error {}
export class UserNotFoundError extends Error {}
export class MemberAlreadyExistsError extends Error {}
export class MemberNotFoundError extends Error {}
export class LastOwnerError extends Error {}
export class RecipientIdentityMissingError extends Error {}
export class SenderIdentityMissingError extends Error {}
export class RecipientKeyVersionMismatchError extends Error {}
export class WorkspaceKeyShareNotFoundError extends Error {}

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
    keyShareStatus: member.keyShareStatus,
    role: member.role,
    userId: member.userId
  };
}

function publicKeyShare(share: StoredWorkspaceKeyShare): WorkspaceKeyShare {
  return {
    algorithm: share.algorithm,
    createdAt: share.createdAt.toISOString(),
    encryptedWorkspaceKey: share.encryptedWorkspaceKey,
    recipientKeyVersion: share.recipientKeyVersion,
    senderKeyVersion: share.senderKeyVersion,
    senderUserId: share.senderUserId,
    userId: share.userId,
    workspaceId: share.workspaceId
  };
}

export class WorkspaceService {
  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly identityRepository: IdentityRepository
  ) {}

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
    role: WorkspaceRole,
    encryptedKey: EncryptedWorkspaceKeyInput
  ): Promise<WorkspaceMember> {
    await this.requireOwner(workspaceId, actorUserId);

    const user =
      "email" in reference
        ? await this.repository.findUserByEmail(reference.email)
        : await this.repository.findUserById(reference.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const [senderIdentity, recipientIdentity] = await Promise.all([
      this.identityRepository.findCurrent(actorUserId),
      this.identityRepository.findCurrent(user.id)
    ]);
    if (!senderIdentity) throw new SenderIdentityMissingError();
    if (!recipientIdentity) throw new RecipientIdentityMissingError();
    if (recipientIdentity.keyVersion !== encryptedKey.recipientKeyVersion) {
      throw new RecipientKeyVersionMismatchError();
    }

    const result = await this.repository.addMember({
      actorUserId,
      keyShare: this.keyShareInput(actorUserId, senderIdentity, encryptedKey),
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

  public async getInviteePublicKey(
    workspaceId: string,
    actorUserId: string,
    reference: MemberReference
  ): Promise<InviteePublicKey> {
    await this.requireOwner(workspaceId, actorUserId);
    const user =
      "email" in reference
        ? await this.repository.findUserByEmail(reference.email)
        : await this.repository.findUserById(reference.userId);
    if (!user) throw new UserNotFoundError();
    const identity = await this.identityRepository.findCurrent(user.id);
    if (!identity) throw new RecipientIdentityMissingError();
    return {
      email: user.email,
      identity: {
        algorithm: identity.algorithm,
        keyVersion: identity.keyVersion,
        publicKey: identity.publicKey
      },
      userId: user.id
    };
  }

  public async putKeyShare(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    encryptedKey: EncryptedWorkspaceKeyInput
  ): Promise<WorkspaceKeyShare> {
    await this.requireOwner(workspaceId, actorUserId);
    const [senderIdentity, recipientIdentity] = await Promise.all([
      this.identityRepository.findCurrent(actorUserId),
      this.identityRepository.findCurrent(targetUserId)
    ]);
    if (!senderIdentity) throw new SenderIdentityMissingError();
    if (!recipientIdentity) throw new RecipientIdentityMissingError();
    if (recipientIdentity.keyVersion !== encryptedKey.recipientKeyVersion) {
      throw new RecipientKeyVersionMismatchError();
    }
    const result = await this.repository.putKeyShare({
      actorUserId,
      keyShare: this.keyShareInput(actorUserId, senderIdentity, encryptedKey),
      targetUserId,
      workspaceId
    });
    this.handleMutationResult(result);
    const share = await this.repository.getKeyShare(workspaceId, targetUserId);
    if (!share) throw new Error("Stored workspace key share could not be read");
    return publicKeyShare(share);
  }

  public async getOwnKeyShare(workspaceId: string, userId: string): Promise<WorkspaceKeyShare> {
    await this.requireMembership(workspaceId, userId);
    const share = await this.repository.getKeyShare(workspaceId, userId);
    if (!share) throw new WorkspaceKeyShareNotFoundError();
    return publicKeyShare(share);
  }

  public async getKeyAccess(workspaceId: string, userId: string): Promise<WorkspaceKeyAccess> {
    const access = await this.repository.getKeyAccess(workspaceId, userId);
    if (!access) throw new WorkspaceNotFoundError();
    return access;
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

  private keyShareInput(
    senderUserId: string,
    senderIdentity: StoredUserCryptoIdentity,
    encryptedKey: EncryptedWorkspaceKeyInput
  ): WorkspaceKeyShareInput {
    return {
      algorithm: encryptedKey.algorithm,
      encryptedWorkspaceKey: encryptedKey.encryptedWorkspaceKey,
      id: randomUUID(),
      recipientKeyVersion: encryptedKey.recipientKeyVersion,
      senderKeyVersion: senderIdentity.keyVersion,
      senderUserId
    };
  }
}
