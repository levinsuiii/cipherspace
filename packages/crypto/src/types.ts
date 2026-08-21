import {
  NOTE_ENCRYPTION_ALGORITHM,
  NOTE_ENVELOPE_VERSION,
  USER_IDENTITY_ALGORITHM,
  USER_IDENTITY_KEY_VERSION,
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

/** A serializable, authenticated comment-content envelope. */
export interface EncryptedCommentPayload {
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
  | "invalid_protected_identity_key"
  | "invalid_public_identity_key"
  | "invalid_unlock_passphrase"
  | "invalid_payload"
  | "key_export_failed"
  | "key_generation_failed"
  | "key_import_failed"
  | "identity_key_generation_failed"
  | "identity_key_protection_failed"
  | "identity_key_unlock_failed"
  | "workspace_key_share_failed"
  | "workspace_key_share_unlock_failed"
  | "workspace_key_protection_failed"
  | "workspace_key_unlock_failed";

export interface WorkspaceKeyProtectionContext {
  userId: string;
  workspaceId: string;
}

export interface UserIdentityProtectionContext {
  userId: string;
}

export interface PublicUserCryptoIdentity {
  algorithm: typeof USER_IDENTITY_ALGORITHM;
  keyVersion: typeof USER_IDENTITY_KEY_VERSION;
  publicKey: string;
}

export interface ProtectedUserPrivateKey {
  algorithm: "AES-GCM";
  ciphertext: string;
  identityAlgorithm: typeof USER_IDENTITY_ALGORITHM;
  identityKeyVersion: typeof USER_IDENTITY_KEY_VERSION;
  iterations: 600000;
  kdf: "PBKDF2";
  kdfHash: "SHA-256";
  nonce: string;
  salt: string;
  version: 1;
}

export interface LocalUserCryptoIdentity extends PublicUserCryptoIdentity {
  protectedPrivateKey: ProtectedUserPrivateKey;
}

export interface WorkspaceKeyShareContext {
  recipientKeyVersion: number;
  recipientUserId: string;
  workspaceId: string;
}

export interface EncryptedWorkspaceKeyShare {
  algorithm: typeof USER_IDENTITY_ALGORITHM;
  ciphertext: string;
  recipientKeyVersion: number;
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
