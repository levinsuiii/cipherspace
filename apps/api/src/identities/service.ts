import { createHash, createPublicKey, webcrypto } from "node:crypto";

import {
  userIdentityAlgorithm,
  userSigningAlgorithm,
  type IdentityRepository,
  type StoredIdentityBundle
} from "./repository.js";

export type UserCryptoIdentity = StoredIdentityBundle;

export class IdentityNotFoundError extends Error {}
export class InvalidIdentityPublicKeyError extends Error {}
export class IdentityVersionConflictError extends Error {}

function canonicalBody(bundle: StoredIdentityBundle): Buffer {
  return Buffer.from(JSON.stringify([
    "cipherspace.identity-bundle", bundle.bundleVersion, bundle.userId, bundle.bundleSequence,
    bundle.previousBundleHash, bundle.createdAt, bundle.signingKey.algorithm,
    bundle.signingKey.keyVersion, bundle.signingKey.publicKey, bundle.signingKey.fingerprint,
    bundle.encryptionKey.algorithm, bundle.encryptionKey.keyVersion,
    bundle.encryptionKey.publicKey, bundle.encryptionKey.fingerprint
  ]), "utf8");
}

function fingerprint(algorithm: string, publicKey: string): string {
  return createHash("sha256").update(JSON.stringify([
    "cipherspace.public-key-fingerprint", 1, algorithm, publicKey
  ])).digest("hex");
}

async function validateBundle(bundle: StoredIdentityBundle): Promise<void> {
  try {
    const rsa = createPublicKey({ format: "der", key: Buffer.from(bundle.encryptionKey.publicKey, "base64"), type: "spki" });
    const rsaDetails = rsa.asymmetricKeyDetails;
    if (rsa.asymmetricKeyType !== "rsa" || rsaDetails?.modulusLength !== 3072 || rsaDetails.publicExponent !== 65_537n) {
      throw new Error("Unsupported RSA parameters");
    }
    const ec = createPublicKey({ format: "der", key: Buffer.from(bundle.signingKey.publicKey, "base64"), type: "spki" });
    if (ec.asymmetricKeyType !== "ec" || ec.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("Unsupported signing parameters");
    }
    if (
      rsa.export({ format: "der", type: "spki" }).toString("base64") !== bundle.encryptionKey.publicKey ||
      ec.export({ format: "der", type: "spki" }).toString("base64") !== bundle.signingKey.publicKey
    ) {
      throw new Error("Non-canonical public key encoding");
    }
    const body = canonicalBody(bundle);
    if (
      fingerprint(bundle.signingKey.algorithm, bundle.signingKey.publicKey) !== bundle.signingKey.fingerprint ||
      fingerprint(bundle.encryptionKey.algorithm, bundle.encryptionKey.publicKey) !== bundle.encryptionKey.fingerprint ||
      createHash("sha256").update(body).digest("hex") !== bundle.bundleHash
    ) {
      throw new Error("Bundle fingerprint mismatch");
    }
    const imported = await webcrypto.subtle.importKey(
      "spki", Buffer.from(bundle.signingKey.publicKey, "base64"),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
    );
    const valid = await webcrypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" }, imported,
      Buffer.from(bundle.signature.value, "base64"), body
    );
    if (!valid) throw new Error("Invalid bundle signature");
  } catch (error) {
    throw new InvalidIdentityPublicKeyError("Invalid signed identity bundle", { cause: error });
  }
}

export class IdentityService {
  public constructor(private readonly repository: IdentityRepository) {}

  public async getCurrent(userId: string): Promise<UserCryptoIdentity> {
    const identity = await this.repository.findCurrent(userId);
    if (!identity) throw new IdentityNotFoundError();
    return identity;
  }

  public async register(bundle: StoredIdentityBundle): Promise<{ created: boolean; identity: UserCryptoIdentity }> {
    await validateBundle(bundle);
    const result = await this.repository.register(bundle);
    if (!("identity" in result)) throw new IdentityVersionConflictError();
    return { created: result.status === "created", identity: result.identity };
  }
}
