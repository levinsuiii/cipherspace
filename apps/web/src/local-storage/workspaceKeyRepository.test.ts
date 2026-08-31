import {
  decryptNoteContent,
  encryptNoteContent,
  generateWorkspaceKey,
  protectWorkspaceKey,
  unlockWorkspaceKey
} from "@cipherspace/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CipherSpaceLocalDatabase } from "./database";
import { LocalWorkspaceKeyRepository } from "./workspaceKeyRepository";

const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const passphrase = "a local unlock password for tests";
const noteContext = {
  localRevision: 1,
  noteId: "30000000-0000-4000-8000-000000000001",
  workspaceId
};

describe("LocalWorkspaceKeyRepository", () => {
  let database: CipherSpaceLocalDatabase;
  let databaseName: string;
  let repository: LocalWorkspaceKeyRepository;

  beforeEach(() => {
    databaseName = `cipherspace-key-test-${crypto.randomUUID()}`;
    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalWorkspaceKeyRepository(database, userId, {
      now: () => "2026-08-20T14:00:00.000Z"
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  it("persists only a protected workspace key and unlocks it after database reopen", async () => {
    const workspaceKey = await generateWorkspaceKey();
    const note = await encryptNoteContent("decryptable after reload", workspaceKey, noteContext);
    const protectedKey = await protectWorkspaceKey(workspaceKey, passphrase, {
      userId,
      workspaceId
    });
    await repository.add(workspaceId, protectedKey);

    const storedBeforeReload = await repository.get(workspaceId);
    expect(storedBeforeReload).toMatchObject({
      protected_key: { ciphertext: expect.any(String), kdf: "PBKDF2", version: 1 },
      user_id: userId,
      workspace_id: workspaceId
    });
    expect(storedBeforeReload).not.toHaveProperty("workspace_key");
    expect(JSON.stringify(storedBeforeReload)).not.toContain(passphrase);

    database.close();
    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalWorkspaceKeyRepository(database, userId);
    const storedAfterReload = await repository.get(workspaceId);
    const unlocked = await unlockWorkspaceKey(storedAfterReload?.protected_key, passphrase, {
      userId,
      workspaceId
    });

    await expect(decryptNoteContent(note, unlocked, noteContext)).resolves.toBe("decryptable after reload");
  });

  it("does not silently replace an existing protected workspace key", async () => {
    const first = await protectWorkspaceKey(await generateWorkspaceKey(), passphrase, {
      userId,
      workspaceId
    });
    const second = await protectWorkspaceKey(await generateWorkspaceKey(), passphrase, {
      userId,
      workspaceId
    });
    await repository.add(workspaceId, first);

    await expect(repository.add(workspaceId, second)).rejects.toThrow();
    await expect(repository.get(workspaceId)).resolves.toMatchObject({ protected_key: first });
  });
});
