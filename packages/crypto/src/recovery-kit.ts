import {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_KEY_LENGTH_BITS,
  NOTE_ENCRYPTION_ALGORITHM,
  RECOVERY_KIT_VERSION,
  USER_IDENTITY_ALGORITHM,
  USER_IDENTITY_KEY_VERSION
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import type {
  EncryptedUserRecoveryKit,
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
const MAX_PRIVATE_KEY_CIPHERTEXT_BYTES = 8_192;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const textEncoder = new TextEncoder();

const KIT_KEYS = [
  "created_at",
  "encrypted_private_key",
  "identity",
  "recovery_kit_version",
  "user_id"
];
const IDENTITY_KEYS = ["algorithm", "created_at", "key_version", "public_key"];
const ENCRYPTED_PRIVATE_KEY_KEYS = [
  "algorithm",
  "ciphertext",
  "format",
  "iterations",
  "kdf",
  "kdf_hash",
  "nonce",
  "salt"
];

function assertExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function assertContext(context: UserRecoveryKitContext): void {
  if (
    typeof context !== "object" ||
    context === null ||
    typeof context.userId !== "string" ||
    context.userId.length === 0 ||
    context.userId.length > 200
  ) {
    throw new TypeError("Recovery kit operations require a user identifier.");
  }
}

function assertRecoveryPassphrase(passphrase: unknown): asserts passphrase is string {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < MIN_RECOVERY_PASSPHRASE_LENGTH ||
    passphrase.length > MAX_PASSPHRASE_LENGTH
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_unlock_passphrase",
      `The recovery passphrase must contain ${MIN_RECOVERY_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters.`
    );
  }
}

function recoveryAuthenticatedData(kit: EncryptedUserRecoveryKit): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    JSON.stringify([
      "cipherspace.user-recovery-kit",
      kit.recovery_kit_version,
      kit.created_at,
      kit.user_id,
      kit.identity.algorithm,
      kit.identity.key_version,
      kit.identity.public_key,
      kit.identity.created_at,
      kit.encrypted_private_key.format,
      kit.encrypted_private_key.kdf,
      kit.encrypted_private_key.kdf_hash,
      kit.encrypted_private_key.iterations,
      kit.encrypted_private_key.algorithm
    ])
  );
}

async function deriveRecoveryKey(
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

function validateRecoveryKit(value: unknown): {
  ciphertext: Uint8Array<ArrayBuffer>;
  kit: EncryptedUserRecoveryKit;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!assertExactKeys(record, KIT_KEYS)) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit fields are invalid.");
  }
  const identity = record.identity;
  const encrypted = record.encrypted_private_key;
  if (
    typeof identity !== "object" ||
    identity === null ||
    Array.isArray(identity) ||
    !assertExactKeys(identity as Record<string, unknown>, IDENTITY_KEYS) ||
    typeof encrypted !== "object" ||
    encrypted === null ||
    Array.isArray(encrypted) ||
    !assertExactKeys(encrypted as Record<string, unknown>, ENCRYPTED_PRIVATE_KEY_KEYS)
  ) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit fields are invalid.");
  }
  const identityRecord = identity as Record<string, unknown>;
  const encryptedRecord = encrypted as Record<string, unknown>;
  if (
    record.recovery_kit_version !== RECOVERY_KIT_VERSION ||
    typeof record.user_id !== "string" ||
    record.user_id.length === 0 ||
    record.user_id.length > 200 ||
    !isIsoDate(record.created_at) ||
    identityRecord.algorithm !== USER_IDENTITY_ALGORITHM ||
    identityRecord.key_version !== USER_IDENTITY_KEY_VERSION ||
    typeof identityRecord.public_key !== "string" ||
    identityRecord.public_key.length === 0 ||
    identityRecord.public_key.length > 2_048 ||
    !isIsoDate(identityRecord.created_at) ||
    encryptedRecord.algorithm !== NOTE_ENCRYPTION_ALGORITHM ||
    encryptedRecord.format !== "PKCS8" ||
    encryptedRecord.iterations !== KDF_ITERATIONS ||
    encryptedRecord.kdf !== KDF_ALGORITHM ||
    encryptedRecord.kdf_hash !== KDF_HASH
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_recovery_kit",
      "Recovery kit uses an unsupported or malformed format."
    );
  }
  let ciphertext: Uint8Array<ArrayBuffer>;
  let nonce: Uint8Array<ArrayBuffer>;
  let salt: Uint8Array<ArrayBuffer>;
  try {
    ciphertext = decodeBase64(encryptedRecord.ciphertext, "encrypted_private_key.ciphertext");
    nonce = decodeBase64(encryptedRecord.nonce, "encrypted_private_key.nonce");
    salt = decodeBase64(encryptedRecord.salt, "encrypted_private_key.salt");
  } catch (error) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit encoding is invalid.", {
      cause: error
    });
  }
  if (
    ciphertext.byteLength <= AES_GCM_TAG_LENGTH_BITS / 8 ||
    ciphertext.byteLength > MAX_PRIVATE_KEY_CIPHERTEXT_BYTES ||
    nonce.byteLength !== AES_GCM_NONCE_LENGTH_BYTES ||
    salt.byteLength !== SALT_LENGTH_BYTES
  ) {
    throw new CipherSpaceCryptoError("invalid_recovery_kit", "Recovery kit data length is invalid.");
  }
  return { ciphertext, kit: value as EncryptedUserRecoveryKit, nonce, salt };
}

export async function exportUserRecoveryKit(
  identity: LocalUserCryptoIdentity,
  identityPassphrase: string,
  recoveryPassphrase: string,
  context: UserRecoveryKitExportContext
): Promise<EncryptedUserRecoveryKit> {
  assertContext(context);
  assertRecoveryPassphrase(recoveryPassphrase);
  if (!isIsoDate(context.identityCreatedAt)) {
    throw new TypeError("Recovery kit export requires the identity creation date.");
  }
  const createdAt = context.createdAt ?? new Date().toISOString();
  if (!isIsoDate(createdAt)) throw new TypeError("Recovery kit creation date is invalid.");
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    privateBytes = await decryptProtectedUserPrivateKeyBytes(identity, identityPassphrase, {
      userId: context.userId
    });
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LENGTH_BYTES));
    const kit: EncryptedUserRecoveryKit = {
      created_at: createdAt,
      encrypted_private_key: {
        algorithm: NOTE_ENCRYPTION_ALGORITHM,
        ciphertext: "",
        format: "PKCS8",
        iterations: KDF_ITERATIONS,
        kdf: KDF_ALGORITHM,
        kdf_hash: KDF_HASH,
        nonce: encodeBase64(nonce),
        salt: encodeBase64(salt)
      },
      identity: {
        algorithm: identity.algorithm,
        created_at: context.identityCreatedAt,
        key_version: identity.keyVersion,
        public_key: identity.publicKey
      },
      recovery_kit_version: RECOVERY_KIT_VERSION,
      user_id: context.userId
    };
    const key = await deriveRecoveryKey(recoveryPassphrase, salt);
    const ciphertext = await crypto.subtle.encrypt(
      {
        additionalData: recoveryAuthenticatedData(kit),
        iv: nonce,
        name: NOTE_ENCRYPTION_ALGORITHM,
        tagLength: AES_GCM_TAG_LENGTH_BITS
      },
      key,
      privateBytes
    );
    kit.encrypted_private_key.ciphertext = encodeBase64(new Uint8Array(ciphertext));
    return kit;
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError(
      "recovery_kit_encryption_failed",
      "The encrypted recovery kit could not be created.",
      { cause: error }
    );
  } finally {
    privateBytes?.fill(0);
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
  const { ciphertext, kit, nonce, salt } = validateRecoveryKit(value);
  if (kit.user_id !== context.userId) {
    ciphertext.fill(0);
    nonce.fill(0);
    salt.fill(0);
    throw new CipherSpaceCryptoError(
      "invalid_recovery_kit",
      "This recovery kit belongs to a different account."
    );
  }
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const key = await deriveRecoveryKey(recoveryPassphrase, salt);
    privateBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          additionalData: recoveryAuthenticatedData(kit),
          iv: nonce,
          name: NOTE_ENCRYPTION_ALGORITHM,
          tagLength: AES_GCM_TAG_LENGTH_BITS
        },
        key,
        ciphertext
      )
    );
    const publicIdentity: PublicUserCryptoIdentity = {
      algorithm: kit.identity.algorithm,
      keyVersion: kit.identity.key_version,
      publicKey: kit.identity.public_key
    };
    await verifyUserIdentityPrivateKeyBytes(privateBytes, publicIdentity);
    const protectedPrivateKey = await protectUserPrivateKeyBytes(
      privateBytes,
      localIdentityPassphrase,
      { userId: context.userId }
    );
    return {
      identity: { ...publicIdentity, protectedPrivateKey },
      identityCreatedAt: kit.identity.created_at
    };
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "recovery_kit_decryption_failed",
      "The recovery kit could not be decrypted. Check the passphrase and kit contents.",
      { cause: error }
    );
  } finally {
    privateBytes?.fill(0);
    ciphertext.fill(0);
    nonce.fill(0);
    salt.fill(0);
  }
}
