import { randomUUID } from "node:crypto";

import type { WorkspaceRepository, WorkspaceRole } from "../workspaces/repository.js";
import type { CommentRepository, StoredComment } from "./repository.js";

export interface CommentEncryptionMetadata {
  algorithm: string;
  envelopeVersion: number;
  keyId: string;
}

export interface CreateCommentData {
  contentNonce: string;
  encryptedContent: string;
  encryptionMetadata: CommentEncryptionMetadata;
  parentCommentId?: string | null;
}

export interface EncryptedComment {
  authorId: string;
  contentNonce: string | null;
  createdAt: string;
  deletedAt: string | null;
  encryptedContent: string | null;
  encryptionMetadata: CommentEncryptionMetadata | null;
  id: string;
  noteId: string;
  parentCommentId: string | null;
  updatedAt: string;
  workspaceId: string;
}

export class CommentNotFoundError extends Error {}
export class CommentParentNotFoundError extends Error {}
export class CommentWriteForbiddenError extends Error {}
export class CommentDeleteForbiddenError extends Error {}
export class CommentWorkspaceNotFoundError extends Error {}
export class CommentNoteNotFoundError extends Error {}

function publicComment(comment: StoredComment): EncryptedComment {
  const deleted = comment.deletedAt !== null;
  return {
    authorId: comment.authorUserId,
    contentNonce: deleted ? null : comment.contentNonce!.toString("base64"),
    createdAt: comment.createdAt.toISOString(),
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    encryptedContent: deleted ? null : comment.encryptedContent!.toString("base64"),
    encryptionMetadata: deleted
      ? null
      : {
          algorithm: comment.encryptionAlgorithm!,
          envelopeVersion: comment.envelopeVersion!,
          keyId: comment.contentKeyId!
        },
    id: comment.id,
    noteId: comment.noteId,
    parentCommentId: comment.parentCommentId,
    updatedAt: comment.updatedAt.toISOString(),
    workspaceId: comment.workspaceId
  };
}

export class CommentService {
  public constructor(
    private readonly repository: CommentRepository,
    private readonly workspaceRepository: WorkspaceRepository
  ) {}

  public async createComment(
    workspaceId: string,
    noteId: string,
    userId: string,
    data: CreateCommentData
  ): Promise<EncryptedComment> {
    if ((await this.role(workspaceId, userId)) === "viewer") {
      throw new CommentWriteForbiddenError();
    }
    await this.requireNote(workspaceId, noteId);
    const parentCommentId = data.parentCommentId ?? null;
    if (
      parentCommentId &&
      !(await this.repository.findComment(workspaceId, noteId, parentCommentId))
    ) {
      throw new CommentParentNotFoundError();
    }

    const comment = await this.repository.createComment({
      authorUserId: userId,
      contentKeyId: data.encryptionMetadata.keyId,
      contentNonce: Buffer.from(data.contentNonce, "base64"),
      encryptedContent: Buffer.from(data.encryptedContent, "base64"),
      encryptionAlgorithm: data.encryptionMetadata.algorithm,
      envelopeVersion: data.encryptionMetadata.envelopeVersion,
      id: randomUUID(),
      noteId,
      parentCommentId,
      workspaceId
    });
    if (!comment) {
      throw new CommentNoteNotFoundError();
    }
    return publicComment(comment);
  }

  public async listComments(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<EncryptedComment[]> {
    await this.role(workspaceId, userId);
    await this.requireNote(workspaceId, noteId);
    return (await this.repository.listComments(workspaceId, noteId, userId)).map(publicComment);
  }

  public async deleteComment(
    workspaceId: string,
    noteId: string,
    commentId: string,
    userId: string
  ): Promise<void> {
    const role = await this.role(workspaceId, userId);
    await this.requireNote(workspaceId, noteId);
    const comment = await this.repository.findComment(workspaceId, noteId, commentId);
    if (!comment) throw new CommentNotFoundError();
    if (comment.deletedAt) return;
    if (role === "viewer" || (role !== "owner" && comment.authorUserId !== userId)) {
      throw new CommentDeleteForbiddenError();
    }
    if (!(await this.repository.softDeleteComment(workspaceId, noteId, commentId, userId))) {
      throw new CommentNotFoundError();
    }
  }

  private async role(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const member = await this.workspaceRepository.findMember(workspaceId, userId);
    if (!member) throw new CommentWorkspaceNotFoundError();
    return member.role;
  }

  private async requireNote(workspaceId: string, noteId: string): Promise<void> {
    if (!(await this.repository.findActiveNote(workspaceId, noteId))) {
      throw new CommentNoteNotFoundError();
    }
  }
}
