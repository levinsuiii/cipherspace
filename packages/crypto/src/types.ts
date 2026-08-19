import {
  NOTE_ENCRYPTION_ALGORITHM,
  NOTE_ENVELOPE_VERSION,
  WORKSPACE_KEY_VERSION
} from "./constants.js";

/** A serializable, authenticated note-content envelope. */
export interface EncryptedNotePayload {
  algorithm: typeof NOTE_ENCRYPTION_ALGORITHM;
  ciphertext: string;
  envelopeVersion: typeof NOTE_ENVELOPE_VERSION;
  keyVersion: typeof WORKSPACE_KEY_VERSION;
  nonce: string;
}

export type CryptoErrorCode =
  | "decryption_failed"
  | "encryption_failed"
  | "invalid_exported_key"
  | "invalid_key"
  | "invalid_payload"
  | "key_export_failed"
  | "key_generation_failed"
  | "key_import_failed";
