import {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_KEY_LENGTH_BITS,
  NOTE_ENCRYPTION_ALGORITHM
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import type {
  ProtectedWorkspaceKey,
  WorkspaceKeyProtectionContext
} from "./types.js";
import { assertWorkspaceKey } from "./workspace-key.js";

const PROTECTION_VERSION = 1 as const;
const KDF_ALGORITHM = "PBKDF2" as const;
const KDF_HASH = "SHA-256" as const;
const KDF_ITERATIONS = 600_000 as const;
const SALT_LENGTH_BYTES = 16;
const WRAPPED_KEY_LENGTH_BYTES = AES_KEY_LENGTH_BITS / 8 + AES_GCM_TAG_LENGTH_BITS / 8;
const MIN_UNLOCK_PASSPHRASE_LENGTH = 12;
const MAX_UNLOCK_PASSPHRASE_LENGTH = 128;
const ENVELOPE_KEYS = [
  "algorithm",
  "ciphertext",
  "iterations",
  "kdf",
  "kdfHash",
  "nonce",
  "salt",
  "version",
  "workspaceKeyAlgorithm",
  "workspaceKeyLength"
];
const textEncoder = new TextEncoder();

function assertContext(context: WorkspaceKeyProtectionContext): void {
  if (
    typeof context !== "object" ||
    context === null ||
    typeof context.userId !== "string" ||
    context.userId.length === 0 ||
    context.userId.length > 200 ||
    typeof context.workspaceId !== "string" ||
    context.workspaceId.length === 0 ||
    context.workspaceId.length > 200
  ) {
    throw new TypeError("Workspace key protection requires user and workspace identifiers.");
  }
}

function assertPassphrase(passphrase: unknown): asserts passphrase is string {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < MIN_UNLOCK_PASSPHRASE_LENGTH ||
    passphrase.length > MAX_UNLOCK_PASSPHRASE_LENGTH
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_unlock_passphrase",
      `The local unlock password must contain ${MIN_UNLOCK_PASSPHRASE_LENGTH} to ${MAX_UNLOCK_PASSPHRASE_LENGTH} characters.`
    );
  }
}

function authenticatedContext(context: WorkspaceKeyProtectionContext): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `cipherspace.workspace-key|${PROTECTION_VERSION}|${KDF_ALGORITHM}|${KDF_HASH}|${KDF_ITERATIONS}|${NOTE_ENCRYPTION_ALGORITHM}|${AES_KEY_LENGTH_BITS}|${context.userId}|${context.workspaceId}`
  );
}

async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const encodedPassphrase = textEncoder.encode(passphrase);
  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encodedPassphrase,
      KDF_ALGORITHM,
      false,
      ["deriveKey"]
    );
    return await crypto.subtle.deriveKey(
      {
        hash: KDF_HASH,
        iterations: KDF_ITERATIONS,
        name: KDF_ALGORITHM,
        salt
      },
      keyMaterial,
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM },
      false,
      ["unwrapKey", "wrapKey"]
    );
  } finally {
    encodedPassphrase.fill(0);
  }
}

function validateProtectedKey(value: unknown): {
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_workspace_key",
      "Protected workspace key must be an object."
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    keys.some((key, index) => key !== ENVELOPE_KEYS[index]) ||
    record.algorithm !== NOTE_ENCRYPTION_ALGORITHM ||
    record.iterations !== KDF_ITERATIONS ||
    record.kdf !== KDF_ALGORITHM ||
    record.kdfHash !== KDF_HASH ||
    record.version !== PROTECTION_VERSION ||
    record.workspaceKeyAlgorithm !== NOTE_ENCRYPTION_ALGORITHM ||
    record.workspaceKeyLength !== AES_KEY_LENGTH_BITS
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_workspace_key",
      "Protected workspace key uses an unsupported or malformed format."
    );
  }

  let ciphertext: Uint8Array<ArrayBuffer>;
  let nonce: Uint8Array<ArrayBuffer>;
  let salt: Uint8Array<ArrayBuffer>;
  try {
    ciphertext = decodeBase64(record.ciphertext, "ciphertext");
    nonce = decodeBase64(record.nonce, "nonce");
    salt = decodeBase64(record.salt, "salt");
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_workspace_key",
      "Protected workspace key contains invalid encoded data.",
      { cause: error }
    );
  }
  if (
    ciphertext.byteLength !== WRAPPED_KEY_LENGTH_BYTES ||
    nonce.byteLength !== AES_GCM_NONCE_LENGTH_BYTES ||
    salt.byteLength !== SALT_LENGTH_BYTES
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_protected_workspace_key",
      "Protected workspace key contains data with an invalid length."
    );
  }
  return { ciphertext, nonce, salt };
}

export async function protectWorkspaceKey(
  workspaceKey: CryptoKey,
  passphrase: string,
  context: WorkspaceKeyProtectionContext
): Promise<ProtectedWorkspaceKey> {
  assertWorkspaceKey(workspaceKey);
  assertPassphrase(passphrase);
  assertContext(context);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LENGTH_BYTES));
  try {
    const wrappingKey = await deriveWrappingKey(passphrase, salt);
    const ciphertext = await crypto.subtle.wrapKey(
      "raw",
      workspaceKey,
      wrappingKey,
      {
        additionalData: authenticatedContext(context),
        iv: nonce,
        name: NOTE_ENCRYPTION_ALGORITHM,
        tagLength: AES_GCM_TAG_LENGTH_BITS
      }
    );
    return {
      algorithm: NOTE_ENCRYPTION_ALGORITHM,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      iterations: KDF_ITERATIONS,
      kdf: KDF_ALGORITHM,
      kdfHash: KDF_HASH,
      nonce: encodeBase64(nonce),
      salt: encodeBase64(salt),
      version: PROTECTION_VERSION,
      workspaceKeyAlgorithm: NOTE_ENCRYPTION_ALGORITHM,
      workspaceKeyLength: AES_KEY_LENGTH_BITS
    };
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError(
      "workspace_key_protection_failed",
      "Workspace key protection failed.",
      { cause: error }
    );
  }
}

export async function unlockWorkspaceKey(
  protectedKey: unknown,
  passphrase: string,
  context: WorkspaceKeyProtectionContext
): Promise<CryptoKey> {
  assertPassphrase(passphrase);
  assertContext(context);
  const { ciphertext, nonce, salt } = validateProtectedKey(protectedKey);
  try {
    const wrappingKey = await deriveWrappingKey(passphrase, salt);
    return await crypto.subtle.unwrapKey(
      "raw",
      ciphertext,
      wrappingKey,
      {
        additionalData: authenticatedContext(context),
        iv: nonce,
        name: NOTE_ENCRYPTION_ALGORITHM,
        tagLength: AES_GCM_TAG_LENGTH_BITS
      },
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM },
      true,
      ["decrypt", "encrypt"]
    );
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "workspace_key_unlock_failed",
      "Workspace key unlock failed because the password or protected key is invalid.",
      { cause: error }
    );
  }
}
