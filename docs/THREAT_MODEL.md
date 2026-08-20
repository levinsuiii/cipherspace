# Threat Model

CipherSpace v1 aims to protect note content from routine server-side plaintext access while staying honest about metadata, account, device, and collaboration limitations. It should not be described as perfect or enterprise-grade end-to-end encryption.

## Current Implementation Boundary

The backend now provides email/password account registration, database-backed sessions, workspace membership authorization, and encrypted-note/version storage APIs. The browser frontend uses those APIs through a same-origin proxy and does not read or persist the HTTP-only session token. Passwords are held only in the sign-in or registration form long enough to submit the request and are not stored by the application. Passwords are hashed with Argon2id on the backend. Clients receive random opaque session tokens in HTTP-only, `SameSite=Lax` cookies, with the `Secure` attribute in production; PostgreSQL stores only keyed HMAC-SHA-256 token digests. The current session can be invalidated through logout, and expired sessions are rejected. Workspace members can read workspace metadata, membership, encrypted notes, and encrypted version history. Owners and editors can create notes and append versions, while only owners can soft-delete notes. The final owner is protected with serialized database transactions.

Note routes validate and store opaque base64 ciphertext, nonces, and encryption metadata without decrypting them. The isolated client crypto package now generates AES-256-GCM workspace keys, uses fresh random 96-bit nonces, encrypts and decrypts note content with 128-bit authentication tags, and validates versioned envelopes. Fixed envelope metadata is authenticated as additional data. Wrong keys, tampered ciphertext, and malformed payloads fail without returning plaintext.

The sync engine is connected to these primitives: when the local key provider supplies an unlocked workspace `CryptoKey`, it serializes the local title/body snapshot, encrypts it through `@cipherspace/crypto`, persists the encrypted prepared operation, and only then constructs a push request. It never falls back to uploading the plaintext draft. The React UI can invoke this engine manually while unlocked.

The local-only v1 key flow generates one random workspace key, protects it under a separate local unlock password, and persists only the protected envelope in user-scoped IndexedDB. PBKDF2-HMAC-SHA-256 uses a random 128-bit salt and 600,000 iterations to derive an AES-256-GCM wrapping key; wrapping uses a fresh 96-bit nonce and binds the format, user ID, and workspace ID as authenticated additional data. The password and raw/unwrapped key are not persisted or sent to the backend, and the unwrapped `CryptoKey` exists only in browser memory while unlocked. The local-first editor still stores user-scoped plaintext title/body drafts in IndexedDB. Member/device key sharing, recovery, rotation, revocation, lock timeout, and encrypted local drafts remain unimplemented. The API also cannot prove that a client used the named algorithm correctly or supplied genuine ciphertext.

The browser stores the last successfully verified user profile in local storage so the matching IndexedDB scope can be reopened when session verification fails because the network is unavailable. It does not store the HTTP-only session token. An explicit 401 response or successful logout clears this profile cache. This offline identity is a local routing/data-selection convenience, not proof of current server authorization.

## Security Goals

- Encrypt note content on the client before upload.
- Keep plaintext note bodies out of backend logs, database rows, and server-side processing.
- Prevent users from accessing workspaces and notes unless authorized.
- Preserve integrity of encrypted note versions through authenticated encryption.
- Make sync conflict handling explicit rather than silently overwriting data.
- Use reviewed platform crypto APIs instead of custom primitives.

## Trusted Components

Trusted in v1:

- The user's browser runtime while the app is open.
- The user's authenticated session on their own device.
- The client application code delivered to the browser.
- Backend authorization logic.
- PostgreSQL for durable storage of encrypted envelopes and metadata.

Partially trusted:

- The backend server for identity, authorization, ordering, and sync metadata.
- Workspace owners for inviting the correct people.
- User devices that hold decrypted content or unlocked keys.

Not trusted with plaintext note content:

- The database.
- Routine backend request handlers.
- Server logs and analytics.

## Assets

Sensitive assets:

- Note plaintext.
- Future comment plaintext.
- Workspace encryption keys.
- Per-note or per-version content encryption keys, if introduced.
- Passwords and password-derived key material.
- Session tokens.
- Invitation tokens.

Metadata assets with limited confidentiality in v1:

- User emails.
- Workspace names.
- Membership graph.
- Note IDs.
- Note timestamps.
- Version counts.
- Ciphertext sizes.
- Sync timing and device identifiers.

## Encryption Model

Implemented primitive model:

- Generate a random, extractable 256-bit AES-GCM workspace content key with Web Crypto.
- Encrypt UTF-8 note content with AES-GCM and a 128-bit authentication tag.
- Use a fresh random 96-bit nonce from `crypto.getRandomValues()` for every encryption operation.
- Store canonical-base64 ciphertext and nonce with algorithm, envelope version, and workspace key version.
- Authenticate fixed envelope metadata as AES-GCM additional authenticated data.
- Strictly validate envelope fields, versions, base64 encodings, nonce length, and ciphertext size before decryption.

Implemented local-only bootstrap around those primitives:

- Create a random workspace key on first unlock setup and map encrypted pending envelopes to sync requests.
- Protect it locally with an independent 12-to-128-character unlock password using PBKDF2-HMAC-SHA-256 and AES-256-GCM.
- Store only salt, nonce, KDF parameters, authenticated format metadata, and wrapped-key ciphertext in IndexedDB.
- Keep the unwrapped key in memory and require unlock again after reload or explicit lock.

Not yet implemented:

- Give each user or device a key-wrapping public key using reviewed Web Crypto algorithms.
- Wrap the workspace key separately for each member using that member's wrapping key.
- Store each member's wrapped workspace key in `workspace_members`.
- Provision the same workspace key to another authorized browser or member.
- Recover, rotate, revoke, or migrate protected keys.

The package exposes raw workspace-key import and export only as a building block for future wrapping. Raw exported keys provide full decryption capability and must not be stored or transmitted unwrapped.

Password handling:

- Store only Argon2id password hashes on the backend.
- Do not store plaintext passwords or password-equivalent secrets.
- Accept passwords from 12 through 128 characters and normalize account emails to lowercase.
- Return the same login error for unknown emails and incorrect passwords; perform an Argon2 verification in both cases to reduce account-enumeration timing differences.
- Keep the local unlock password separate from the account password. It is never sent to the backend and has no recovery flow.
- Derive only the local wrapping key with PBKDF2-HMAC-SHA-256, a per-envelope random 128-bit salt, and 600,000 iterations; never use the password directly as a workspace content key.

Session handling:

- Generate opaque tokens with platform secure randomness and store only HMAC-SHA-256 token digests keyed by an environment-provided secret.
- Send session tokens only through HTTP-only, `SameSite=Lax` cookies and add `Secure` in production.
- Reject expired sessions and delete the current session record on logout.
- Never log credentials, raw session tokens, or the session secret.

Key sharing:

- v1 may use a pragmatic workspace-key sharing model.
- A user who can unwrap the workspace key can decrypt notes in that workspace.
- Removing a member in v1 does not automatically make previously synced encrypted content unreadable to that member.
- Strong revocation requires future key rotation and re-encryption.

## Multi-User Workspace Sharing Model

Current membership flow:

1. An authenticated user creates a workspace and becomes its first owner.
2. An owner identifies an existing account by email or user ID and assigns a role.
3. The backend immediately records membership. There is no pending invitation, email delivery, or key sharing; locally creating a key does not provision it to the added member.

Roles for v1:

- Owner: read workspace metadata, membership, encrypted notes, and version history; manage members; create, append, and soft-delete notes.
- Editor: read workspace metadata, membership, encrypted notes, and version history; create and append note versions.
- Viewer: read workspace metadata, membership, encrypted notes, and version history without mutating notes.

Comment-only and enterprise-style roles are deferred.

Revocation limitation:

- Removing a user prevents future sync access after authorization is updated.
- It does not guarantee that the removed user loses access to content already downloaded or keys already available to their device.

## Server-Visible Metadata

The server will see:

- Account emails.
- Workspace names and membership.
- Note existence, note IDs, timestamps, deleted status, version numbers, and encrypted payload sizes.
- Invitation recipients.
- IP-level and timing metadata at the infrastructure layer.

The server should not see:

- Note plaintext.
- Future comment plaintext.
- Raw workspace keys.
- Passwords.

## Threats And Mitigations

Unauthorized workspace access:

- Mitigate with server-side membership checks on every workspace, note, version, and sync endpoint.

Database compromise:

- Mitigate by storing note content only as encrypted envelopes.
- The manual sync client uses authenticated encryption, while the backend treats submitted envelope fields as opaque and cannot verify that clients performed authenticated encryption correctly.
- Residual risk: metadata remains visible.

Network interception:

- Mitigate with HTTPS in deployed environments.
- Residual risk: local development may use HTTP.

Account attacks:

- Mitigate password disclosure with Argon2id hashing and generic login failures.
- Residual risk: email verification, password reset, login rate limiting, breached-password checks, multi-factor authentication, and administrator session revocation are not implemented.

Session and request forgery:

- Mitigate session database disclosure by storing only keyed token digests and limit passive cookie access with HTTP-only, `SameSite=Lax`, and production `Secure` attributes.
- Residual risk: there is no explicit CSRF token mechanism, session rotation after privilege changes, device/session management, or automatic cleanup job for expired rows.

Malicious or compromised server:

- v1 protects stored content from passive database access, but a malicious server could serve modified client code or malicious sync responses.
- Mitigate partially with authenticated encryption and client-side validation.
- Full protection against malicious client-code delivery is out of scope for v1.

Compromised user device:

- Out of scope for strong protection once the user unlocks content.
- Avoid sensitive logs and scope local records by user ID.
- Residual risk: local note title/body drafts and pending payloads are currently plaintext in IndexedDB and remain after logout until browser data is cleared. Anyone who can access the browser profile, execute same-origin code, or compromise the device may read them.
- The protected workspace-key envelope permits offline password guessing after browser-profile compromise. The 600,000-iteration PBKDF2 cost slows guesses but cannot compensate for a weak unlock password.

Lost password:

- The v1 protected workspace key has no recovery path. Losing the local unlock password or deleting the browser profile can make already-synced ciphertext unrecoverable from this client.
- Any password reset flow must not silently grant access to existing encrypted content unless a documented recovery-key design exists.

Member removal:

- v1 cannot revoke content already downloaded by a member.
- Future key rotation can reduce access to new content only after rotation.

Conflict overwrite:

- Mitigate with server-side base-version comparison under a note lock, client-side pull checks, and durable conflict snapshots. Manual resolution remains deferred.

## Security Limitations

- v1 is not enterprise-grade E2EE.
- v1 does not hide metadata listed above.
- v1 does not provide cryptographic deletion from removed members.
- v1 does not provide real-time collaborative editing integrity guarantees.
- v1 does not protect against malicious browser extensions, compromised devices, or a malicious deployed frontend bundle.
- v1 does not provide searchable encrypted note bodies on the server.
- v1 does not include formal cryptographic review.
- The implemented package does not prevent nonce reuse by callers that bypass `encryptNoteContent()` and invoke Web Crypto directly with the same workspace key.
- Workspace keys are extractable to enable future wrapping. An XSS payload, malicious browser extension, compromised device, or malicious frontend bundle running in the unlocked client context can access plaintext and key material.
- The protected envelope lives in ordinary IndexedDB rather than hardware-backed storage. There is no lock timeout, member/device key sharing, recovery, key rotation, parameter migration, or cryptographic revocation flow.
- The local unlock password is independent of the account password. Creating a separate key in another browser or for another member does not grant access to ciphertext produced with the original key.
- Version 1 authenticated metadata does not bind ciphertext to a workspace ID, note ID, or server version. A valid envelope can be replayed or swapped between notes that use the same workspace key unless a later integration adds and verifies contextual binding.
- Local drafts are not encrypted at rest. The current local-first slice prioritizes offline durability while key management is undefined; it must not be marketed as encrypted local storage.
- The cached offline user profile can reopen device-local data during an outage even when the server cannot verify the current session. Server requests still require the HTTP-only cookie and backend authorization.
- Sync operation IDs, client IDs, base versions, request timing, ciphertext sizes, and workspace sequence positions are server-visible metadata.
- The client stores local plaintext, encrypted local and remote snapshots, retry errors, cursors, unresolved conflict metadata, and a password-protected workspace-key envelope in the browser profile. It does not persist the raw workspace key or unlock password.

## Documentation Requirements For Future Changes

Update this file whenever future work changes:

- Authentication.
- Authorization.
- Encryption algorithms or envelope formats.
- Key wrapping or recovery behavior.
- Workspace sharing or revocation.
- Local storage of plaintext or key material.
- Sync payload validation or conflict handling.
