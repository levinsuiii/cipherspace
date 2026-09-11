import {
  exportUserRecoveryKit,
  importUserRecoveryKit,
  upgradeUserCryptoIdentity,
  verifyIdentityBundle,
  type EncryptedUserRecoveryKit
} from "@cipherspace/crypto";

import { api, ApiError } from "../api/client";
import type { User, UserCryptoIdentity } from "../api/types";
import { localDatabase } from "../local-storage/database";
import {
  LocalIdentityAlreadyExistsError,
  LocalUserIdentityRepository
} from "../local-storage/userIdentityRepository";

const MAX_RECOVERY_KIT_TEXT_LENGTH = 64 * 1024;

function publicIdentityMatches(
  local: UserCryptoIdentity,
  remote: UserCryptoIdentity
): boolean {
  return local.bundleHash === remote.bundleHash &&
    local.signingKey.fingerprint === remote.signingKey.fingerprint;
}

async function verifyOrRegisterPublicIdentity(
  identity: UserCryptoIdentity
): Promise<void> {
  try {
    const remote = (await api.cryptoIdentity.get()).identity;
    if (!publicIdentityMatches(identity, remote)) {
      throw new Error(
        "This recovery kit does not match the encryption identity registered for this account."
      );
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
    await api.cryptoIdentity.register(identity);
  }
}

export async function exportLocalUserRecoveryKit(
  userId: string,
  accountPassword: string,
  recoveryPassphrase: string
): Promise<EncryptedUserRecoveryKit> {
  const identity = await new LocalUserIdentityRepository(localDatabase, userId).get();
  if (!identity) throw new Error("No local encryption identity is available to export.");
  return exportUserRecoveryKit(identity, accountPassword, recoveryPassphrase, {
    identityCreatedAt: identity.created_at,
    userId
  });
}

export function parseRecoveryKitText(text: string): unknown {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_RECOVERY_KIT_TEXT_LENGTH) {
    throw new Error("The recovery kit text is empty or too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The recovery kit is not valid JSON.");
  }
}

export async function importLocalUserRecoveryKit(input: {
  accountPassword: string;
  kit: unknown;
  overwriteExisting: boolean;
  recoveryPassphrase: string;
  user: User;
}): Promise<void> {
  const repository = new LocalUserIdentityRepository(localDatabase, input.user.id);
  if ((await repository.get()) && !input.overwriteExisting) {
    throw new LocalIdentityAlreadyExistsError();
  }
  const restored = await importUserRecoveryKit(
    input.kit,
    input.recoveryPassphrase,
    input.accountPassword,
    { userId: input.user.id }
  );
  let previousBundle: UserCryptoIdentity | undefined;
  if (!restored.identity.identityBundle || !restored.identity.signingIdentity) {
    try {
      previousBundle = (await api.cryptoIdentity.get()).identity;
      await verifyIdentityBundle(previousBundle);
      if (previousBundle.encryptionKey.publicKey !== restored.identity.publicKey) {
        throw new Error("This recovery kit does not match the encryption identity registered for this account.");
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  const upgradedIdentity = await upgradeUserCryptoIdentity(
    restored.identity,
    input.accountPassword,
    { userId: input.user.id },
    previousBundle
  );
  if (!upgradedIdentity.identityBundle) throw new Error("Die wiederhergestellte Identität konnte nicht signiert werden.");
  await verifyOrRegisterPublicIdentity(upgradedIdentity.identityBundle);
  await repository.restore(
    upgradedIdentity,
    restored.identityCreatedAt,
    input.overwriteExisting
  );
}
