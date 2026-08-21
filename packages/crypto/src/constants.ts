export const NOTE_ENCRYPTION_ALGORITHM = "AES-GCM" as const;
export const NOTE_ENVELOPE_VERSION = 1 as const;
export const WORKSPACE_KEY_VERSION = 1 as const;
export const USER_IDENTITY_ALGORITHM = "RSA-OAEP-3072-SHA256" as const;
export const USER_IDENTITY_KEY_VERSION = 1 as const;

export const AES_KEY_LENGTH_BITS = 256;
export const AES_GCM_NONCE_LENGTH_BYTES = 12;
export const AES_GCM_TAG_LENGTH_BITS = 128;
export const AES_GCM_TAG_LENGTH_BYTES = AES_GCM_TAG_LENGTH_BITS / 8;

// Matches the current encrypted note API's decoded ciphertext limit.
export const MAX_NOTE_CIPHERTEXT_BYTES = 1024 * 1024;
export const MAX_COMMENT_CIPHERTEXT_BYTES = 64 * 1024;
