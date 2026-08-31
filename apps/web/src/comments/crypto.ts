import {
  decryptCommentContent,
  encryptCommentContent
} from "@cipherspace/crypto";

import type { CreateCommentInput, EncryptedComment } from "../api/types";

const commentKeyId = "workspace-key-v1";

export async function encryptCommentForApi(
  content: string,
  context: {
    authorId: string;
    commentId: string;
    noteId: string;
    parentCommentId: string | null;
    workspaceId: string;
  },
  workspaceKey: CryptoKey
): Promise<CreateCommentInput> {
  const envelope = await encryptCommentContent(content, workspaceKey, context);
  return {
    contentNonce: envelope.nonce,
    encryptedContent: envelope.ciphertext,
    encryptionMetadata: {
      algorithm: envelope.algorithm,
      envelopeVersion: envelope.envelopeVersion,
      keyId: commentKeyId
    },
    id: context.commentId,
    parentCommentId: context.parentCommentId
  };
}

export async function decryptApiComment(
  comment: EncryptedComment,
  workspaceKey: CryptoKey,
  expectedContext: { noteId: string; workspaceId: string }
): Promise<string> {
  if (
    comment.deletedAt ||
    !comment.encryptedContent ||
    !comment.contentNonce ||
    !comment.encryptionMetadata
  ) {
    throw new Error("Deleted comments do not contain encrypted content.");
  }
  if (
    comment.encryptionMetadata.algorithm !== "AES-GCM" ||
    (comment.encryptionMetadata.envelopeVersion !== 1 &&
      comment.encryptionMetadata.envelopeVersion !== 2) ||
    comment.encryptionMetadata.keyId !== commentKeyId
  ) {
    throw new Error("The comment uses unsupported encryption metadata.");
  }
  if (
    comment.workspaceId !== expectedContext.workspaceId ||
    comment.noteId !== expectedContext.noteId
  ) {
    throw new Error("The comment does not belong to the requested note.");
  }
  return decryptCommentContent(
    {
      algorithm: "AES-GCM",
      ciphertext: comment.encryptedContent,
      envelopeVersion: comment.encryptionMetadata.envelopeVersion,
      keyVersion: 1,
      nonce: comment.contentNonce
    },
    workspaceKey,
    comment.encryptionMetadata.envelopeVersion === 2
      ? {
          authorId: comment.authorId,
          commentId: comment.id,
          noteId: expectedContext.noteId,
          parentCommentId: comment.parentCommentId,
          workspaceId: expectedContext.workspaceId
        }
      : undefined
  );
}
