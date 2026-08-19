import { AES_KEY_LENGTH_BITS, NOTE_ENCRYPTION_ALGORITHM } from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";

const WORKSPACE_KEY_LENGTH_BYTES = AES_KEY_LENGTH_BITS / 8;

function isAesWorkspaceKey(key: unknown): key is CryptoKey {
  if (
    typeof key !== "object" ||
    key === null ||
    !("algorithm" in key) ||
    !("type" in key) ||
    !("usages" in key)
  ) {
    return false;
  }

  const candidate = key as CryptoKey;
  const algorithm = candidate.algorithm as KeyAlgorithm & { length?: number };
  return (
    candidate.type === "secret" &&
    Array.isArray(candidate.usages) &&
    algorithm.name === NOTE_ENCRYPTION_ALGORITHM &&
    algorithm.length === AES_KEY_LENGTH_BITS
  );
}

export function assertWorkspaceKey(
  key: unknown,
  requiredUsage?: "decrypt" | "encrypt"
): asserts key is CryptoKey {
  if (!isAesWorkspaceKey(key) || (requiredUsage !== undefined && !key.usages.includes(requiredUsage))) {
    throw new CipherSpaceCryptoError(
      "invalid_key",
      `Workspace key must be an AES-256-GCM key${requiredUsage ? ` usable for ${requiredUsage}` : ""}.`
    );
  }
}

/** Generates an extractable AES-256-GCM key for one workspace. */
export async function generateWorkspaceKey(): Promise<CryptoKey> {
  try {
    return await crypto.subtle.generateKey(
      { name: NOTE_ENCRYPTION_ALGORITHM, length: AES_KEY_LENGTH_BITS },
      true,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "key_generation_failed",
      "Workspace key generation failed.",
      { cause: error }
    );
  }
}

/** Exports raw workspace key bytes as base64 for a future wrapping flow. */
export async function exportWorkspaceKey(key: CryptoKey): Promise<string> {
  assertWorkspaceKey(key);
  if (!key.extractable) {
    throw new CipherSpaceCryptoError("key_export_failed", "Workspace key is not extractable.");
  }

  try {
    const exported = await crypto.subtle.exportKey("raw", key);
    const keyBytes = new Uint8Array(exported);
    try {
      return encodeBase64(keyBytes);
    } finally {
      keyBytes.fill(0);
    }
  } catch (error) {
    throw new CipherSpaceCryptoError("key_export_failed", "Workspace key export failed.", {
      cause: error
    });
  }
}

/** Imports a base64-encoded, 32-byte AES workspace key. */
export async function importWorkspaceKey(exportedKey: unknown): Promise<CryptoKey> {
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = decodeBase64(exportedKey, "exportedKey");
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "invalid_exported_key",
      "Exported workspace key must be canonical base64 containing exactly 32 bytes.",
      { cause: error }
    );
  }

  if (keyBytes.byteLength !== WORKSPACE_KEY_LENGTH_BYTES) {
    throw new CipherSpaceCryptoError(
      "invalid_exported_key",
      "Exported workspace key must be canonical base64 containing exactly 32 bytes."
    );
  }

  try {
    return await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: NOTE_ENCRYPTION_ALGORITHM, length: AES_KEY_LENGTH_BITS },
      true,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    throw new CipherSpaceCryptoError("key_import_failed", "Workspace key import failed.", {
      cause: error
    });
  } finally {
    keyBytes.fill(0);
  }
}
