import { beforeAll, describe, expect, it } from "vitest";

import {
  createUserCryptoIdentity,
  decryptCommentContent,
  decryptNoteContent,
  encryptCommentContent,
  encryptNoteContent,
  exportWorkspaceKey,
  generateWorkspaceKey,
  unlockUserCryptoIdentity,
  unwrapWorkspaceKeyShare,
  wrapWorkspaceKeyForRecipient,
  type LocalUserCryptoIdentity
} from "../src/index.js";

const sharedNoteContext = {
  localRevision: 1,
  noteId: "30000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001"
};
const sharedCommentContext = {
  authorId: "20000000-0000-4000-8000-000000000001",
  commentId: "40000000-0000-4000-8000-000000000001",
  noteId: sharedNoteContext.noteId,
  parentCommentId: null,
  workspaceId: sharedNoteContext.workspaceId
};

const recipientId = "00000000-0000-4000-8000-000000000002";
const wrongRecipientId = "00000000-0000-4000-8000-000000000003";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const identityPassword = "recipient account password";
let recipient: LocalUserCryptoIdentity;
let wrongRecipient: LocalUserCryptoIdentity;

beforeAll(async () => {
  [recipient, wrongRecipient] = await Promise.all([
    createUserCryptoIdentity(identityPassword, { userId: recipientId }),
    createUserCryptoIdentity("different account password", { userId: wrongRecipientId })
  ]);
}, 30_000);

describe("user identity workspace-key sharing", () => {
  it("generates a versioned public identity and password-protects the private key", async () => {
    expect(recipient.algorithm).toBe("RSA-OAEP-3072-SHA256");
    expect(recipient.keyVersion).toBe(1);
    expect(recipient.publicKey).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(recipient.protectedPrivateKey).toMatchObject({
      algorithm: "AES-GCM",
      identityAlgorithm: "RSA-OAEP-3072-SHA256",
      identityKeyVersion: 1,
      kdf: "PBKDF2",
      kdfHash: "SHA-256",
      version: 1
    });
    await expect(
      unlockUserCryptoIdentity(recipient, "incorrect account password", { userId: recipientId })
    ).rejects.toMatchObject({ code: "identity_key_unlock_failed" });
    await expect(
      unlockUserCryptoIdentity(recipient, identityPassword, { userId: recipientId })
    ).resolves.toMatchObject({ type: "private" });
  });

  it("wraps the existing workspace key for one recipient and rejects the wrong private key", async () => {
    const workspaceKey = await generateWorkspaceKey();
    const plaintextExport = await exportWorkspaceKey(workspaceKey);
    const share = await wrapWorkspaceKeyForRecipient(workspaceKey, recipient, {
      recipientKeyVersion: recipient.keyVersion,
      recipientUserId: recipientId,
      workspaceId
    });
    expect(share.ciphertext).not.toBe(plaintextExport);
    expect(Buffer.from(share.ciphertext, "base64")).toHaveLength(384);

    const wrongPrivateKey = await unlockUserCryptoIdentity(
      wrongRecipient,
      "different account password",
      { userId: wrongRecipientId }
    );
    await expect(
      unwrapWorkspaceKeyShare(share, wrongPrivateKey, {
        recipientKeyVersion: share.recipientKeyVersion,
        recipientUserId: recipientId,
        workspaceId
      })
    ).rejects.toMatchObject({ code: "workspace_key_share_unlock_failed" });

    const recipientPrivateKey = await unlockUserCryptoIdentity(recipient, identityPassword, {
      userId: recipientId
    });
    const unwrapped = await unwrapWorkspaceKeyShare(share, recipientPrivateKey, {
      recipientKeyVersion: share.recipientKeyVersion,
      recipientUserId: recipientId,
      workspaceId
    });
    expect(await exportWorkspaceKey(unwrapped)).toBe(plaintextExport);
  });

  it("lets the recipient decrypt existing encrypted notes and comments with the shared key", async () => {
    const ownerKey = await generateWorkspaceKey();
    const note = await encryptNoteContent("Existing owner note", ownerKey, sharedNoteContext);
    const comment = await encryptCommentContent(
      "Existing encrypted comment",
      ownerKey,
      sharedCommentContext
    );
    const share = await wrapWorkspaceKeyForRecipient(ownerKey, recipient, {
      recipientKeyVersion: recipient.keyVersion,
      recipientUserId: recipientId,
      workspaceId
    });
    const privateKey = await unlockUserCryptoIdentity(recipient, identityPassword, {
      userId: recipientId
    });
    const recipientKey = await unwrapWorkspaceKeyShare(share, privateKey, {
      recipientKeyVersion: share.recipientKeyVersion,
      recipientUserId: recipientId,
      workspaceId
    });
    await expect(decryptNoteContent(note, recipientKey, sharedNoteContext)).resolves.toBe("Existing owner note");
    await expect(decryptCommentContent(comment, recipientKey, sharedCommentContext)).resolves.toBe(
      "Existing encrypted comment"
    );
  });
});
