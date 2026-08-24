import { beforeAll, describe, expect, it } from "vitest";

import {
  createUserCryptoIdentity,
  decryptNoteContent,
  encryptNoteContent,
  exportUserRecoveryKit,
  generateWorkspaceKey,
  importUserRecoveryKit,
  unlockUserCryptoIdentity,
  unwrapWorkspaceKeyShare,
  wrapWorkspaceKeyForRecipient,
  type EncryptedUserRecoveryKit,
  type LocalUserCryptoIdentity
} from "../src/index.js";
import { encodeBase64 } from "../src/encoding.js";
import { decryptProtectedUserPrivateKeyBytes } from "../src/user-identity.js";

const userId = "00000000-0000-4000-8000-000000000002";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const originalPassword = "original account password";
const restoredPassword = "current account password";
const recoveryPassphrase = "correct horse battery staple recovery";
const identityCreatedAt = "2026-08-21T10:00:00.000Z";
let identity: LocalUserCryptoIdentity;
let recoveryKit: EncryptedUserRecoveryKit;

beforeAll(async () => {
  identity = await createUserCryptoIdentity(originalPassword, { userId });
  recoveryKit = await exportUserRecoveryKit(
    identity,
    originalPassword,
    recoveryPassphrase,
    {
      createdAt: "2026-08-24T10:00:00.000Z",
      identityCreatedAt,
      userId
    }
  );
}, 30_000);

describe("encrypted user recovery kits", () => {
  it("exports only encrypted private identity material and public metadata", async () => {
    const serialized = JSON.stringify(recoveryKit);
    const privateBytes = await decryptProtectedUserPrivateKeyBytes(identity, originalPassword, {
      userId
    });
    try {
      expect(recoveryKit).toMatchObject({
        created_at: "2026-08-24T10:00:00.000Z",
        encrypted_private_key: {
          algorithm: "AES-GCM",
          format: "PKCS8",
          iterations: 600000,
          kdf: "PBKDF2",
          kdf_hash: "SHA-256"
        },
        identity: {
          algorithm: "RSA-OAEP-3072-SHA256",
          created_at: identityCreatedAt,
          key_version: 1,
          public_key: identity.publicKey
        },
        recovery_kit_version: 1,
        user_id: userId
      });
      expect(serialized).not.toContain(encodeBase64(privateBytes));
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("workspaceKey");
      expect(serialized).not.toContain("note plaintext sentinel");
      expect(serialized).not.toContain("comment plaintext sentinel");
      expect(serialized).not.toContain("authToken");
      expect(serialized).not.toContain("password");
    } finally {
      privateBytes.fill(0);
    }
  });

  it("restores an identity protected by the current device account password", async () => {
    const restored = await importUserRecoveryKit(
      recoveryKit,
      recoveryPassphrase,
      restoredPassword,
      { userId }
    );

    expect(restored.identityCreatedAt).toBe(identityCreatedAt);
    expect(restored.identity.publicKey).toBe(identity.publicKey);
    await expect(
      unlockUserCryptoIdentity(restored.identity, restoredPassword, { userId })
    ).resolves.toMatchObject({ type: "private" });
    await expect(
      unlockUserCryptoIdentity(restored.identity, originalPassword, { userId })
    ).rejects.toMatchObject({ code: "identity_key_unlock_failed" });
  });

  it("lets the restored identity decrypt an existing workspace key share", async () => {
    const workspaceKey = await generateWorkspaceKey();
    const note = await encryptNoteContent("existing shared note", workspaceKey);
    const share = await wrapWorkspaceKeyForRecipient(workspaceKey, identity, {
      recipientKeyVersion: identity.keyVersion,
      recipientUserId: userId,
      workspaceId
    });
    const restored = await importUserRecoveryKit(
      recoveryKit,
      recoveryPassphrase,
      restoredPassword,
      { userId }
    );
    const privateKey = await unlockUserCryptoIdentity(restored.identity, restoredPassword, {
      userId
    });
    const restoredWorkspaceKey = await unwrapWorkspaceKeyShare(share, privateKey, {
      recipientKeyVersion: share.recipientKeyVersion,
      recipientUserId: userId,
      workspaceId
    });

    await expect(decryptNoteContent(note, restoredWorkspaceKey)).resolves.toBe(
      "existing shared note"
    );
  });

  it("fails safely for a wrong recovery passphrase", async () => {
    await expect(
      importUserRecoveryKit(
        recoveryKit,
        "wrong recovery passphrase value",
        restoredPassword,
        { userId }
      )
    ).rejects.toMatchObject({ code: "recovery_kit_decryption_failed" });
  });

  it("rejects malformed recovery kits without returning key material", async () => {
    const malformedKits = [
      null,
      { recovery_kit_version: 1 },
      { ...recoveryKit, unexpected: true },
      { ...recoveryKit, created_at: "not-an-iso-timestamp" },
      {
        ...recoveryKit,
        encrypted_private_key: {
          ...recoveryKit.encrypted_private_key,
          ciphertext: "not base64"
        }
      }
    ];
    for (const malformed of malformedKits) {
      await expect(
        importUserRecoveryKit(malformed, recoveryPassphrase, restoredPassword, { userId })
      ).rejects.toMatchObject({ code: "invalid_recovery_kit" });
    }
  });
});
