import { describe, expect, it } from "vitest";

import {
  CipherSpaceCryptoError,
  decryptNoteContent,
  encryptNoteContent,
  generateWorkspaceKey,
  protectWorkspaceKey,
  unlockWorkspaceKey
} from "../src/index.js";

const context = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001"
};
const passphrase = "a durable local unlock password";

describe("workspace key protection", () => {
  it("protects and unlocks the same workspace key", async () => {
    const workspaceKey = await generateWorkspaceKey();
    const encryptedNote = await encryptNoteContent("survives reload", workspaceKey);
    const protectedKey = await protectWorkspaceKey(workspaceKey, passphrase, context);

    expect(protectedKey).toMatchObject({
      algorithm: "AES-GCM",
      iterations: 600000,
      kdf: "PBKDF2",
      kdfHash: "SHA-256",
      version: 1,
      workspaceKeyLength: 256
    });
    const unlocked = await unlockWorkspaceKey(protectedKey, passphrase, context);
    await expect(decryptNoteContent(encryptedNote, unlocked)).resolves.toBe("survives reload");
  });

  it("uses fresh salt and nonce when protecting the same key", async () => {
    const workspaceKey = await generateWorkspaceKey();
    const first = await protectWorkspaceKey(workspaceKey, passphrase, context);
    const second = await protectWorkspaceKey(workspaceKey, passphrase, context);

    expect(first.salt).not.toBe(second.salt);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails safely for a wrong password or another workspace context", async () => {
    const protectedKey = await protectWorkspaceKey(
      await generateWorkspaceKey(),
      passphrase,
      context
    );

    await expect(
      unlockWorkspaceKey(protectedKey, "another durable unlock password", context)
    ).rejects.toMatchObject({ code: "workspace_key_unlock_failed" });
    await expect(
      unlockWorkspaceKey(protectedKey, passphrase, {
        ...context,
        workspaceId: "10000000-0000-4000-8000-000000000002"
      })
    ).rejects.toMatchObject({ code: "workspace_key_unlock_failed" });
  });

  it("rejects short passwords and malformed protected keys", async () => {
    const workspaceKey = await generateWorkspaceKey();
    await expect(protectWorkspaceKey(workspaceKey, "too short", context)).rejects.toMatchObject({
      code: "invalid_unlock_passphrase"
    });
    await expect(unlockWorkspaceKey({ version: 1 }, passphrase, context)).rejects.toBeInstanceOf(
      CipherSpaceCryptoError
    );
    await expect(unlockWorkspaceKey({ version: 1 }, passphrase, context)).rejects.toMatchObject({
      code: "invalid_protected_workspace_key"
    });
  });
});
