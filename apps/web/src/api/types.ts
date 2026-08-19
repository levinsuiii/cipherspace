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
  role: WorkspaceRole;
  userId: string;
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
}

export interface Credentials {
  email: string;
  password: string;
}
