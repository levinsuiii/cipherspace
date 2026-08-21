import { createPublicKey } from "node:crypto";

import {
  userIdentityAlgorithm,
  type IdentityRepository,
  type StoredUserCryptoIdentity
} from "./repository.js";

export interface UserCryptoIdentity {
  algorithm: typeof userIdentityAlgorithm;
  createdAt: string;
  keyVersion: number;
  publicKey: string;
  updatedAt: string;
  userId: string;
}

export class IdentityNotFoundError extends Error {}
export class InvalidIdentityPublicKeyError extends Error {}
export class IdentityVersionConflictError extends Error {}

function publicIdentity(identity: StoredUserCryptoIdentity): UserCryptoIdentity {
  return {
    algorithm: identity.algorithm,
    createdAt: identity.createdAt.toISOString(),
    keyVersion: identity.keyVersion,
    publicKey: identity.publicKey,
    updatedAt: identity.updatedAt.toISOString(),
    userId: identity.userId
  };
}

function validateRsaPublicKey(publicKey: string): void {
  try {
    const parsed = createPublicKey({ format: "der", key: Buffer.from(publicKey, "base64"), type: "spki" });
    const details = parsed.asymmetricKeyDetails;
    if (
      parsed.asymmetricKeyType !== "rsa" ||
      details?.modulusLength !== 3072 ||
      details.publicExponent !== 65_537n
    ) {
      throw new Error("Unsupported RSA key parameters");
    }
  } catch (error) {
    throw new InvalidIdentityPublicKeyError("Invalid RSA-OAEP public key", { cause: error });
  }
}

export class IdentityService {
  public constructor(private readonly repository: IdentityRepository) {}

  public async getCurrent(userId: string): Promise<UserCryptoIdentity> {
    const identity = await this.repository.findCurrent(userId);
    if (!identity) throw new IdentityNotFoundError();
    return publicIdentity(identity);
  }

  public async register(input: {
    algorithm: typeof userIdentityAlgorithm;
    keyVersion: number;
    publicKey: string;
    userId: string;
  }): Promise<{ created: boolean; identity: UserCryptoIdentity }> {
    validateRsaPublicKey(input.publicKey);
    const result = await this.repository.register(input);
    if (!("identity" in result)) {
      throw new IdentityVersionConflictError();
    }
    return { created: result.status === "created", identity: publicIdentity(result.identity) };
  }
}
