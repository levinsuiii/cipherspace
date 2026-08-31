export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface User {
  createdAt: string;
  email: string;
  id: string;
}

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

export const userIdentityAlgorithm = "RSA-OAEP-3072-SHA256" as const;

export interface UserCryptoIdentity {
  algorithm: typeof userIdentityAlgorithm;
  createdAt: string;
  keyVersion: number;
  publicKey: string;
  updatedAt: string;
  userId: string;
}

export interface InviteePublicKey {
  email: string;
  identity: Pick<UserCryptoIdentity, "algorithm" | "keyVersion" | "publicKey">;
  userId: string;
}

export interface EncryptedWorkspaceKeyInput {
  algorithm: typeof userIdentityAlgorithm;
  encryptedWorkspaceKey: string;
  recipientKeyVersion: number;
}

export interface WorkspaceKeyShare extends EncryptedWorkspaceKeyInput {
  createdAt: string;
  senderKeyVersion: number;
  senderUserId: string;
  userId: string;
  workspaceId: string;
}

export interface WorkspaceKeyAccess {
  canInitialize: boolean;
  keyShareAvailable: boolean;
}

export interface EncryptionMetadata {
  algorithm: string;
  envelopeVersion: number;
  keyId: string;
}

export interface EncryptedNote {
  createdAt: string;
  createdBy: string;
  deletedAt: string | null;
  encryptedTitle: string | null;
  encryptedTitleNonce: string | null;
  id: string;
  latestVersionId: string;
  updatedAt: string;
  workspaceId: string;
}

export interface NoteVersion {
  clientVersion: string | null;
  contentNonce: string;
  createdAt: string;
  createdBy: string;
  encryptedContent: string;
  encryptionMetadata: EncryptionMetadata;
  id: string;
  noteId: string;
  parentVersionId: string | null;
  versionNumber: number;
}

export interface EncryptedNoteDetail {
  latestVersion: NoteVersion;
  note: EncryptedNote;
}

export interface CreateNoteInput {
  clientVersion?: string;
  contentNonce: string;
  encryptedContent: string;
  encryptedTitle?: string;
  encryptedTitleNonce?: string;
  encryptionMetadata: EncryptionMetadata;
  id?: string;
}

export interface EncryptedComment {
  authorId: string;
  contentNonce: string | null;
  createdAt: string;
  deletedAt: string | null;
  encryptedContent: string | null;
  encryptionMetadata: EncryptionMetadata | null;
  id: string;
  noteId: string;
  parentCommentId: string | null;
  updatedAt: string;
  workspaceId: string;
}

export interface CreateCommentInput {
  contentNonce: string;
  encryptedContent: string;
  encryptionMetadata: EncryptionMetadata;
  id: string;
  parentCommentId?: string | null;
}

export interface Credentials {
  email: string;
  password: string;
}

export type SyncOperationType = "create_note" | "delete_note" | "update_note";

export interface SyncEncryptedPayload {
  algorithm: "AES-GCM";
  ciphertext: string;
  envelopeVersion: 1 | 2;
  keyVersion: number;
  nonce: string;
}

export interface SyncPushChange {
  baseVersionId: string | null;
  clientRevision: number;
  createdAtClient: string;
  encryptedPayload: SyncEncryptedPayload | null;
  noteId: string;
  operationId: string;
  operationType: SyncOperationType;
}

export type SyncPushResult =
  | {
      note: EncryptedNote;
      operationId: string;
      originalStatus?: "accepted";
      status: "accepted" | "duplicate";
      version: NoteVersion;
    }
  | {
      note: EncryptedNote;
      operationId: string;
      originalStatus?: "conflict";
      remoteVersion: NoteVersion;
      status: "conflict" | "duplicate";
    }
  | {
      errorCode: "idempotency_key_reused" | "note_not_found" | "write_forbidden";
      operationId: string;
      status: "rejected";
    };

export interface SyncPushResponse {
  results: SyncPushResult[];
  workspaceId: string;
}

export interface SyncPullChange {
  changeId: string;
  note: EncryptedNote;
  operationType: "delete_note" | "upsert_note_version";
  version: NoteVersion;
}

export interface SyncPullResponse {
  changes: SyncPullChange[];
  hasMore: boolean;
  nextCursor: string;
  workspaceId: string;
}
