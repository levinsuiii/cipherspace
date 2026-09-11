import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUserCryptoIdentity } from "@cipherspace/crypto";

import { api, ApiError } from "../api/client";
import type { User } from "../api/types";
import { localDatabase } from "../local-storage/database";
import { LocalUserIdentityRepository } from "../local-storage/userIdentityRepository";
import { ensureLocalUserCryptoIdentity, inspectUserCryptoIdentity } from "./userIdentity";

const user: User = {
  createdAt: "2026-08-21T10:00:00.000Z",
  email: "recipient@example.com",
  id: "00000000-0000-4000-8000-000000000002"
};

beforeEach(async () => {
  await localDatabase.delete();
  await localDatabase.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await localDatabase.delete();
});

describe("local user encryption identity", () => {
  it("registers only the public key while retaining the protected private key locally", async () => {
    vi.spyOn(api.cryptoIdentity, "get").mockRejectedValue(
      new ApiError("No encryption identity is registered.", 404, "identity_not_found")
    );
    const register = vi.spyOn(api.cryptoIdentity, "register").mockImplementation(async (identity) => ({
      identity: {
        ...identity,
        createdAt: user.createdAt,
        updatedAt: user.createdAt,
        userId: user.id
      }
    }));

    await ensureLocalUserCryptoIdentity(user, "recipient account password");

    expect(register).toHaveBeenCalledOnce();
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      bundleVersion: 1,
      encryptionKey: { algorithm: "RSA-OAEP-3072-SHA256", keyVersion: 1, publicKey: expect.any(String) },
      signingKey: { algorithm: "ECDSA-P256-SHA256", keyVersion: 1, publicKey: expect.any(String) },
      userId: user.id
    });
    expect(register.mock.calls[0]?.[0]).not.toHaveProperty("protectedPrivateKey");
    const stored = await new LocalUserIdentityRepository(localDatabase, user.id).get();
    expect(stored?.protectedPrivateKey.ciphertext).toEqual(expect.any(String));
    expect(stored).not.toHaveProperty("privateKey");
    vi.mocked(api.cryptoIdentity.get).mockResolvedValue({
      identity: stored!.identityBundle!
    });
    await expect(inspectUserCryptoIdentity(user.id)).resolves.toBe("ready");
  }, 30_000);

  it("distinguishes first-device setup from recovery on a device without a local identity", async () => {
    vi.spyOn(api.cryptoIdentity, "get").mockRejectedValueOnce(
      new ApiError("No encryption identity is registered.", 404, "identity_not_found")
    );
    await expect(inspectUserCryptoIdentity(user.id)).resolves.toBe("missing-unregistered");

    const registered = await createUserCryptoIdentity("registered account password", { userId: user.id });
    vi.mocked(api.cryptoIdentity.get).mockResolvedValueOnce({ identity: registered.identityBundle! });
    await expect(inspectUserCryptoIdentity(user.id)).resolves.toBe("missing-registered");
  }, 30_000);

  it("does not replace a registered identity when its private key is missing locally", async () => {
    const registered = await createUserCryptoIdentity("registered account password", { userId: user.id });
    vi.spyOn(api.cryptoIdentity, "get").mockResolvedValue({ identity: registered.identityBundle! });
    const register = vi.spyOn(api.cryptoIdentity, "register");

    await expect(
      ensureLocalUserCryptoIdentity(user, "recipient account password")
    ).rejects.toThrow("private key is not available");
    expect(register).not.toHaveBeenCalled();
    await expect(new LocalUserIdentityRepository(localDatabase, user.id).get()).resolves.toBeUndefined();
  }, 30_000);
});
