import { beforeAll, describe, expect, it } from "vitest";

import {
  createUserCryptoIdentity,
  createSignedWorkspaceKeyShare,
  decryptNoteContent,
  encryptNoteContent,
  exportUserRecoveryKit,
  generateWorkspaceKey,
  importUserRecoveryKit,
  unlockUserCryptoIdentity,
  unlockUserSigningIdentity,
  unwrapVerifiedWorkspaceKeyShare,
  verifyOwnIdentityBundle,
  type EncryptedUserRecoveryKit,
  type LocalUserCryptoIdentity
} from "../src/index.js";

const sharedNoteContext = {
  localRevision: 1,
  noteId: "30000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001"
};
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
    if (recoveryKit.recovery_kit_version !== 2) throw new Error("Expected recovery kit v2");
    const serialized = JSON.stringify(recoveryKit);
    const privateBytes = await decryptProtectedUserPrivateKeyBytes(identity, originalPassword, {
      userId
    });
    try {
      expect(recoveryKit).toMatchObject({
        created_at: "2026-08-24T10:00:00.000Z",
        encrypted_private_keys: {
          algorithm: "AES-GCM",
          format: "CIPHERSPACE-IDENTITY-KEYS-V2",
          iterations: 600000,
          kdf: "PBKDF2",
          kdf_hash: "SHA-256"
        },
        identity_bundle: identity.identityBundle,
        recovery_kit_version: 2,
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

    expect(restored.identityCreatedAt).toBe(identity.identityBundle!.createdAt);
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
    const note = await encryptNoteContent("existing shared note", workspaceKey, sharedNoteContext);
    const recipient = await verifyOwnIdentityBundle(identity.identityBundle!, {
      encryptionPublicKey: identity.publicKey,
      signingPublicKey: identity.signingIdentity!.publicKey,
      userId
    });
    const share = await createSignedWorkspaceKeyShare({
      recipient,
      role: "owner",
      senderBundle: identity.identityBundle!,
      senderSigningPrivateKey: await unlockUserSigningIdentity(identity.signingIdentity!, originalPassword, { userId }),
      workspaceId,
      workspaceKey
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
    const restoredWorkspaceKey = await unwrapVerifiedWorkspaceKeyShare({
      recipientBundle: restored.identity.identityBundle!,
      recipientPrivateKey: privateKey,
      senderSigningIdentity: restored.identity.identityBundle!.signingKey,
      share,
      workspaceId
    });

    await expect(decryptNoteContent(note, restoredWorkspaceKey, sharedNoteContext)).resolves.toBe(
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
    if (recoveryKit.recovery_kit_version !== 2) throw new Error("Expected recovery kit v2");
    const malformedKits = [
      null,
      { recovery_kit_version: 1 },
      { ...recoveryKit, unexpected: true },
      { ...recoveryKit, created_at: "not-an-iso-timestamp" },
      {
        ...recoveryKit,
        encrypted_private_keys: {
          ...recoveryKit.encrypted_private_keys,
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
