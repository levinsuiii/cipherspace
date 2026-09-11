import {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_KEY_LENGTH_BITS,
  LEGACY_RECOVERY_KIT_VERSION,
  NOTE_ENCRYPTION_ALGORITHM,
  RECOVERY_KIT_VERSION,
  USER_IDENTITY_ALGORITHM,
  USER_IDENTITY_KEY_VERSION
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import { verifyIdentityBundle } from "./identity-bundle.js";
import {
  decryptProtectedSigningPrivateKeyBytes,
  protectSigningPrivateKeyBytes,
  verifySigningPrivateKeyBytes
} from "./signing-identity.js";
import type {
  EncryptedUserRecoveryKit,
  EncryptedUserRecoveryKitV2,
  LegacyEncryptedUserRecoveryKit,
  LocalUserCryptoIdentity,
  PublicUserCryptoIdentity,
  UserRecoveryKitContext,
  UserRecoveryKitExportContext
} from "./types.js";
import {
  decryptProtectedUserPrivateKeyBytes,
  protectUserPrivateKeyBytes,
  verifyUserIdentityPrivateKeyBytes
} from "./user-identity.js";

const KDF_ALGORITHM = "PBKDF2" as const;
const KDF_HASH = "SHA-256" as const;
const KDF_ITERATIONS = 600_000 as const;
const SALT_LENGTH_BYTES = 16;
const MIN_RECOVERY_PASSPHRASE_LENGTH = 16;
const MAX_PASSPHRASE_LENGTH = 128;
const MAX_PRIVATE_KEY_CIPHERTEXT_BYTES = 16_384;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function exactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(record).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function assertContext(context: UserRecoveryKitContext): void {
  if (!context || typeof context.userId !== "string" || context.userId.length < 1 || context.userId.length > 200) {
    throw new TypeError("Recovery kit operations require a user identifier.");
  }
}

function assertRecoveryPassphrase(passphrase: unknown): asserts passphrase is string {
  if (typeof passphrase !== "string" || passphrase.length < MIN_RECOVERY_PASSPHRASE_LENGTH || passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new CipherSpaceCryptoError(
      "invalid_unlock_passphrase",
      `The recovery passphrase must contain ${MIN_RECOVERY_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters.`
    );
  }
}

async function deriveRecoveryKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoded = textEncoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey("raw", encoded, KDF_ALGORITHM, false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { hash: KDF_HASH, iterations: KDF_ITERATIONS, name: KDF_ALGORITHM, salt }, material,
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM }, false, ["decrypt", "encrypt"]
    );
  } finally { encoded.fill(0); }
}

function v1AuthenticatedData(kit: LegacyEncryptedUserRecoveryKit): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    "cipherspace.user-recovery-kit", LEGACY_RECOVERY_KIT_VERSION, kit.created_at, kit.user_id,
    kit.identity.algorithm, kit.identity.key_version, kit.identity.public_key, kit.identity.created_at,
    kit.encrypted_private_key.format, kit.encrypted_private_key.kdf,
    kit.encrypted_private_key.kdf_hash, kit.encrypted_private_key.iterations,
    kit.encrypted_private_key.algorithm
  ]));
}

function v2AuthenticatedData(kit: EncryptedUserRecoveryKitV2): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    "cipherspace.user-recovery-kit", RECOVERY_KIT_VERSION, kit.created_at, kit.user_id,
    kit.identity_bundle.bundleHash, kit.identity_bundle.signature.value,
    kit.encrypted_private_keys.format, kit.encrypted_private_keys.kdf,
    kit.encrypted_private_keys.kdf_hash, kit.encrypted_private_keys.iterations,
    kit.encrypted_private_keys.algorithm
  ]));
}

function decodeEnvelope(encrypted: Record<string, unknown>): {
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  let ciphertext: Uint8Array<ArrayBuffer>;
  let nonce: Uint8Array<ArrayBuffer>;
  let salt: Uint8Array<ArrayBuffer>;
  try {
    ciphertext = decodeBase64(encrypted.ciphertext, "encrypted private keys ciphertext");
    nonce = decodeBase64(encrypted.nonce, "encrypted private keys nonce");
    salt = decodeBase64(encrypted.salt, "encrypted private keys salt");
  } catch (error) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit encoding is invalid.", { cause: error });
  }
  if (
    ciphertext.byteLength <= AES_GCM_TAG_LENGTH_BITS / 8 || ciphertext.byteLength > MAX_PRIVATE_KEY_CIPHERTEXT_BYTES ||
    nonce.byteLength !== AES_GCM_NONCE_LENGTH_BYTES || salt.byteLength !== SALT_LENGTH_BYTES
  ) {
    ciphertext.fill(0); nonce.fill(0); salt.fill(0);
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit data length is invalid.");
  }
  return { ciphertext, nonce, salt };
}

function validateV1(value: unknown): {
  kit: LegacyEncryptedUserRecoveryKit;
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  if (!isRecord(value) || !exactKeys(value, ["created_at", "encrypted_private_key", "identity", "recovery_kit_version", "user_id"]) ||
      value.recovery_kit_version !== LEGACY_RECOVERY_KIT_VERSION || !isIsoDate(value.created_at) ||
      typeof value.user_id !== "string" || !isRecord(value.identity) || !isRecord(value.encrypted_private_key)) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Legacy recovery kit fields are invalid.");
  }
  const identity = value.identity;
  const encrypted = value.encrypted_private_key;
  if (!exactKeys(identity, ["algorithm", "created_at", "key_version", "public_key"]) ||
      !exactKeys(encrypted, ["algorithm", "ciphertext", "format", "iterations", "kdf", "kdf_hash", "nonce", "salt"]) ||
      identity.algorithm !== USER_IDENTITY_ALGORITHM || identity.key_version !== USER_IDENTITY_KEY_VERSION ||
      typeof identity.public_key !== "string" || !isIsoDate(identity.created_at) ||
      encrypted.algorithm !== NOTE_ENCRYPTION_ALGORITHM || encrypted.format !== "PKCS8" ||
      encrypted.iterations !== KDF_ITERATIONS || encrypted.kdf !== KDF_ALGORITHM || encrypted.kdf_hash !== KDF_HASH) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Legacy recovery kit format is unsupported or malformed.");
  }
  return { kit: value as unknown as LegacyEncryptedUserRecoveryKit, ...decodeEnvelope(encrypted) };
}

async function validateV2(value: unknown): Promise<{
  kit: EncryptedUserRecoveryKitV2;
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}> {
  if (!isRecord(value) || !exactKeys(value, ["created_at", "encrypted_private_keys", "identity_bundle", "recovery_kit_version", "user_id"]) ||
      value.recovery_kit_version !== RECOVERY_KIT_VERSION || !isIsoDate(value.created_at) ||
      typeof value.user_id !== "string" || !isRecord(value.encrypted_private_keys) || !isRecord(value.identity_bundle)) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit fields are invalid.");
  }
  const encrypted = value.encrypted_private_keys;
  if (!exactKeys(encrypted, ["algorithm", "ciphertext", "format", "iterations", "kdf", "kdf_hash", "nonce", "salt"]) ||
      encrypted.algorithm !== NOTE_ENCRYPTION_ALGORITHM || encrypted.format !== "CIPHERSPACE-IDENTITY-KEYS-V2" ||
      encrypted.iterations !== KDF_ITERATIONS || encrypted.kdf !== KDF_ALGORITHM || encrypted.kdf_hash !== KDF_HASH) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit format is unsupported or malformed.");
  }
  const kit = value as unknown as EncryptedUserRecoveryKitV2;
  if (kit.identity_bundle.userId !== kit.user_id) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit identity does not match its account.");
  }
  await verifyIdentityBundle(kit.identity_bundle);
  return { kit, ...decodeEnvelope(encrypted) };
}

export async function exportUserRecoveryKit(
  identity: LocalUserCryptoIdentity,
  identityPassphrase: string,
  recoveryPassphrase: string,
  context: UserRecoveryKitExportContext
): Promise<EncryptedUserRecoveryKit> {
  assertContext(context);
  assertRecoveryPassphrase(recoveryPassphrase);
  if (!identity.signingIdentity || !identity.identityBundle) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Upgrade the local identity before exporting a recovery kit.");
  }
  if (!isIsoDate(context.identityCreatedAt)) throw new TypeError("Recovery kit export requires the identity creation date.");
  const createdAt = context.createdAt ?? new Date().toISOString();
  if (!isIsoDate(createdAt)) throw new TypeError("Recovery kit creation date is invalid.");
  let rsaBytes: Uint8Array<ArrayBuffer> | undefined;
  let signingBytes: Uint8Array<ArrayBuffer> | undefined;
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    [rsaBytes, signingBytes] = await Promise.all([
      decryptProtectedUserPrivateKeyBytes(identity, identityPassphrase, { userId: context.userId }),
      decryptProtectedSigningPrivateKeyBytes(identity.signingIdentity, identityPassphrase, { userId: context.userId })
    ]);
    plaintext = textEncoder.encode(JSON.stringify([
      "cipherspace.identity-private-keys", 2, encodeBase64(rsaBytes), encodeBase64(signingBytes)
    ]));
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LENGTH_BYTES));
    const kit: EncryptedUserRecoveryKitV2 = {
      created_at: createdAt,
      encrypted_private_keys: {
        algorithm: NOTE_ENCRYPTION_ALGORITHM, ciphertext: "", format: "CIPHERSPACE-IDENTITY-KEYS-V2",
        iterations: KDF_ITERATIONS, kdf: KDF_ALGORITHM, kdf_hash: KDF_HASH,
        nonce: encodeBase64(nonce), salt: encodeBase64(salt)
      },
      identity_bundle: identity.identityBundle,
      recovery_kit_version: RECOVERY_KIT_VERSION,
      user_id: context.userId
    };
    const key = await deriveRecoveryKey(recoveryPassphrase, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { additionalData: v2AuthenticatedData(kit), iv: nonce, name: NOTE_ENCRYPTION_ALGORITHM, tagLength: AES_GCM_TAG_LENGTH_BITS },
      key, plaintext
    );
    kit.encrypted_private_keys.ciphertext = encodeBase64(new Uint8Array(ciphertext));
    return kit;
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError("recovery_kit_encryption_failed", "The encrypted recovery kit could not be created.", { cause: error });
  } finally {
    rsaBytes?.fill(0); signingBytes?.fill(0); plaintext?.fill(0);
  }
}

async function importV1(value: unknown, recoveryPassphrase: string, localIdentityPassphrase: string, context: UserRecoveryKitContext) {
  const { kit, ciphertext, nonce, salt } = validateV1(value);
  if (kit.user_id !== context.userId) throw new CipherSpaceCryptoError("invalid_recovery_kit", "This recovery kit belongs to a different account.");
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const key = await deriveRecoveryKey(recoveryPassphrase, salt);
    privateBytes = new Uint8Array(await crypto.subtle.decrypt(
      { additionalData: v1AuthenticatedData(kit), iv: nonce, name: NOTE_ENCRYPTION_ALGORITHM, tagLength: AES_GCM_TAG_LENGTH_BITS }, key, ciphertext
    ));
    const publicIdentity: PublicUserCryptoIdentity = {
      algorithm: kit.identity.algorithm, keyVersion: kit.identity.key_version, publicKey: kit.identity.public_key
    };
    await verifyUserIdentityPrivateKeyBytes(privateBytes, publicIdentity);
    return {
      identity: { ...publicIdentity, protectedPrivateKey: await protectUserPrivateKeyBytes(privateBytes, localIdentityPassphrase, context) },
      identityCreatedAt: kit.identity.created_at
    };
  } finally { privateBytes?.fill(0); ciphertext.fill(0); nonce.fill(0); salt.fill(0); }
}

async function importV2(value: unknown, recoveryPassphrase: string, localIdentityPassphrase: string, context: UserRecoveryKitContext) {
  const { kit, ciphertext, nonce, salt } = await validateV2(value);
  if (kit.user_id !== context.userId) throw new CipherSpaceCryptoError("invalid_recovery_kit", "This recovery kit belongs to a different account.");
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  let rsaBytes: Uint8Array<ArrayBuffer> | undefined;
  let signingBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const key = await deriveRecoveryKey(recoveryPassphrase, salt);
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { additionalData: v2AuthenticatedData(kit), iv: nonce, name: NOTE_ENCRYPTION_ALGORITHM, tagLength: AES_GCM_TAG_LENGTH_BITS }, key, ciphertext
    ));
    const decoded = JSON.parse(textDecoder.decode(plaintext)) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== "cipherspace.identity-private-keys" || decoded[1] !== 2) {
      throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit private payload is invalid.");
    }
    rsaBytes = decodeBase64(decoded[2], "RSA private key");
    signingBytes = decodeBase64(decoded[3], "signing private key");
    await Promise.all([
      verifyUserIdentityPrivateKeyBytes(rsaBytes, kit.identity_bundle.encryptionKey),
      verifySigningPrivateKeyBytes(signingBytes, kit.identity_bundle.signingKey)
    ]);
    return {
      identity: {
        algorithm: kit.identity_bundle.encryptionKey.algorithm,
        identityBundle: kit.identity_bundle,
        keyVersion: kit.identity_bundle.encryptionKey.keyVersion,
        protectedPrivateKey: await protectUserPrivateKeyBytes(rsaBytes, localIdentityPassphrase, context),
        publicKey: kit.identity_bundle.encryptionKey.publicKey,
        signingIdentity: {
          algorithm: kit.identity_bundle.signingKey.algorithm,
          keyVersion: kit.identity_bundle.signingKey.keyVersion,
          protectedPrivateKey: await protectSigningPrivateKeyBytes(signingBytes, localIdentityPassphrase, context),
          publicKey: kit.identity_bundle.signingKey.publicKey
        }
      },
      identityCreatedAt: kit.identity_bundle.createdAt
    };
  } finally {
    plaintext?.fill(0); rsaBytes?.fill(0); signingBytes?.fill(0);
    ciphertext.fill(0); nonce.fill(0); salt.fill(0);
  }
}

export async function importUserRecoveryKit(
  value: unknown,
  recoveryPassphrase: string,
  localIdentityPassphrase: string,
  context: UserRecoveryKitContext
): Promise<{ identity: LocalUserCryptoIdentity; identityCreatedAt: string }> {
  assertContext(context);
  assertRecoveryPassphrase(recoveryPassphrase);
  try {
    if (!isRecord(value)) throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit must be an object.");
    if (value.recovery_kit_version === LEGACY_RECOVERY_KIT_VERSION) {
      return await importV1(value, recoveryPassphrase, localIdentityPassphrase, context);
    }
    if (value.recovery_kit_version === RECOVERY_KIT_VERSION) {
      return await importV2(value, recoveryPassphrase, localIdentityPassphrase, context);
    }
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit version is unsupported.");
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError && error.code === "invalid_recovery_kit") throw error;
    throw new CipherSpaceCryptoError("recovery_kit_decryption_failed", "The recovery kit could not be decrypted. Check the passphrase and kit contents.", { cause: error });
  }
}
