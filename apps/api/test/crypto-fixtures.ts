import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject
} from "node:crypto";

import {
  userIdentityAlgorithm,
  userSigningAlgorithm,
  type StoredIdentityBundle
} from "../src/identities/repository.js";
import type { SignedWorkspaceKeyShare, WorkspaceRole } from "../src/workspaces/repository.js";

const sharedEncryptionPair = generateKeyPairSync("rsa", { modulusLength: 3072 });

function fingerprint(algorithm: string, publicKey: string): string {
  return createHash("sha256").update(JSON.stringify([
    "cipherspace.public-key-fingerprint", 1, algorithm, publicKey
  ])).digest("hex");
}

export function createIdentityFixture(userId: string, previous?: StoredIdentityBundle): {
  bundle: StoredIdentityBundle;
  signingPrivateKey: KeyObject;
} {
  const signingPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const encryptionPublicKey = sharedEncryptionPair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const signingPublicKey = signingPair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const unsigned = {
    bundleSequence: (previous?.bundleSequence ?? 0) + 1,
    bundleVersion: 1 as const,
    createdAt: "2026-08-19T12:00:00.000Z",
    encryptionKey: {
      algorithm: userIdentityAlgorithm,
      fingerprint: fingerprint(userIdentityAlgorithm, encryptionPublicKey),
      keyVersion: 1,
      publicKey: encryptionPublicKey
    },
    previousBundleHash: previous?.bundleHash ?? null,
    signingKey: {
      algorithm: userSigningAlgorithm,
      fingerprint: fingerprint(userSigningAlgorithm, signingPublicKey),
      keyVersion: 1,
      publicKey: signingPublicKey
    },
    userId
  };
  const body = Buffer.from(JSON.stringify([
    "cipherspace.identity-bundle", unsigned.bundleVersion, unsigned.userId,
    unsigned.bundleSequence, unsigned.previousBundleHash, unsigned.createdAt,
    unsigned.signingKey.algorithm, unsigned.signingKey.keyVersion,
    unsigned.signingKey.publicKey, unsigned.signingKey.fingerprint,
    unsigned.encryptionKey.algorithm, unsigned.encryptionKey.keyVersion,
    unsigned.encryptionKey.publicKey, unsigned.encryptionKey.fingerprint
  ]), "utf8");
  return {
    bundle: {
      ...unsigned,
      bundleHash: createHash("sha256").update(body).digest("hex"),
      signature: {
        algorithm: userSigningAlgorithm,
        value: sign("sha256", body, { dsaEncoding: "ieee-p1363", key: signingPair.privateKey }).toString("base64")
      }
    },
    signingPrivateKey: signingPair.privateKey
  };
}

export function createShareFixture(input: {
  recipient: StoredIdentityBundle;
  role: WorkspaceRole;
  sender: StoredIdentityBundle;
  senderSigningPrivateKey: KeyObject;
  workspaceId: string;
}): SignedWorkspaceKeyShare {
  const unsigned = {
    operationId: randomUUID(),
    protocolVersion: 2 as const,
    recipient: {
      bundleSequence: input.recipient.bundleSequence,
      encryptionKeyFingerprint: input.recipient.encryptionKey.fingerprint,
      encryptionKeyVersion: input.recipient.encryptionKey.keyVersion,
      signingKeyFingerprint: input.recipient.signingKey.fingerprint,
      userId: input.recipient.userId
    },
    role: input.role,
    sender: {
      bundleSequence: input.sender.bundleSequence,
      signingKeyFingerprint: input.sender.signingKey.fingerprint,
      signingKeyVersion: input.sender.signingKey.keyVersion,
      userId: input.sender.userId
    },
    workspaceId: input.workspaceId,
    workspaceKey: { commitment: "ab".repeat(32), version: 1 },
    wrapping: {
      algorithm: userIdentityAlgorithm,
      ciphertext: Buffer.alloc(384, 7).toString("base64"),
      labelVersion: 2 as const
    }
  };
  const body = Buffer.from(JSON.stringify([
    "cipherspace.workspace-key-share", unsigned.protocolVersion, unsigned.operationId,
    unsigned.workspaceId, unsigned.sender.userId, unsigned.sender.signingKeyFingerprint,
    unsigned.sender.signingKeyVersion, unsigned.sender.bundleSequence,
    unsigned.recipient.userId, unsigned.recipient.signingKeyFingerprint,
    unsigned.recipient.bundleSequence, unsigned.recipient.encryptionKeyFingerprint,
    unsigned.recipient.encryptionKeyVersion, unsigned.role, unsigned.workspaceKey.version,
    unsigned.workspaceKey.commitment, unsigned.wrapping.algorithm,
    unsigned.wrapping.labelVersion, unsigned.wrapping.ciphertext
  ]), "utf8");
  return {
    ...unsigned,
    signature: {
      algorithm: userSigningAlgorithm,
      value: sign("sha256", body, { dsaEncoding: "ieee-p1363", key: input.senderSigningPrivateKey }).toString("base64")
    }
  };
}
