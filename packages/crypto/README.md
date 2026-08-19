# `@cipherspace/crypto`

Browser-compatible client-side cryptography for CipherSpace note content. The package uses the platform Web Crypto API and has no runtime dependencies.

## API

```ts
import {
  decryptNoteContent,
  encryptNoteContent,
  exportWorkspaceKey,
  generateWorkspaceKey,
  importWorkspaceKey
} from "@cipherspace/crypto";

const workspaceKey = await generateWorkspaceKey();
const payload = await encryptNoteContent("local plaintext", workspaceKey);
const plaintext = await decryptNoteContent(payload, workspaceKey);
```

`generateWorkspaceKey()` creates an extractable 256-bit AES-GCM `CryptoKey` with `encrypt` and `decrypt` usages. `exportWorkspaceKey()` and `importWorkspaceKey()` serialize only the raw key material as canonical base64. Exported key material is sensitive and must be wrapped before it is persisted or sent anywhere. This package does not provide that wrapping or sharing flow yet.

## Note envelope

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

Each encryption uses a fresh nonce from `crypto.getRandomValues()`. AES-GCM authenticates the fixed envelope metadata as additional authenticated data. Decryption strictly validates the envelope before calling Web Crypto and returns the same safe error for a wrong key or failed authentication.

The current note API uses different field names. A later frontend integration should map `ciphertext` to `encryptedContent`, `nonce` to `contentNonce`, and the versioned metadata to `encryptionMetadata`. This task intentionally does not change the backend contract.

The package enforces the current API's 1 MiB decoded-ciphertext limit. With the 16-byte GCM tag, plaintext may occupy at most 1,048,560 UTF-8 bytes.

## Commands

From the repository root:

```powershell
npm run test --workspace @cipherspace/crypto
npm run typecheck --workspace @cipherspace/crypto
npm run build --workspace @cipherspace/crypto
```

## Current limits

- Workspace keys remain in caller-managed memory; secure persistence is not implemented.
- Raw key export exists only to support future wrapping. Never store or transmit its result unwrapped.
- Member key sharing, key wrapping, recovery, rotation, revocation, and cryptographic deletion are not implemented.
- Passphrase derivation is not implemented because v1 has no agreed password-based unlock or recovery design. Authentication passwords are not reused as encryption keys.
- Version 1 additional authenticated data binds the envelope format, algorithm, and key version, but not a workspace ID, note ID, or server version. A later integration must design contextual binding if it needs to reject replay or ciphertext swapping between notes encrypted with the same workspace key.
- The package encrypts note content only. It is not integrated with the current note form, IndexedDB, or sync.
