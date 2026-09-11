import { randomUUID, webcrypto } from "node:crypto";

import { type IdentityRepository } from "../identities/repository.js";
import type {
  StoredWorkspace,
  StoredWorkspaceKeyShare,
  StoredWorkspaceMember,
  WorkspaceKeyAccess,
  WorkspaceKeyShareInput,
  WorkspaceRepository,
  WorkspaceRole,
  SignedWorkspaceKeyShare
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
  identityBundle: NonNullable<Awaited<ReturnType<IdentityRepository["findCurrent"]>>>;
  userId: string;
}

export interface WorkspaceKeyShare {
  createdAt: string;
  senderIdentityBundle: NonNullable<Awaited<ReturnType<IdentityRepository["findCurrent"]>>>;
  signedShare: SignedWorkspaceKeyShare;
  userId: string;
  workspaceId: string;
}

export type EncryptedWorkspaceKeyInput = SignedWorkspaceKeyShare;

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
export class LegacyWorkspaceKeyShareError extends Error {}
export class InvalidWorkspaceKeyShareError extends Error {}

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

function publicKeyShare(
  share: StoredWorkspaceKeyShare,
  senderIdentityBundle: NonNullable<Awaited<ReturnType<IdentityRepository["findCurrent"]>>>
): WorkspaceKeyShare {
  if (!share.signedShare) throw new LegacyWorkspaceKeyShareError();
  return {
    createdAt: share.createdAt.toISOString(),
    senderIdentityBundle,
    signedShare: share.signedShare,
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
    signedShare: EncryptedWorkspaceKeyInput
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
    await this.validateSignedShare(signedShare, workspaceId, actorUserId, user.id, role, senderIdentity, recipientIdentity);

    const result = await this.repository.addMember({
      actorUserId,
      keyShare: { signedShare },
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
      identityBundle: identity,
      userId: user.id
    };
  }

  public async putKeyShare(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    signedShare: EncryptedWorkspaceKeyInput
  ): Promise<WorkspaceKeyShare> {
    await this.requireOwner(workspaceId, actorUserId);
    const [senderIdentity, recipientIdentity] = await Promise.all([
      this.identityRepository.findCurrent(actorUserId),
      this.identityRepository.findCurrent(targetUserId)
    ]);
    if (!senderIdentity) throw new SenderIdentityMissingError();
    if (!recipientIdentity) throw new RecipientIdentityMissingError();
    const targetMember = await this.repository.findMember(workspaceId, targetUserId);
    if (!targetMember) throw new MemberNotFoundError();
    await this.validateSignedShare(
      signedShare, workspaceId, actorUserId, targetUserId, targetMember.role,
      senderIdentity, recipientIdentity
    );
    const result = await this.repository.putKeyShare({
      actorUserId,
      keyShare: { signedShare },
      targetUserId,
      workspaceId
    });
    this.handleMutationResult(result);
    const share = await this.repository.getKeyShare(workspaceId, targetUserId);
    if (!share) throw new Error("Stored workspace key share could not be read");
    return publicKeyShare(share, senderIdentity);
  }

  public async getOwnKeyShare(workspaceId: string, userId: string): Promise<WorkspaceKeyShare> {
    await this.requireMembership(workspaceId, userId);
    const share = await this.repository.getKeyShare(workspaceId, userId);
    if (!share) throw new WorkspaceKeyShareNotFoundError();
    if (!share.signedShare) throw new LegacyWorkspaceKeyShareError();
    const senderIdentity = await this.identityRepository.findBySequence(
      share.signedShare.sender.userId,
      share.signedShare.sender.bundleSequence
    );
    if (
      !senderIdentity ||
      senderIdentity.bundleSequence !== share.signedShare.sender.bundleSequence ||
      senderIdentity.signingKey.fingerprint !== share.signedShare.sender.signingKeyFingerprint
    ) throw new SenderIdentityMissingError();
    return publicKeyShare(share, senderIdentity);
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

  private async validateSignedShare(
    share: SignedWorkspaceKeyShare,
    workspaceId: string,
    senderUserId: string,
    recipientUserId: string,
    role: WorkspaceRole,
    senderIdentity: NonNullable<Awaited<ReturnType<IdentityRepository["findCurrent"]>>>,
    recipientIdentity: NonNullable<Awaited<ReturnType<IdentityRepository["findCurrent"]>>>
  ): Promise<void> {
    if (
      share.protocolVersion !== 2 || share.workspaceId !== workspaceId || share.sender.userId !== senderUserId ||
      share.sender.signingKeyFingerprint !== senderIdentity.signingKey.fingerprint ||
      share.sender.signingKeyVersion !== senderIdentity.signingKey.keyVersion ||
      share.sender.bundleSequence !== senderIdentity.bundleSequence ||
      share.recipient.userId !== recipientUserId ||
      share.recipient.signingKeyFingerprint !== recipientIdentity.signingKey.fingerprint ||
      share.recipient.bundleSequence !== recipientIdentity.bundleSequence ||
      share.recipient.encryptionKeyFingerprint !== recipientIdentity.encryptionKey.fingerprint ||
      share.recipient.encryptionKeyVersion !== recipientIdentity.encryptionKey.keyVersion ||
      share.role !== role
    ) throw new RecipientKeyVersionMismatchError();
    const body = Buffer.from(JSON.stringify([
      "cipherspace.workspace-key-share", share.protocolVersion, share.operationId, share.workspaceId,
      share.sender.userId, share.sender.signingKeyFingerprint, share.sender.signingKeyVersion,
      share.sender.bundleSequence, share.recipient.userId, share.recipient.signingKeyFingerprint,
      share.recipient.bundleSequence, share.recipient.encryptionKeyFingerprint,
      share.recipient.encryptionKeyVersion, share.role, share.workspaceKey.version,
      share.workspaceKey.commitment, share.wrapping.algorithm, share.wrapping.labelVersion,
      share.wrapping.ciphertext
    ]), "utf8");
    try {
      const key = await webcrypto.subtle.importKey(
        "spki", Buffer.from(senderIdentity.signingKey.publicKey, "base64"),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
      );
      if (!(await webcrypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" }, key,
        Buffer.from(share.signature.value, "base64"), body
      ))) throw new Error("Invalid signature");
    } catch (error) {
      throw new InvalidWorkspaceKeyShareError("Invalid signed workspace key share", { cause: error });
    }
  }
}
