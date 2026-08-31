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
const noteContext = {
  workspaceId,
  noteId,
  localRevision: 1
};
const payload = await encryptNoteContent("local plaintext", workspaceKey, noteContext);
const plaintext = await decryptNoteContent(payload, workspaceKey, noteContext);
const commentContext = {
  workspaceId,
  noteId,
  commentId,
  authorId,
  parentCommentId: null
};
const commentPayload = await encryptCommentContent(
  "review context",
  workspaceKey,
  commentContext
);
const comment = await decryptCommentContent(commentPayload, workspaceKey, commentContext);
```

`generateWorkspaceKey()` creates an extractable 256-bit AES-GCM `CryptoKey` with `encrypt` and `decrypt` usages. `exportWorkspaceKey()` and `importWorkspaceKey()` serialize only the raw key material as canonical base64. Exported key material is sensitive and must be wrapped before it is persisted or sent anywhere. `createUserCryptoIdentity()`, `wrapWorkspaceKeyForRecipient()`, and `unwrapWorkspaceKeyShare()` implement the v1 RSA-OAEP-3072/SHA-256 sharing flow.

## Content envelopes

`encryptNoteContent()` returns this JSON-safe structure:

```ts
interface EncryptedNotePayload {
  algorithm: "AES-GCM";
  ciphertext: string; // base64 ciphertext followed by the 128-bit GCM tag
  envelopeVersion: 1 | 2;
  keyVersion: 1;
  nonce: string; // base64 96-bit nonce
}
```

Comment envelopes have the same serializable field shape. New encryption always emits version 2;
version 1 is accepted only for legacy decryption. Each encryption uses a fresh nonce from
`crypto.getRandomValues()`.

Version 2 AAD is deterministic UTF-8 JSON with fixed array positions:

- Note: `["cipherspace.note",2,"AES-GCM",1,workspaceId,noteId,localRevision]`.
- Comment: `["cipherspace.comment",2,"AES-GCM",1,workspaceId,noteId,commentId,authorId,parentCommentId]`, where the final value is either a canonical UUID or `null`.

Identifiers must be canonical lowercase UUIDs and local revisions must be positive safe integers.
Decryption of version 2 requires the identical context, so moving ciphertext to another workspace,
note, revision, comment, author, or parent thread fails AES-GCM authentication. Version 1 retains
its fixed class/format/algorithm/key-version AAD for backward-compatible reads and remains weaker.
Decryption strictly validates the envelope before calling Web Crypto and returns the same safe
error for a wrong key or failed authentication.

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
- Legacy version 1 additional authenticated data does not bind workspace/object/version metadata.
  Keep it readable for compatibility, but do not use it for new encryption.
- The package contains no storage, transport, authorization, sync, or UI behavior.
