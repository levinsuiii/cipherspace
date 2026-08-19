import { randomUUID } from "node:crypto";

import type { WorkspaceRepository, WorkspaceRole } from "../workspaces/repository.js";
import type {
  EncryptedVersionInput,
  NoteRepository,
  StoredEncryptedNote,
  StoredNoteVersion,
  StoredNoteWithLatestVersion
} from "./repository.js";

export interface EncryptionMetadata {
  algorithm: string;
  envelopeVersion: number;
  keyId: string;
}

export interface EncryptedVersionData {
  clientVersion?: string | null;
  contentNonce: string;
  encryptedContent: string;
  encryptionMetadata: EncryptionMetadata;
}

export interface CreateEncryptedNoteData extends EncryptedVersionData {
  encryptedTitle?: string | null;
  encryptedTitleNonce?: string | null;
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

export class NoteNotFoundError extends Error {}
export class NoteWriteForbiddenError extends Error {}
export class NoteDeleteForbiddenError extends Error {}
export class NoteWorkspaceNotFoundError extends Error {}

function publicNote(note: StoredEncryptedNote): EncryptedNote {
  return {
    createdAt: note.createdAt.toISOString(),
    createdBy: note.creatorUserId,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    encryptedTitle: note.encryptedTitle?.toString("base64") ?? null,
    encryptedTitleNonce: note.encryptedTitleNonce?.toString("base64") ?? null,
    id: note.id,
    latestVersionId: note.currentVersionId,
    updatedAt: note.updatedAt.toISOString(),
    workspaceId: note.workspaceId
  };
}

function publicVersion(version: StoredNoteVersion): NoteVersion {
  return {
    clientVersion: version.clientVersion,
    contentNonce: version.payloadNonce.toString("base64"),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.authorUserId,
    encryptedContent: version.encryptedPayload.toString("base64"),
    encryptionMetadata: {
      algorithm: version.encryptionAlgorithm,
      envelopeVersion: version.envelopeVersion,
      keyId: version.payloadKeyId
    },
    id: version.id,
    noteId: version.noteId,
    parentVersionId: version.parentVersionId,
    versionNumber: version.versionNumber
  };
}

function publicDetail(detail: StoredNoteWithLatestVersion): EncryptedNoteDetail {
  return { latestVersion: publicVersion(detail.latestVersion), note: publicNote(detail.note) };
}

function storedVersion(userId: string, data: EncryptedVersionData): EncryptedVersionInput {
  return {
    authorUserId: userId,
    clientVersion: data.clientVersion ?? null,
    encryptedPayload: Buffer.from(data.encryptedContent, "base64"),
    encryptionAlgorithm: data.encryptionMetadata.algorithm,
    envelopeVersion: data.encryptionMetadata.envelopeVersion,
    id: randomUUID(),
    payloadKeyId: data.encryptionMetadata.keyId,
    payloadNonce: Buffer.from(data.contentNonce, "base64")
  };
}

export class NoteService {
  public constructor(
    private readonly repository: NoteRepository,
    private readonly workspaceRepository: WorkspaceRepository
  ) {}

  public async createNote(
    workspaceId: string,
    userId: string,
    data: CreateEncryptedNoteData
  ): Promise<EncryptedNoteDetail> {
    await this.requireWriteAccess(workspaceId, userId);
    const detail = await this.repository.createNote({
      encryptedTitle: data.encryptedTitle ? Buffer.from(data.encryptedTitle, "base64") : null,
      encryptedTitleNonce: data.encryptedTitleNonce
        ? Buffer.from(data.encryptedTitleNonce, "base64")
        : null,
      id: randomUUID(),
      userId,
      version: storedVersion(userId, data),
      workspaceId
    });
    if (!detail) {
      throw new NoteWorkspaceNotFoundError();
    }
    return publicDetail(detail);
  }

  public async listNotes(workspaceId: string, userId: string): Promise<EncryptedNote[]> {
    await this.requireReadAccess(workspaceId, userId);
    return (await this.repository.listNotes(workspaceId, userId)).map(publicNote);
  }

  public async getNote(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<EncryptedNoteDetail> {
    await this.requireReadAccess(workspaceId, userId);
    const detail = await this.repository.findNoteWithLatestVersion(workspaceId, noteId, userId);
    if (!detail) {
      throw new NoteNotFoundError();
    }
    return publicDetail(detail);
  }

  public async appendVersion(
    workspaceId: string,
    noteId: string,
    userId: string,
    data: EncryptedVersionData
  ): Promise<NoteVersion> {
    await this.requireWriteAccess(workspaceId, userId);
    const version = await this.repository.appendVersion({
      noteId,
      version: storedVersion(userId, data),
      workspaceId
    });
    if (!version) {
      throw new NoteNotFoundError();
    }
    return publicVersion(version);
  }

  public async listVersions(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<NoteVersion[]> {
    await this.requireReadAccess(workspaceId, userId);
    const versions = await this.repository.listVersions(workspaceId, noteId, userId);
    if (versions.length === 0) {
      throw new NoteNotFoundError();
    }
    return versions.map(publicVersion);
  }

  public async deleteNote(workspaceId: string, noteId: string, userId: string): Promise<void> {
    await this.requireOwnerAccess(workspaceId, userId);
    if (!(await this.repository.softDeleteNote(workspaceId, noteId, userId))) {
      throw new NoteNotFoundError();
    }
  }

  private async role(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const member = await this.workspaceRepository.findMember(workspaceId, userId);
    if (!member) {
      throw new NoteWorkspaceNotFoundError();
    }
    return member.role;
  }

  private async requireReadAccess(workspaceId: string, userId: string): Promise<void> {
    await this.role(workspaceId, userId);
  }

  private async requireWriteAccess(workspaceId: string, userId: string): Promise<void> {
    if ((await this.role(workspaceId, userId)) === "viewer") {
      throw new NoteWriteForbiddenError();
    }
  }

  private async requireOwnerAccess(workspaceId: string, userId: string): Promise<void> {
    if ((await this.role(workspaceId, userId)) !== "owner") {
      throw new NoteDeleteForbiddenError();
    }
  }
}
