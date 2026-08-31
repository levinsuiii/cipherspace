import { describe, expect, it } from "vitest";

import {
  CipherSpaceCryptoError,
  decryptNoteContent,
  encryptNoteContent,
  exportWorkspaceKey,
  generateNonce,
  generateWorkspaceKey,
  importWorkspaceKey
} from "../src/index.js";

const noteContext = {
  localRevision: 1,
  noteId: "30000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001"
};

describe("workspace keys", () => {
  it("generates an extractable AES-256-GCM workspace key", async () => {
    const key = await generateWorkspaceKey();
    const anotherKey = await generateWorkspaceKey();

    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.extractable).toBe(true);
    expect(key.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
    expect(await exportWorkspaceKey(key)).not.toBe(await exportWorkspaceKey(anotherKey));
  });

  it("exports and imports a workspace key without changing its key material", async () => {
    const originalKey = await generateWorkspaceKey();
    const exportedKey = await exportWorkspaceKey(originalKey);
    const importedKey = await importWorkspaceKey(exportedKey);
    const payload = await encryptNoteContent("portable key material", originalKey, noteContext);

    expect(atob(exportedKey)).toHaveLength(32);
    await expect(decryptNoteContent(payload, importedKey, noteContext)).resolves.toBe("portable key material");
  });

  it.each(["not base64", "AQIDBA==", ""])("rejects malformed exported key material", async (value) => {
    await expect(importWorkspaceKey(value)).rejects.toBeInstanceOf(CipherSpaceCryptoError);
    await expect(importWorkspaceKey(value)).rejects.toMatchObject({ code: "invalid_exported_key" });
  });

  it("generates 96-bit nonces with platform secure randomness", () => {
    const first = generateNonce();
    const second = generateNonce();

    expect(first).toHaveLength(12);
    expect(second).toHaveLength(12);
    expect(first).not.toEqual(second);
  });
});
