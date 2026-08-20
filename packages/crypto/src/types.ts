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
  | "invalid_protected_workspace_key"
  | "invalid_exported_key"
  | "invalid_key"
  | "invalid_unlock_passphrase"
  | "invalid_payload"
  | "key_export_failed"
  | "key_generation_failed"
  | "key_import_failed"
  | "workspace_key_protection_failed"
  | "workspace_key_unlock_failed";

export interface WorkspaceKeyProtectionContext {
  userId: string;
  workspaceId: string;
}

/** A password-protected workspace key safe to persist as ciphertext. */
export interface ProtectedWorkspaceKey {
  algorithm: "AES-GCM";
  ciphertext: string;
  iterations: 600000;
  kdf: "PBKDF2";
  kdfHash: "SHA-256";
  nonce: string;
  salt: string;
  version: 1;
  workspaceKeyAlgorithm: "AES-GCM";
  workspaceKeyLength: 256;
}
