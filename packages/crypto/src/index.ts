export {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_KEY_LENGTH_BITS,
  MAX_COMMENT_CIPHERTEXT_BYTES,
  MAX_NOTE_CIPHERTEXT_BYTES,
  NOTE_ENCRYPTION_ALGORITHM,
  NOTE_ENVELOPE_VERSION,
  USER_IDENTITY_ALGORITHM,
  USER_IDENTITY_KEY_VERSION,
  WORKSPACE_KEY_VERSION
} from "./constants.js";
export { CipherSpaceCryptoError } from "./errors.js";
export { decryptCommentContent, encryptCommentContent } from "./comment-content.js";
export { decryptNoteContent, encryptNoteContent, generateNonce } from "./note-content.js";
export type { CryptoErrorCode, EncryptedCommentPayload, EncryptedNotePayload } from "./types.js";
export { exportWorkspaceKey, generateWorkspaceKey, importWorkspaceKey } from "./workspace-key.js";
export {
  createUserCryptoIdentity,
  unlockUserCryptoIdentity,
  unwrapWorkspaceKeyShare,
  wrapWorkspaceKeyForRecipient
} from "./user-identity.js";
export type {
  EncryptedWorkspaceKeyShare,
  LocalUserCryptoIdentity,
  ProtectedUserPrivateKey,
  ProtectedWorkspaceKey,
  PublicUserCryptoIdentity,
  UserIdentityProtectionContext,
  WorkspaceKeyProtectionContext,
  WorkspaceKeyShareContext
} from "./types.js";
export { protectWorkspaceKey, unlockWorkspaceKey } from "./workspace-key-protection.js";
