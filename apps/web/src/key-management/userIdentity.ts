import {
  createUserCryptoIdentity,
  unlockUserCryptoIdentity,
  type LocalUserCryptoIdentity
} from "@cipherspace/crypto";

import { api, ApiError } from "../api/client";
import type { User } from "../api/types";
import { localDatabase } from "../local-storage/database";
import { LocalUserIdentityRepository } from "../local-storage/userIdentityRepository";

export async function ensureLocalUserCryptoIdentity(
  user: User,
  accountPassword: string
): Promise<LocalUserCryptoIdentity> {
  const repository = new LocalUserIdentityRepository(localDatabase, user.id);
  let identity = await repository.get();
  if (identity) {
    await unlockUserCryptoIdentity(identity, accountPassword, { userId: user.id });
  } else {
    try {
      await api.cryptoIdentity.get();
      throw new Error(
        "This account already has an encryption identity, but its private key is not available in this browser profile. Identity recovery and device transfer are not implemented."
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    const created = await createUserCryptoIdentity(accountPassword, { userId: user.id });
    identity = await repository.add(created);
  }
  await api.cryptoIdentity.register({
    algorithm: identity.algorithm,
    keyVersion: identity.keyVersion,
    publicKey: identity.publicKey
  });
  return identity;
}

export async function readLocalUserCryptoIdentity(userId: string) {
  return new LocalUserIdentityRepository(localDatabase, userId).get();
}
