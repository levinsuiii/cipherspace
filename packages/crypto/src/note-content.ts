import {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_GCM_TAG_LENGTH_BYTES,
  LEGACY_CONTENT_ENVELOPE_VERSION,
  MAX_NOTE_CIPHERTEXT_BYTES,
  NOTE_ENCRYPTION_ALGORITHM,
  NOTE_ENVELOPE_VERSION,
  WORKSPACE_KEY_VERSION
} from "./constants.js";
import { noteAdditionalData } from "./content-aad.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import type { EncryptedNotePayload, NoteEncryptionContext } from "./types.js";
import { assertWorkspaceKey } from "./workspace-key.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const PAYLOAD_KEYS = ["algorithm", "ciphertext", "envelopeVersion", "keyVersion", "nonce"];

export function generateNonce(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LENGTH_BYTES));
}

function assertPayloadObject(payload: unknown): asserts payload is Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new CipherSpaceCryptoError("invalid_payload", "Encrypted note payload must be an object.");
  }

  const keys = Object.keys(payload).sort();
  if (keys.length !== PAYLOAD_KEYS.length || keys.some((key, index) => key !== PAYLOAD_KEYS[index])) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      "Encrypted note payload contains missing or unsupported fields."
    );
  }
}

function validatePayload(payload: unknown): {
  ciphertext: Uint8Array<ArrayBuffer>;
  envelopeVersion: typeof LEGACY_CONTENT_ENVELOPE_VERSION | typeof NOTE_ENVELOPE_VERSION;
  nonce: Uint8Array<ArrayBuffer>;
} {
  assertPayloadObject(payload);

  if (payload.algorithm !== NOTE_ENCRYPTION_ALGORITHM) {
    throw new CipherSpaceCryptoError("invalid_payload", "Unsupported note encryption algorithm.");
  }
  if (
    payload.envelopeVersion !== LEGACY_CONTENT_ENVELOPE_VERSION &&
    payload.envelopeVersion !== NOTE_ENVELOPE_VERSION
  ) {
    throw new CipherSpaceCryptoError("invalid_payload", "Unsupported note envelope version.");
  }
  if (payload.keyVersion !== WORKSPACE_KEY_VERSION) {
    throw new CipherSpaceCryptoError("invalid_payload", "Unsupported workspace key version.");
  }

  const nonce = decodeBase64(payload.nonce, "nonce");
  if (nonce.byteLength !== AES_GCM_NONCE_LENGTH_BYTES) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      `AES-GCM nonce must contain exactly ${AES_GCM_NONCE_LENGTH_BYTES} bytes.`
    );
  }

  const ciphertext = decodeBase64(payload.ciphertext, "ciphertext");
  if (
    ciphertext.byteLength < AES_GCM_TAG_LENGTH_BYTES ||
    ciphertext.byteLength > MAX_NOTE_CIPHERTEXT_BYTES
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      `Ciphertext must contain between ${AES_GCM_TAG_LENGTH_BYTES} and ${MAX_NOTE_CIPHERTEXT_BYTES} bytes.`
    );
  }

  return { ciphertext, envelopeVersion: payload.envelopeVersion, nonce };
}

export async function encryptNoteContent(
  plaintext: string,
  key: CryptoKey,
  context: NoteEncryptionContext
): Promise<EncryptedNotePayload> {
  if (typeof plaintext !== "string") {
    throw new TypeError("plaintext must be a string.");
  }
  assertWorkspaceKey(key, "encrypt");
  const additionalData = noteAdditionalData(NOTE_ENVELOPE_VERSION, context);

  const encodedPlaintext = textEncoder.encode(plaintext);
  if (encodedPlaintext.byteLength + AES_GCM_TAG_LENGTH_BYTES > MAX_NOTE_CIPHERTEXT_BYTES) {
    encodedPlaintext.fill(0);
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      `Encrypted note content cannot exceed ${MAX_NOTE_CIPHERTEXT_BYTES} bytes.`
    );
  }

  const nonce = generateNonce();
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: NOTE_ENCRYPTION_ALGORITHM,
        iv: nonce,
        additionalData,
        tagLength: AES_GCM_TAG_LENGTH_BITS
      },
      key,
      encodedPlaintext
    );

    return {
      algorithm: NOTE_ENCRYPTION_ALGORITHM,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      envelopeVersion: NOTE_ENVELOPE_VERSION,
      keyVersion: WORKSPACE_KEY_VERSION,
      nonce: encodeBase64(nonce)
    };
  } catch (error) {
    throw new CipherSpaceCryptoError("encryption_failed", "Note encryption failed.", {
      cause: error
    });
  } finally {
    encodedPlaintext.fill(0);
  }
}

export async function decryptNoteContent(
  payload: unknown,
  key: CryptoKey,
  context?: NoteEncryptionContext
): Promise<string> {
  assertWorkspaceKey(key, "decrypt");
  const { ciphertext, envelopeVersion, nonce } = validatePayload(payload);
  const additionalData = noteAdditionalData(envelopeVersion, context);

  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: NOTE_ENCRYPTION_ALGORITHM,
        iv: nonce,
        additionalData,
        tagLength: AES_GCM_TAG_LENGTH_BITS
      },
      key,
      ciphertext
    );
    const plaintextBytes = new Uint8Array(plaintextBuffer);
    try {
      return textDecoder.decode(plaintextBytes);
    } finally {
      plaintextBytes.fill(0);
    }
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "decryption_failed",
      "Note decryption failed because the key or encrypted payload is invalid.",
      { cause: error }
    );
  }
}
