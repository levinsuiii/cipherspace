import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createUserCryptoIdentity } from "@cipherspace/crypto";

import { CipherSpaceLocalDatabase } from "./database";
import {
  LocalIdentityAlreadyExistsError,
  LocalUserIdentityRepository
} from "./userIdentityRepository";

const userId = "00000000-0000-4000-8000-000000000002";
let database: CipherSpaceLocalDatabase;
let repository: LocalUserIdentityRepository;

beforeEach(() => {
  database = new CipherSpaceLocalDatabase(`identity-recovery-${crypto.randomUUID()}`);
  repository = new LocalUserIdentityRepository(
    database,
    userId,
    () => "2026-08-24T12:00:00.000Z"
  );
});

afterEach(async () => {
  await database.delete();
});

describe("local identity restore", () => {
  it("does not overwrite an existing identity without explicit confirmation", async () => {
    const existing = await createUserCryptoIdentity("existing account password", { userId });
    const imported = await createUserCryptoIdentity("imported account password", { userId });
    await repository.add(existing);

    await expect(
      repository.restore(imported, "2026-08-21T10:00:00.000Z")
    ).rejects.toBeInstanceOf(LocalIdentityAlreadyExistsError);
    await expect(repository.get()).resolves.toMatchObject({ publicKey: existing.publicKey });
  }, 30_000);

  it("replaces an identity only after confirmation", async () => {
    const existing = await createUserCryptoIdentity("existing account password", { userId });
    const imported = await createUserCryptoIdentity("imported account password", { userId });
    await repository.add(existing);

    await repository.restore(imported, "2026-08-21T10:00:00.000Z", true);

    await expect(repository.get()).resolves.toMatchObject({
      created_at: "2026-08-21T10:00:00.000Z",
      publicKey: imported.publicKey,
      updated_at: "2026-08-24T12:00:00.000Z"
    });
  }, 30_000);
});
