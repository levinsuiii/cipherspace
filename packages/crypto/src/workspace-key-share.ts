import {
  AES_KEY_LENGTH_BITS,
  NOTE_ENCRYPTION_ALGORITHM,
  USER_IDENTITY_ALGORITHM,
  USER_SIGNING_ALGORITHM,
  WORKSPACE_KEY_SHARE_PROTOCOL_VERSION,
  WORKSPACE_KEY_VERSION
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import { assertVerifiedIdentityBundle } from "./identity-bundle.js";
import { signIdentityBytes, verifyIdentitySignature } from "./signing-identity.js";
import type {
  PublicIdentityBundle,
  PublicUserSigningIdentity,
  SignedWorkspaceKeyShare,
  VerifiedIdentityBundle
} from "./types.js";
import { importUserEncryptionPublicKey } from "./user-identity.js";
import { assertWorkspaceKey, exportWorkspaceKey } from "./workspace-key.js";

const RSA_CIPHERTEXT_LENGTH_BYTES = 384;
const HEX_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const textEncoder = new TextEncoder();

export function workspaceKeyShareCanonicalBytes(
  share: Omit<SignedWorkspaceKeyShare, "signature"> | SignedWorkspaceKeyShare
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    "cipherspace.workspace-key-share", share.protocolVersion, share.operationId, share.workspaceId,
    share.sender.userId, share.sender.signingKeyFingerprint, share.sender.signingKeyVersion,
    share.sender.bundleSequence, share.recipient.userId, share.recipient.signingKeyFingerprint,
    share.recipient.bundleSequence, share.recipient.encryptionKeyFingerprint,
    share.recipient.encryptionKeyVersion, share.role, share.workspaceKey.version,
    share.workspaceKey.commitment, share.wrapping.algorithm, share.wrapping.labelVersion,
    share.wrapping.ciphertext
  ]));
}

function wrapLabel(share: Omit<SignedWorkspaceKeyShare, "signature">): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    "cipherspace.workspace-key-wrap", share.protocolVersion, share.operationId, share.workspaceId,
    share.sender.userId, share.sender.signingKeyFingerprint, share.recipient.userId,
    share.recipient.signingKeyFingerprint, share.recipient.encryptionKeyFingerprint,
    share.recipient.encryptionKeyVersion, share.role, share.workspaceKey.version,
    share.workspaceKey.commitment
  ]));
}

async function workspaceKeyCommitment(workspaceKey: CryptoKey): Promise<string> {
  const raw = decodeBase64(await exportWorkspaceKey(workspaceKey), "workspace key");
  const prefix = textEncoder.encode("cipherspace.workspace-key-commitment|1\u0000");
  const input = new Uint8Array(prefix.length + raw.length);
  input.set(prefix);
  input.set(raw, prefix.length);
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    raw.fill(0);
    input.fill(0);
  }
}

function unsignedShare(share: SignedWorkspaceKeyShare): Omit<SignedWorkspaceKeyShare, "signature"> {
  const { signature: _signature, ...unsigned } = share;
  return unsigned;
}

function assertShareShape(share: SignedWorkspaceKeyShare): void {
  const roles = ["owner", "editor", "viewer"];
  if (
    !share || share.protocolVersion !== WORKSPACE_KEY_SHARE_PROTOCOL_VERSION ||
    !UUID_PATTERN.test(share.operationId) || !UUID_PATTERN.test(share.workspaceId) ||
    !UUID_PATTERN.test(share.sender.userId) || !HEX_PATTERN.test(share.sender.signingKeyFingerprint) ||
    !Number.isSafeInteger(share.sender.signingKeyVersion) || share.sender.signingKeyVersion < 1 ||
    !Number.isSafeInteger(share.sender.bundleSequence) || share.sender.bundleSequence < 1 ||
    !UUID_PATTERN.test(share.recipient.userId) || !HEX_PATTERN.test(share.recipient.signingKeyFingerprint) ||
    !Number.isSafeInteger(share.recipient.bundleSequence) || share.recipient.bundleSequence < 1 ||
    !HEX_PATTERN.test(share.recipient.encryptionKeyFingerprint) ||
    !Number.isSafeInteger(share.recipient.encryptionKeyVersion) || share.recipient.encryptionKeyVersion < 1 ||
    !roles.includes(share.role) || share.workspaceKey.version !== WORKSPACE_KEY_VERSION ||
    !HEX_PATTERN.test(share.workspaceKey.commitment) || share.wrapping.algorithm !== USER_IDENTITY_ALGORITHM ||
    share.wrapping.labelVersion !== 2 || share.signature.algorithm !== USER_SIGNING_ALGORITHM
  ) {
    throw new CipherSpaceCryptoError("workspace_key_share_unlock_failed", "The signed workspace key share is malformed or unsupported.");
  }
  const ciphertext = decodeBase64(share.wrapping.ciphertext, "workspace key ciphertext");
  const signature = decodeBase64(share.signature.value, "workspace key share signature");
  const validLengths = ciphertext.byteLength === RSA_CIPHERTEXT_LENGTH_BYTES && signature.byteLength === 64;
  ciphertext.fill(0);
  signature.fill(0);
  if (!validLengths) {
    throw new CipherSpaceCryptoError("workspace_key_share_unlock_failed", "The signed workspace key share has an invalid length.");
  }
}

export async function createSignedWorkspaceKeyShare(input: {
  operationId?: string;
  recipient: VerifiedIdentityBundle;
  role: "owner" | "editor" | "viewer";
  senderBundle: PublicIdentityBundle;
  senderSigningPrivateKey: CryptoKey;
  workspaceId: string;
  workspaceKey: CryptoKey;
}): Promise<SignedWorkspaceKeyShare> {
  assertWorkspaceKey(input.workspaceKey);
  assertVerifiedIdentityBundle(input.recipient);
  const base: Omit<SignedWorkspaceKeyShare, "signature"> = {
    operationId: input.operationId ?? crypto.randomUUID(),
    protocolVersion: WORKSPACE_KEY_SHARE_PROTOCOL_VERSION,
    recipient: {
      bundleSequence: input.recipient.bundleSequence,
      encryptionKeyFingerprint: input.recipient.encryptionKey.fingerprint,
      encryptionKeyVersion: input.recipient.encryptionKey.keyVersion,
      signingKeyFingerprint: input.recipient.signingKey.fingerprint,
      userId: input.recipient.userId
    },
    role: input.role,
    sender: {
      bundleSequence: input.senderBundle.bundleSequence,
      signingKeyFingerprint: input.senderBundle.signingKey.fingerprint,
      signingKeyVersion: input.senderBundle.signingKey.keyVersion,
      userId: input.senderBundle.userId
    },
    workspaceId: input.workspaceId,
    workspaceKey: { commitment: await workspaceKeyCommitment(input.workspaceKey), version: WORKSPACE_KEY_VERSION },
    wrapping: { algorithm: USER_IDENTITY_ALGORITHM, ciphertext: "", labelVersion: 2 }
  };
  const publicKey = await importUserEncryptionPublicKey(input.recipient.encryptionKey);
  const ciphertext = await crypto.subtle.wrapKey("raw", input.workspaceKey, publicKey, { label: wrapLabel(base), name: "RSA-OAEP" });
  base.wrapping.ciphertext = encodeBase64(new Uint8Array(ciphertext));
  return {
    ...base,
    signature: {
      algorithm: USER_SIGNING_ALGORITHM,
      value: await signIdentityBytes(input.senderSigningPrivateKey, workspaceKeyShareCanonicalBytes(base))
    }
  };
}

export async function verifySignedWorkspaceKeyShare(input: {
  recipientBundle: PublicIdentityBundle;
  senderSigningIdentity: PublicUserSigningIdentity & { fingerprint: string };
  share: SignedWorkspaceKeyShare;
  workspaceId: string;
}): Promise<void> {
  const { share } = input;
  assertShareShape(share);
  if (
    share.workspaceId !== input.workspaceId || share.recipient.userId !== input.recipientBundle.userId ||
    share.recipient.signingKeyFingerprint !== input.recipientBundle.signingKey.fingerprint ||
    share.recipient.bundleSequence !== input.recipientBundle.bundleSequence ||
    share.recipient.encryptionKeyFingerprint !== input.recipientBundle.encryptionKey.fingerprint ||
    share.recipient.encryptionKeyVersion !== input.recipientBundle.encryptionKey.keyVersion ||
    share.sender.signingKeyFingerprint !== input.senderSigningIdentity.fingerprint ||
    input.senderSigningIdentity.algorithm !== USER_SIGNING_ALGORITHM ||
    !(await verifyIdentitySignature(input.senderSigningIdentity, share.signature.value, workspaceKeyShareCanonicalBytes(unsignedShare(share))))
  ) {
    throw new CipherSpaceCryptoError("workspace_key_share_unlock_failed", "The signed workspace key share failed identity or signature verification.");
  }
}

export async function unwrapVerifiedWorkspaceKeyShare(input: {
  recipientBundle: PublicIdentityBundle;
  recipientPrivateKey: CryptoKey;
  senderSigningIdentity: PublicUserSigningIdentity & { fingerprint: string };
  share: SignedWorkspaceKeyShare;
  workspaceId: string;
}): Promise<CryptoKey> {
  await verifySignedWorkspaceKeyShare(input);
  const ciphertext = decodeBase64(input.share.wrapping.ciphertext, "workspace key ciphertext");
  try {
    const workspaceKey = await crypto.subtle.unwrapKey(
      "raw", ciphertext, input.recipientPrivateKey,
      { label: wrapLabel(unsignedShare(input.share)), name: "RSA-OAEP" },
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM }, true, ["decrypt", "encrypt"]
    );
    if ((await workspaceKeyCommitment(workspaceKey)) !== input.share.workspaceKey.commitment) {
      throw new CipherSpaceCryptoError("workspace_key_share_unlock_failed", "The workspace key commitment does not match the signed share.");
    }
    return workspaceKey;
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError("workspace_key_share_unlock_failed", "The signed workspace key share could not be decrypted.", { cause: error });
  } finally {
    ciphertext.fill(0);
  }
}
