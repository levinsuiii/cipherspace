import { beforeAll, describe, expect, it } from "vitest";

import * as publicCryptoApi from "../src/index.js";

import {
  createUserCryptoIdentity,
  createSignedWorkspaceKeyShare,
  decryptCommentContent,
  decryptNoteContent,
  encryptCommentContent,
  encryptNoteContent,
  exportWorkspaceKey,
  generateWorkspaceKey,
  unlockUserCryptoIdentity,
  unlockUserSigningIdentity,
  upgradeUserCryptoIdentity,
  unwrapVerifiedWorkspaceKeyShare,
  verifyOwnIdentityBundle,
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
let owner: LocalUserCryptoIdentity;
const ownerId = "00000000-0000-4000-8000-000000000004";
const ownerPassword = "owner account password";

beforeAll(async () => {
  [recipient, wrongRecipient, owner] = await Promise.all([
    createUserCryptoIdentity(identityPassword, { userId: recipientId }),
    createUserCryptoIdentity("different account password", { userId: wrongRecipientId }),
    createUserCryptoIdentity(ownerPassword, { userId: ownerId })
  ]);
}, 30_000);

describe("user identity workspace-key sharing", () => {
  it("does not expose unauthenticated recipient-wrapping helpers from the public package", () => {
    expect(publicCryptoApi).not.toHaveProperty("wrapWorkspaceKeyForRecipient");
    expect(publicCryptoApi).not.toHaveProperty("unwrapWorkspaceKeyShare");
  });

  it("upgrades restored legacy RSA material as a chained, newly unverified signing identity", async () => {
    const legacyIdentity: LocalUserCryptoIdentity = {
      algorithm: recipient.algorithm,
      keyVersion: recipient.keyVersion,
      protectedPrivateKey: recipient.protectedPrivateKey,
      publicKey: recipient.publicKey
    };
    const upgraded = await upgradeUserCryptoIdentity(
      legacyIdentity,
      identityPassword,
      { userId: recipientId },
      recipient.identityBundle
    );

    expect(upgraded.identityBundle).toMatchObject({
      bundleSequence: 2,
      previousBundleHash: recipient.identityBundle!.bundleHash,
      encryptionKey: { fingerprint: recipient.identityBundle!.encryptionKey.fingerprint }
    });
    expect(upgraded.identityBundle!.signingKey.fingerprint).not.toBe(recipient.identityBundle!.signingKey.fingerprint);
  });

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

  it("signs a context-bound share and rejects the wrong private key", async () => {
    const workspaceKey = await generateWorkspaceKey();
    const plaintextExport = await exportWorkspaceKey(workspaceKey);
    const verifiedRecipient = await verifyOwnIdentityBundle(recipient.identityBundle!, {
      encryptionPublicKey: recipient.publicKey,
      signingPublicKey: recipient.signingIdentity!.publicKey,
      userId: recipientId
    });
    const signingKey = await unlockUserSigningIdentity(owner.signingIdentity!, ownerPassword, { userId: ownerId });
    const share = await createSignedWorkspaceKeyShare({
      recipient: verifiedRecipient,
      role: "editor",
      senderBundle: owner.identityBundle!,
      senderSigningPrivateKey: signingKey,
      workspaceId,
      workspaceKey
    });
    expect(share.wrapping.ciphertext).not.toBe(plaintextExport);
    expect(Buffer.from(share.wrapping.ciphertext, "base64")).toHaveLength(384);

    const wrongPrivateKey = await unlockUserCryptoIdentity(
      wrongRecipient,
      "different account password",
      { userId: wrongRecipientId }
    );
    await expect(
      unwrapVerifiedWorkspaceKeyShare({
        recipientBundle: recipient.identityBundle!,
        recipientPrivateKey: wrongPrivateKey,
        senderSigningIdentity: owner.identityBundle!.signingKey,
        share,
        workspaceId
      })
    ).rejects.toMatchObject({ code: "workspace_key_share_unlock_failed" });

    const recipientPrivateKey = await unlockUserCryptoIdentity(recipient, identityPassword, {
      userId: recipientId
    });
    const unwrapped = await unwrapVerifiedWorkspaceKeyShare({
      recipientBundle: recipient.identityBundle!,
      recipientPrivateKey,
      senderSigningIdentity: owner.identityBundle!.signingKey,
      share,
      workspaceId
    });
    expect(await exportWorkspaceKey(unwrapped)).toBe(plaintextExport);

    const tampered = structuredClone(share);
    tampered.role = "viewer";
    await expect(unwrapVerifiedWorkspaceKeyShare({
      recipientBundle: recipient.identityBundle!,
      recipientPrivateKey,
      senderSigningIdentity: owner.identityBundle!.signingKey,
      share: tampered,
      workspaceId
    })).rejects.toMatchObject({ code: "workspace_key_share_unlock_failed" });
  });

  it("lets the recipient decrypt existing encrypted notes and comments with the shared key", async () => {
    const ownerKey = await generateWorkspaceKey();
    const note = await encryptNoteContent("Existing owner note", ownerKey, sharedNoteContext);
    const comment = await encryptCommentContent(
      "Existing encrypted comment",
      ownerKey,
      sharedCommentContext
    );
    const verifiedRecipient = await verifyOwnIdentityBundle(recipient.identityBundle!, {
      encryptionPublicKey: recipient.publicKey,
      signingPublicKey: recipient.signingIdentity!.publicKey,
      userId: recipientId
    });
    const share = await createSignedWorkspaceKeyShare({
      recipient: verifiedRecipient,
      role: "viewer",
      senderBundle: owner.identityBundle!,
      senderSigningPrivateKey: await unlockUserSigningIdentity(owner.signingIdentity!, ownerPassword, { userId: ownerId }),
      workspaceId,
      workspaceKey: ownerKey
    });
    const privateKey = await unlockUserCryptoIdentity(recipient, identityPassword, {
      userId: recipientId
    });
    const recipientKey = await unwrapVerifiedWorkspaceKeyShare({
      recipientBundle: recipient.identityBundle!,
      recipientPrivateKey: privateKey,
      senderSigningIdentity: owner.identityBundle!.signingKey,
      share,
      workspaceId
    });
    await expect(decryptNoteContent(note, recipientKey, sharedNoteContext)).resolves.toBe("Existing owner note");
    await expect(decryptCommentContent(comment, recipientKey, sharedCommentContext)).resolves.toBe(
      "Existing encrypted comment"
    );
  });
});
