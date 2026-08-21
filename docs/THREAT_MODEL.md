# Threat Model

CipherSpace v1 aims to protect note content from routine server-side plaintext access while staying honest about metadata, account, device, and collaboration limitations. It should not be described as perfect or enterprise-grade end-to-end encryption.

## Current Implementation Boundary

The backend now provides email/password account registration, database-backed sessions, workspace membership authorization, encrypted-note/version storage APIs, and encrypted note-scoped comments. The browser frontend uses those APIs through a same-origin local proxy or an explicitly configured production API origin and does not read or persist the HTTP-only session token. Passwords are held only in the sign-in or registration form long enough to submit the request and are not stored by the application. Passwords are hashed with Argon2id on the backend using 19 MiB of memory, two iterations, one lane, and a 32-byte hash. Clients receive random opaque session tokens in host-only, HTTP-only, high-priority cookies; `SameSite` defaults to `Strict`, while the documented separate-domain production topology explicitly uses `None` with `Secure`. PostgreSQL stores only keyed HMAC-SHA-256 token digests. The current session can be invalidated through logout, and expired sessions are rejected. Registration and login share an IP-based rate-limit bucket that defaults to 10 attempts per 60 seconds per API process. Workspace members can read workspace metadata, membership, encrypted notes, encrypted version history, and encrypted comments. Owners and editors can create notes, append versions, and create comments; only owners can soft-delete notes. Editors may delete their own comments, and owners may moderate any comment. The final owner is protected with serialized database transactions.

Note and comment routes validate and store opaque base64 ciphertext, nonces, and encryption metadata without decrypting them. The isolated client crypto package generates AES-256-GCM workspace keys, uses fresh random 96-bit nonces, encrypts and decrypts note and comment content with 128-bit authentication tags, and validates versioned envelopes. Notes and comments use distinct fixed authenticated-data contexts so an envelope from one content class cannot be decrypted as the other. Wrong keys, tampered ciphertext, malformed payloads, and cross-context swaps fail without returning plaintext.

Comments use direct authenticated API calls and are not queued in IndexedDB or included in note sync. A draft exists only in React state until submission. Soft-deleting a comment clears its ciphertext, nonce, and encryption metadata in PostgreSQL while retaining authorship, parent linkage, and timestamps for a safe discussion placeholder. Previously downloaded ciphertext or plaintext cannot be revoked from a member or compromised device.

The local note mutation boundary uses these primitives: when the key provider supplies an unlocked workspace `CryptoKey`, it serializes the title/body snapshot, encrypts it through `@cipherspace/crypto`, and atomically persists the same envelope in the local note and pending operation. The sync engine constructs requests only from durable encrypted envelopes and never receives or uploads a plaintext draft. The React UI can invoke sync manually while unlocked.

The local-only v1 key flow generates one random workspace key, protects it under a separate local unlock password, and persists only the protected key envelope in user-scoped IndexedDB. PBKDF2-HMAC-SHA-256 uses a random 128-bit salt and 600,000 iterations to derive an AES-256-GCM wrapping key; wrapping uses a fresh 96-bit nonce and binds the format, user ID, and workspace ID as authenticated additional data. The password and raw/unwrapped key are not persisted or sent to the backend, and the unwrapped `CryptoKey` exists only in browser memory while unlocked. Local note, pending-change, conflict, and resolved-conflict content uses the existing authenticated note envelope in IndexedDB. Member/device key sharing, recovery, rotation, revocation, and lock timeout remain unimplemented. The API also cannot prove that a client used the named algorithm correctly or supplied genuine ciphertext.

The note list, detail editor, conflict view, and comment discussion decrypt stored envelopes only while the workspace is unlocked. Resulting title/body/comment values remain in React memory while displayed. Locking immediately renders placeholders/empty editor values, clears new-note/comment/merge drafts and decrypted component state, and removes the unwrapped key; saving encrypts before persistence. JavaScript strings cannot be reliably zeroized, so garbage-collected copies may remain transiently in process memory. This does not protect content from same-origin scripts, browser extensions, screenshots, memory inspection, or device compromise while unlocked.

The HTTP boundary uses an exact-origin credentialed CORS allowlist, strict preflight validation, a 1.5 MB default request-body ceiling, a 4 KiB auth-body ceiling, no-store API responses, and global security headers. The API's CSP permits no content loading because it serves JSON; the Docker Nginx frontend applies a self-only application CSP plus clickjacking, MIME-sniffing, referrer, permissions, and cross-origin isolation-oriented headers. HSTS is emitted by the API in production, while a deployed TLS edge must apply HSTS to frontend responses. CORS controls browser response access and is not an authorization mechanism.

Unexpected API failures return a generic error. Malformed and oversized requests use safe error codes without parser details or echoed input. Request bodies are not logged; cookie, authorization, and response cookie headers are redacted. Unexpected-error logging intentionally records only an error class and request metadata, not exception messages or submitted envelopes.

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
- Comment plaintext.
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
- Comment IDs, note/workspace links, authors, parent links, timestamps, deletion state, and ciphertext sizes.
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
- Send session tokens only through host-only, HTTP-only, high-priority cookies and add `Secure` in production. Default to `SameSite=Strict`; use `SameSite=None` only for the explicit cross-site HTTPS deployment with exact credentialed CORS.
- Reject expired sessions and delete the current session record on logout.
- Never log credentials, raw session tokens, or the session secret.
- Require the session HMAC secret from the environment, require at least 32 UTF-8 bytes, and reject documented weak/development markers in production.

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
- Editor: read workspace metadata, membership, encrypted notes, version history, and comments; create and append note versions; create comments; delete their own comments.
- Viewer: read workspace metadata, membership, encrypted notes, version history, and comments without mutating notes or comments.

Owners can also create comments, delete their own comments, and moderate comments written by other members.

Comment-only and enterprise-style roles are deferred.

Revocation limitation:

- Removing a user prevents future sync access after authorization is updated.
- It does not guarantee that the removed user loses access to content already downloaded or keys already available to their device.

## Server-Visible Metadata

The server will see:

- Account emails.
- Workspace names and membership.
- Note existence, note IDs, timestamps, deleted status, version numbers, and encrypted payload sizes.
- Comment existence, IDs, note/workspace associations, authors, parent relationships, timestamps, deleted status, encrypted payload sizes, and discussion activity.
- Invitation recipients.
- IP-level and timing metadata at the infrastructure layer.

The server should not see:

- Note plaintext.
- Comment plaintext.
- Raw workspace keys.
- Passwords.

## Threats And Mitigations

Unauthorized workspace access:

- Mitigate with server-side membership checks on every workspace, note, version, comment, and sync endpoint.

Database compromise:

- Mitigate by storing note and active comment content only as encrypted envelopes.
- Soft-deleted comment envelopes are cleared, though metadata and any copies already downloaded remain.
- The manual sync client uses authenticated encryption, while the backend treats submitted envelope fields as opaque and cannot verify that clients performed authenticated encryption correctly.
- Residual risk: metadata remains visible.

Network interception:

- Mitigate with HTTPS in deployed environments.
- Residual risk: local development may use HTTP.

Account attacks:

- Mitigate password disclosure with Argon2id hashing, generic login failures, bounded auth bodies, and IP-based registration/login rate limiting.
- Residual risk: email verification, password reset, breached-password checks, multi-factor authentication, administrator session revocation, and distributed/shared rate limiting are not implemented. The in-memory limiter resets on process restart and is not shared across API replicas.

Session and request forgery:

- Mitigate session database disclosure by storing only keyed token digests and using host-only, HTTP-only, production-`Secure` cookies. Same-origin deployments retain `SameSite=Strict`. The separate free-provider topology uses `SameSite=None`, exact credentialed CORS, strict preflights, and JSON mutation bodies as its browser boundary.
- Residual risk: the cross-site mode can be blocked by third-party-cookie controls and has no explicit CSRF token. Normal JSON mutations require a permitted preflight, but logout CSRF remains possible. There is also no session rotation after privilege changes, device/session management, or automatic cleanup job for expired rows. Do not relax CORS, allowed content types, or cookie security to work around browser behavior.

Cross-origin and browser injection:

- Reject wildcard/path/credential CORS configuration and allow credentialed responses only to exact configured origins. Production must set the policy explicitly; an empty list means same-origin only.
- Apply restrictive CSP and related headers to API and Docker frontend responses.
- Residual risk: CORS does not stop non-browser clients and does not replace authentication. CSP reduces common injection impact but cannot make compromised same-origin code or a malicious delivered bundle trustworthy.

Denial of service and oversized input:

- Bound global and auth request bodies, ciphertext sizes, operation counts, cursor size, identifiers, and display strings. Rate-limit the expensive password endpoints before password hashing.
- Residual risk: the API has no global distributed traffic limiter, database resource governor, or upstream DDoS protection. Sync requests may still be computationally and storage expensive within their bounds.

Malicious or compromised server:

- v1 protects stored content from passive database access, but a malicious server could serve modified client code or malicious sync responses.
- Mitigate partially with authenticated encryption and client-side validation.
- Full protection against malicious client-code delivery is out of scope for v1.

Compromised user device:

- Out of scope for strong protection once the user unlocks content.
- Avoid sensitive logs and scope local records by user ID.
- Residual risk: encrypted notes, queue/conflict metadata, ciphertext sizes, and the password-protected key envelope remain in IndexedDB after logout. Browser-profile compromise enables offline guessing of the local unlock password and exposes content if the attacker can unlock it or execute code while the legitimate workspace is unlocked.
- The protected workspace-key envelope permits offline password guessing after browser-profile compromise. The 600,000-iteration PBKDF2 cost slows guesses but cannot compensate for a weak unlock password.

Lost password:

- The v1 protected workspace key has no recovery path. Losing the local unlock password or deleting the browser profile can make already-synced ciphertext unrecoverable from this client.
- Any password reset flow must not silently grant access to existing encrypted content unless a documented recovery-key design exists.

Member removal:

- v1 cannot revoke content already downloaded by a member.
- Future key rotation can reduce access to new content only after rotation.

Conflict overwrite:

- Mitigate with server-side base-version comparison under a note lock, client-side pull checks, durable local/base/remote snapshots, and explicit manual resolution.
- Keep-local, accept-remote, and manual-merge choices create a new operation based on the selected remote version; none bypass the normal server stale-base check.
- Residual risk: resolution is device-local, delete conflicts do not yet have a dedicated resolution flow, and there is no automatic semantic merge. Resolved ciphertext and resolution metadata remain on the device.

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
- Comment envelope version 1 distinguishes comments from notes but does not bind ciphertext to a workspace ID, note ID, comment ID, parent ID, or author. A valid comment envelope can be replayed or swapped between comments using the same workspace key.
- Local note content is encrypted at rest with the workspace key, but note/workspace IDs, timestamps, revisions, statuses, ciphertext sizes, and other operational metadata are not hidden. This is browser-profile encryption, not hardware-backed storage or protection against code running in the unlocked origin.
- The cached offline user profile can reopen device-local data during an outage even when the server cannot verify the current session. Server requests still require the HTTP-only cookie and backend authorization.
- The auth limiter is per API process and in memory. Restarts clear it, multiple replicas do not share counters, and deployments must configure trusted proxy handling correctly before relying on forwarded client IPs.
- Exact-origin CORS and security headers reduce browser attack surface but do not authorize requests or protect against non-browser clients, compromised same-origin scripts, or malicious frontend delivery.
- The separate free-provider deployment requires `SameSite=None`; browser third-party-cookie controls may block login persistence, and logout CSRF remains possible without an explicit CSRF token. Same-origin deployments retain the stricter default.
- Production secret validation rejects documented placeholder markers but cannot measure true entropy or prevent an operator from supplying another predictable 32-byte value.
- The API container is hardened for the local Compose topology, but PostgreSQL and Nginx remain ordinary containers rather than a complete production sandbox. Loopback port binding is a local default, not a network firewall policy for production orchestration.
- Sync operation IDs, client IDs, base versions, request timing, ciphertext sizes, and workspace sequence positions are server-visible metadata.
- Comment drafts are not durable offline, and comments have no retry queue, version history, conflict detection, or sync protocol. A failed request requires the user to retry while the in-memory draft remains mounted.
- The client stores encrypted local and remote snapshots, encrypted pending and resolved payloads, retry errors, cursors, unresolved/resolved conflict metadata, and a password-protected workspace-key envelope in the browser profile. It does not persist note plaintext, the raw workspace key, or the unlock password during normal version 5 operation.
- Existing version 1–4 browser databases may contain legacy plaintext until that workspace is successfully unlocked. Version 5 performs a key-dependent lazy migration after unlock, encrypts matching note/queue/conflict records, and clears their plaintext fields. Losing the original key/password before this migration prevents safe automatic conversion; a Dexie schema upgrade alone cannot encrypt because it has no workspace key.

## Documentation Requirements For Future Changes

Update this file whenever future work changes:

- Authentication.
- Authorization.
- Encryption algorithms or envelope formats.
- Key wrapping or recovery behavior.
- Workspace sharing or revocation.
- Local storage of plaintext or key material.
- Sync payload validation or conflict handling.
