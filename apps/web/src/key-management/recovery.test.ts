import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUserCryptoIdentity, unlockUserCryptoIdentity } from "@cipherspace/crypto";

import { api } from "../api/client";
import type { User } from "../api/types";
import { localDatabase } from "../local-storage/database";
import { LocalUserIdentityRepository } from "../local-storage/userIdentityRepository";
import {
  exportLocalUserRecoveryKit,
  importLocalUserRecoveryKit,
  parseRecoveryKitText
} from "./recovery";

const user: User = {
  createdAt: "2026-08-21T10:00:00.000Z",
  email: "recipient@example.com",
  id: "00000000-0000-4000-8000-000000000002"
};
const originalPassword = "original account password";
const currentPassword = "current account password";
const recoveryPassphrase = "correct horse battery staple recovery";

beforeEach(async () => {
  await localDatabase.delete();
  await localDatabase.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await localDatabase.delete();
});

describe("browser identity recovery", () => {
  it("restores a usable local identity after browser storage loss", async () => {
    const repository = new LocalUserIdentityRepository(localDatabase, user.id);
    const original = await createUserCryptoIdentity(originalPassword, { userId: user.id });
    await repository.add(original);
    const kit = await exportLocalUserRecoveryKit(
      user.id,
      originalPassword,
      recoveryPassphrase
    );
    await localDatabase.user_crypto_identities.clear();
    vi.spyOn(api.cryptoIdentity, "get").mockResolvedValue({
      identity: {
        algorithm: original.algorithm,
        createdAt: user.createdAt,
        keyVersion: original.keyVersion,
        publicKey: original.publicKey,
        updatedAt: user.createdAt,
        userId: user.id
      }
    });

    await importLocalUserRecoveryKit({
      accountPassword: currentPassword,
      kit,
      overwriteExisting: false,
      recoveryPassphrase,
      user
    });

    const restored = await repository.get();
    expect(restored?.publicKey).toBe(original.publicKey);
    await expect(
      unlockUserCryptoIdentity(restored!, currentPassword, { userId: user.id })
    ).resolves.toMatchObject({ type: "private" });
  }, 30_000);

  it("does not persist a kit that conflicts with the registered public identity", async () => {
    const repository = new LocalUserIdentityRepository(localDatabase, user.id);
    const original = await createUserCryptoIdentity(originalPassword, { userId: user.id });
    await repository.add(original);
    const kit = await exportLocalUserRecoveryKit(
      user.id,
      originalPassword,
      recoveryPassphrase
    );
    await localDatabase.user_crypto_identities.clear();
    vi.spyOn(api.cryptoIdentity, "get").mockResolvedValue({
      identity: {
        algorithm: original.algorithm,
        createdAt: user.createdAt,
        keyVersion: original.keyVersion,
        publicKey: "different-public-key",
        updatedAt: user.createdAt,
        userId: user.id
      }
    });

    await expect(
      importLocalUserRecoveryKit({
        accountPassword: currentPassword,
        kit,
        overwriteExisting: false,
        recoveryPassphrase,
        user
      })
    ).rejects.toThrow("does not match");
    await expect(repository.get()).resolves.toBeUndefined();
  }, 30_000);

  it("rejects malformed JSON text safely", () => {
    expect(() => parseRecoveryKitText("not-json")).toThrow("not valid JSON");
    expect(() => parseRecoveryKitText("")).toThrow("empty or too large");
  });
});
