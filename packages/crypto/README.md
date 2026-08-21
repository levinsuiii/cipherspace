# `@cipherspace/crypto`

Browser-compatible client-side cryptography for CipherSpace note/comment content, local key protection, user identities, and recipient-specific workspace-key sharing. The package uses the platform Web Crypto API and has no runtime dependencies.

## API

```ts
import {
  decryptCommentContent,
  decryptNoteContent,
  encryptCommentContent,
  encryptNoteContent,
  exportWorkspaceKey,
  generateWorkspaceKey,
  importWorkspaceKey
} from "@cipherspace/crypto";

const workspaceKey = await generateWorkspaceKey();
const payload = await encryptNoteContent("local plaintext", workspaceKey);
const plaintext = await decryptNoteContent(payload, workspaceKey);
const commentPayload = await encryptCommentContent("review context", workspaceKey);
const comment = await decryptCommentContent(commentPayload, workspaceKey);
```

`generateWorkspaceKey()` creates an extractable 256-bit AES-GCM `CryptoKey` with `encrypt` and `decrypt` usages. `exportWorkspaceKey()` and `importWorkspaceKey()` serialize only the raw key material as canonical base64. Exported key material is sensitive and must be wrapped before it is persisted or sent anywhere. `createUserCryptoIdentity()`, `wrapWorkspaceKeyForRecipient()`, and `unwrapWorkspaceKeyShare()` implement the v1 RSA-OAEP-3072/SHA-256 sharing flow.

## Content envelopes

`encryptNoteContent()` returns this JSON-safe structure:

```ts
interface EncryptedNotePayload {
  algorithm: "AES-GCM";
  ciphertext: string; // base64 ciphertext followed by the 128-bit GCM tag
  envelopeVersion: 1;
  keyVersion: 1;
  nonce: string; // base64 96-bit nonce
}
```

Comment envelopes have the same serializable field shape. Each encryption uses a fresh nonce from `crypto.getRandomValues()`. AES-GCM authenticates fixed envelope metadata as additional authenticated data; notes and comments use distinct contexts, so one content class cannot be decrypted as the other. Decryption strictly validates the envelope before calling Web Crypto and returns the same safe error for a wrong key or failed authentication.

The frontend maps `ciphertext` to `encryptedContent`, `nonce` to `contentNonce`, and the versioned metadata to the note and comment API's `encryptionMetadata` object. The backend never calls this package and treats the resulting values as opaque.

The package enforces the current note API's 1 MiB decoded-ciphertext limit and the comment API's 64 KiB limit. Both limits include the 16-byte GCM tag.

## Commands

From the repository root:

```powershell
npm run test --workspace @cipherspace/crypto
npm run typecheck --workspace @cipherspace/crypto
npm run build --workspace @cipherspace/crypto
```

## Current limits

- Unwrapped workspace keys remain in caller-managed memory. The package can protect a raw workspace key with PBKDF2-HMAC-SHA-256 and AES-256-GCM, but persistence remains the caller's responsibility.
- Raw key export supports tested wrapping integration. Never store or transmit its result unwrapped.
- Recipient-specific member key wrapping is implemented. Recovery, identity/device transfer, rotation, revocation, sender signatures, key transparency, and cryptographic deletion are not.
- The workspace unlock passphrase is separate from the account password. The account password protects the local identity private-key envelope; recovery and KDF parameter migration are not implemented.
- Version 1 additional authenticated data binds the content class, envelope format, algorithm, and key version, but not a workspace ID, note ID, comment ID, author, parent, or server version. A later integration must design contextual binding if it needs to reject replay or ciphertext swapping within the same content class and workspace key.
- The package contains no storage, transport, authorization, sync, or UI behavior.
