import {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_KEY_LENGTH_BITS,
  NOTE_ENCRYPTION_ALGORITHM,
  USER_IDENTITY_ALGORITHM,
  USER_IDENTITY_KEY_VERSION
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import type {
  EncryptedWorkspaceKeyShare,
  LocalUserCryptoIdentity,
  ProtectedUserPrivateKey,
  PublicUserCryptoIdentity,
  UserIdentityProtectionContext,
  WorkspaceKeyShareContext
} from "./types.js";
import { assertWorkspaceKey } from "./workspace-key.js";

const RSA_ALGORITHM = "RSA-OAEP" as const;
const RSA_HASH = "SHA-256" as const;
const RSA_MODULUS_LENGTH = 3072;
const RSA_PUBLIC_EXPONENT = new Uint8Array([1, 0, 1]);
const RSA_CIPHERTEXT_LENGTH_BYTES = RSA_MODULUS_LENGTH / 8;
const PROTECTION_VERSION = 1 as const;
const KDF_ALGORITHM = "PBKDF2" as const;
const KDF_HASH = "SHA-256" as const;
const KDF_ITERATIONS = 600_000 as const;
const SALT_LENGTH_BYTES = 16;
const MIN_PASSPHRASE_LENGTH = 12;
const MAX_PASSPHRASE_LENGTH = 128;
const MAX_PRIVATE_KEY_CIPHERTEXT_BYTES = 8_192;
const MAX_PUBLIC_KEY_BYTES = 1_024;
const textEncoder = new TextEncoder();

function assertPassphrase(passphrase: unknown): asserts passphrase is string {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < MIN_PASSPHRASE_LENGTH ||
    passphrase.length > MAX_PASSPHRASE_LENGTH
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_unlock_passphrase",
      `The identity protection password must contain ${MIN_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters.`
    );
  }
}

function assertIdentityContext(context: UserIdentityProtectionContext): void {
  if (
    typeof context !== "object" ||
    context === null ||
    typeof context.userId !== "string" ||
    context.userId.length === 0 ||
    context.userId.length > 200
  ) {
    throw new TypeError("Identity key protection requires a user identifier.");
  }
}

function assertShareContext(context: WorkspaceKeyShareContext): void {
  if (
    typeof context !== "object" ||
    context === null ||
    typeof context.workspaceId !== "string" ||
    context.workspaceId.length === 0 ||
    context.workspaceId.length > 200 ||
    typeof context.recipientUserId !== "string" ||
    context.recipientUserId.length === 0 ||
    context.recipientUserId.length > 200 ||
    !Number.isSafeInteger(context.recipientKeyVersion) ||
    context.recipientKeyVersion < 1
  ) {
    throw new TypeError("Workspace key sharing requires valid workspace and recipient metadata.");
  }
}

function identityProtectionData(context: UserIdentityProtectionContext): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `cipherspace.user-identity|${PROTECTION_VERSION}|${KDF_ALGORITHM}|${KDF_HASH}|${KDF_ITERATIONS}|${USER_IDENTITY_ALGORITHM}|${USER_IDENTITY_KEY_VERSION}|${context.userId}`
  );
}

function shareLabel(context: WorkspaceKeyShareContext): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `cipherspace.workspace-key-share|1|${USER_IDENTITY_ALGORITHM}|${context.workspaceId}|${context.recipientUserId}|${context.recipientKeyVersion}`
  );
}

async function deriveProtectionKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const encoded = textEncoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey("raw", encoded, KDF_ALGORITHM, false, [
      "deriveKey"
    ]);
    return await crypto.subtle.deriveKey(
      { hash: KDF_HASH, iterations: KDF_ITERATIONS, name: KDF_ALGORITHM, salt },
      material,
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM },
      false,
      ["decrypt", "encrypt"]
    );
  } finally {
    encoded.fill(0);
  }
}

async function importPublicKey(identity: PublicUserCryptoIdentity): Promise<CryptoKey> {
  if (
    identity.algorithm !== USER_IDENTITY_ALGORITHM ||
    identity.keyVersion !== USER_IDENTITY_KEY_VERSION
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_public_identity_key",
      "The recipient identity key uses an unsupported algorithm or version."
    );
  }
  const bytes = decodeBase64(identity.publicKey, "publicKey");
  if (bytes.byteLength > MAX_PUBLIC_KEY_BYTES) {
    throw new CipherSpaceCryptoError(
      "invalid_public_identity_key",
      "The recipient public key is invalid."
    );
  }
  try {
    return await crypto.subtle.importKey(
      "spki",
      bytes,
      { hash: RSA_HASH, name: RSA_ALGORITHM },
      false,
      ["encrypt", "wrapKey"]
    );
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "invalid_public_identity_key",
      "The recipient public key is invalid.",
      { cause: error }
    );
  } finally {
    bytes.fill(0);
  }
}

function validateProtectedPrivateKey(value: unknown): {
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_identity_key",
      "Protected identity key must be an object."
    );
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "algorithm",
    "ciphertext",
    "identityAlgorithm",
    "identityKeyVersion",
    "iterations",
    "kdf",
    "kdfHash",
    "nonce",
    "salt",
    "version"
  ];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    record.algorithm !== NOTE_ENCRYPTION_ALGORITHM ||
    record.identityAlgorithm !== USER_IDENTITY_ALGORITHM ||
    record.identityKeyVersion !== USER_IDENTITY_KEY_VERSION ||
    record.iterations !== KDF_ITERATIONS ||
    record.kdf !== KDF_ALGORITHM ||
    record.kdfHash !== KDF_HASH ||
    record.version !== PROTECTION_VERSION
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_identity_key",
      "Protected identity key uses an unsupported or malformed format."
    );
  }
  const ciphertext = decodeBase64(record.ciphertext, "ciphertext");
  const nonce = decodeBase64(record.nonce, "nonce");
  const salt = decodeBase64(record.salt, "salt");
  if (
    ciphertext.byteLength <= AES_GCM_TAG_LENGTH_BITS / 8 ||
    ciphertext.byteLength > MAX_PRIVATE_KEY_CIPHERTEXT_BYTES ||
    nonce.byteLength !== AES_GCM_NONCE_LENGTH_BYTES ||
    salt.byteLength !== SALT_LENGTH_BYTES
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_identity_key",
      "Protected identity key contains data with an invalid length."
    );
  }
  return { ciphertext, nonce, salt };
}

export async function createUserCryptoIdentity(
  passphrase: string,
  context: UserIdentityProtectionContext
): Promise<LocalUserCryptoIdentity> {
  assertPassphrase(passphrase);
  assertIdentityContext(context);
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const pair = await crypto.subtle.generateKey(
      {
        hash: RSA_HASH,
        modulusLength: RSA_MODULUS_LENGTH,
        name: RSA_ALGORITHM,
        publicExponent: RSA_PUBLIC_EXPONENT
      },
      true,
      ["decrypt", "encrypt", "unwrapKey", "wrapKey"]
    );
    const [publicBuffer, privateBuffer] = await Promise.all([
      crypto.subtle.exportKey("spki", pair.publicKey),
      crypto.subtle.exportKey("pkcs8", pair.privateKey)
    ]);
    privateBytes = new Uint8Array(privateBuffer);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LENGTH_BYTES));
    const protectionKey = await deriveProtectionKey(passphrase, salt);
    const ciphertext = await crypto.subtle.encrypt(
      {
        additionalData: identityProtectionData(context),
        iv: nonce,
        name: NOTE_ENCRYPTION_ALGORITHM,
        tagLength: AES_GCM_TAG_LENGTH_BITS
      },
      protectionKey,
      privateBytes
    );
    const protectedPrivateKey: ProtectedUserPrivateKey = {
      algorithm: NOTE_ENCRYPTION_ALGORITHM,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      identityAlgorithm: USER_IDENTITY_ALGORITHM,
      identityKeyVersion: USER_IDENTITY_KEY_VERSION,
      iterations: KDF_ITERATIONS,
      kdf: KDF_ALGORITHM,
      kdfHash: KDF_HASH,
      nonce: encodeBase64(nonce),
      salt: encodeBase64(salt),
      version: PROTECTION_VERSION
    };
    return {
      algorithm: USER_IDENTITY_ALGORITHM,
      keyVersion: USER_IDENTITY_KEY_VERSION,
      protectedPrivateKey,
      publicKey: encodeBase64(new Uint8Array(publicBuffer))
    };
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError(
      "identity_key_generation_failed",
      "User encryption identity generation failed.",
      { cause: error }
    );
  } finally {
    privateBytes?.fill(0);
  }
}

export async function unlockUserCryptoIdentity(
  identity: LocalUserCryptoIdentity,
  passphrase: string,
  context: UserIdentityProtectionContext
): Promise<CryptoKey> {
  assertPassphrase(passphrase);
  assertIdentityContext(context);
  const { ciphertext, nonce, salt } = validateProtectedPrivateKey(identity.protectedPrivateKey);
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const protectionKey = await deriveProtectionKey(passphrase, salt);
    privateBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          additionalData: identityProtectionData(context),
          iv: nonce,
          name: NOTE_ENCRYPTION_ALGORITHM,
          tagLength: AES_GCM_TAG_LENGTH_BITS
        },
        protectionKey,
        ciphertext
      )
    );
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateBytes,
      { hash: RSA_HASH, name: RSA_ALGORITHM },
      false,
      ["decrypt", "unwrapKey"]
    );
    const publicKey = await importPublicKey(identity);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await crypto.subtle.encrypt(
      { label: textEncoder.encode("cipherspace.identity-key-check|1"), name: RSA_ALGORITHM },
      publicKey,
      challenge
    );
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { label: textEncoder.encode("cipherspace.identity-key-check|1"), name: RSA_ALGORITHM },
        privateKey,
        encrypted
      )
    );
    if (decrypted.length !== challenge.length || decrypted.some((byte, index) => byte !== challenge[index])) {
      throw new Error("Identity key pair mismatch.");
    }
    challenge.fill(0);
    decrypted.fill(0);
    return privateKey;
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "identity_key_unlock_failed",
      "The local encryption identity could not be unlocked.",
      { cause: error }
    );
  } finally {
    privateBytes?.fill(0);
    ciphertext.fill(0);
    nonce.fill(0);
    salt.fill(0);
  }
}

export async function wrapWorkspaceKeyForRecipient(
  workspaceKey: CryptoKey,
  recipient: PublicUserCryptoIdentity,
  context: WorkspaceKeyShareContext
): Promise<EncryptedWorkspaceKeyShare> {
  assertWorkspaceKey(workspaceKey);
  assertShareContext(context);
  if (recipient.keyVersion !== context.recipientKeyVersion) {
    throw new CipherSpaceCryptoError(
      "invalid_public_identity_key",
      "The recipient key version does not match the share context."
    );
  }
  try {
    const publicKey = await importPublicKey(recipient);
    const ciphertext = await crypto.subtle.wrapKey(
      "raw",
      workspaceKey,
      publicKey,
      { label: shareLabel(context), name: RSA_ALGORITHM }
    );
    return {
      algorithm: USER_IDENTITY_ALGORITHM,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      recipientKeyVersion: recipient.keyVersion
    };
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError(
      "workspace_key_share_failed",
      "Workspace key wrapping failed.",
      { cause: error }
    );
  }
}

export async function unwrapWorkspaceKeyShare(
  share: EncryptedWorkspaceKeyShare,
  privateKey: CryptoKey,
  context: WorkspaceKeyShareContext
): Promise<CryptoKey> {
  assertShareContext(context);
  if (
    share.algorithm !== USER_IDENTITY_ALGORITHM ||
    share.recipientKeyVersion !== context.recipientKeyVersion
  ) {
    throw new CipherSpaceCryptoError(
      "workspace_key_share_unlock_failed",
      "The encrypted workspace key share uses unsupported metadata."
    );
  }
  const ciphertext = decodeBase64(share.ciphertext, "ciphertext");
  if (ciphertext.byteLength !== RSA_CIPHERTEXT_LENGTH_BYTES) {
    throw new CipherSpaceCryptoError(
      "workspace_key_share_unlock_failed",
      "The encrypted workspace key share has an invalid length."
    );
  }
  try {
    return await crypto.subtle.unwrapKey(
      "raw",
      ciphertext,
      privateKey,
      { label: shareLabel(context), name: RSA_ALGORITHM },
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM },
      true,
      ["decrypt", "encrypt"]
    );
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "workspace_key_share_unlock_failed",
      "The encrypted workspace key share could not be decrypted.",
      { cause: error }
    );
  } finally {
    ciphertext.fill(0);
  }
}
