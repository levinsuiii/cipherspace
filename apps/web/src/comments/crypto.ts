import {
  decryptCommentContent,
  encryptCommentContent
} from "@cipherspace/crypto";

import type { CreateCommentInput, EncryptedComment } from "../api/types";

const commentKeyId = "workspace-key-v1";

export async function encryptCommentForApi(
  content: string,
  parentCommentId: string | null,
  workspaceKey: CryptoKey
): Promise<CreateCommentInput> {
  const envelope = await encryptCommentContent(content, workspaceKey);
  return {
    contentNonce: envelope.nonce,
    encryptedContent: envelope.ciphertext,
    encryptionMetadata: {
      algorithm: envelope.algorithm,
      envelopeVersion: envelope.envelopeVersion,
      keyId: commentKeyId
    },
    parentCommentId
  };
}

export async function decryptApiComment(
  comment: EncryptedComment,
  workspaceKey: CryptoKey
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
    comment.encryptionMetadata.envelopeVersion !== 1 ||
    comment.encryptionMetadata.keyId !== commentKeyId
  ) {
    throw new Error("The comment uses unsupported encryption metadata.");
  }
  return decryptCommentContent(
    {
      algorithm: "AES-GCM",
      ciphertext: comment.encryptedContent,
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: comment.contentNonce
    },
    workspaceKey
  );
}
