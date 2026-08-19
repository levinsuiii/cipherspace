# Threat Model

CipherSpace v1 aims to protect note content from routine server-side plaintext access while staying honest about metadata, account, device, and collaboration limitations. It should not be described as perfect or enterprise-grade end-to-end encryption.

## Current Implementation Boundary

The backend foundation provides PostgreSQL columns intended for encrypted note envelopes and key-wrapping metadata, but it does not yet accept or process note data. Authentication, authorization, encryption, key generation, key sharing, and sync behavior remain unimplemented. The security goals below describe the intended product, not guarantees provided by the current health-only API.

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

Recommended v1 model:

- Generate a random workspace content key when a workspace is created.
- Encrypt note content with AES-GCM using Web Crypto API.
- Use a fresh random nonce for every encryption operation.
- Store ciphertext, nonce, algorithm identifier, and key identifier in an encrypted envelope.
- Give each user or device a key-wrapping public key using reviewed Web Crypto algorithms.
- Wrap the workspace key separately for each member using that member's wrapping key.
- Store each member's wrapped workspace key in `workspace_members`.
- Unwrap workspace keys only on authorized clients after sign-in or unlock.

Password handling:

- Store only Argon2id password hashes on the backend.
- Do not store plaintext passwords or password-equivalent secrets.
- If password-derived wrapping is used for private keys, use a reviewed password-based KDF with strong parameters and document recovery limitations.

Key sharing:

- v1 may use a pragmatic workspace-key sharing model.
- A user who can unwrap the workspace key can decrypt notes in that workspace.
- Removing a member in v1 does not automatically make previously synced encrypted content unreadable to that member.
- Strong revocation requires future key rotation and re-encryption.

## Multi-User Workspace Sharing Model

Flow:

1. Workspace owner creates a workspace and a random workspace key.
2. Owner invites a user by email.
3. Invited user accepts the invitation after authentication and publishes or confirms a wrapping public key.
4. Owner or an authorized client wraps the workspace key for the invited member.
5. Backend records membership and stores only the member-specific wrapped workspace key.

Roles for v1:

- Owner: manage workspace, invite members, create and edit notes.
- Member: create and edit notes.

Deferred roles:

- Viewer.
- Comment-only.
- Admin separate from owner.

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
- Residual risk: metadata remains visible.

Network interception:

- Mitigate with HTTPS in deployed environments.
- Residual risk: local development may use HTTP.

Malicious or compromised server:

- v1 protects stored content from passive database access, but a malicious server could serve modified client code or malicious sync responses.
- Mitigate partially with authenticated encryption and client-side validation.
- Full protection against malicious client-code delivery is out of scope for v1.

Compromised user device:

- Out of scope for strong protection once the user unlocks content.
- Mitigate by minimizing persistent plaintext and avoiding sensitive logs.

Lost password:

- If keys are password-protected and no recovery design exists, encrypted content may be unrecoverable.
- Any password reset flow must not silently grant access to existing encrypted content unless a documented recovery-key design exists.

Member removal:

- v1 cannot revoke content already downloaded by a member.
- Future key rotation can reduce access to new content only after rotation.

Conflict overwrite:

- Mitigate with version-based conflict detection and explicit manual resolution.

## Security Limitations

- v1 is not enterprise-grade E2EE.
- v1 does not hide metadata listed above.
- v1 does not provide cryptographic deletion from removed members.
- v1 does not provide real-time collaborative editing integrity guarantees.
- v1 does not protect against malicious browser extensions, compromised devices, or a malicious deployed frontend bundle.
- v1 does not provide searchable encrypted note bodies on the server.
- v1 does not include formal cryptographic review.

## Documentation Requirements For Future Changes

Update this file whenever future work changes:

- Authentication.
- Authorization.
- Encryption algorithms or envelope formats.
- Key wrapping or recovery behavior.
- Workspace sharing or revocation.
- Local storage of plaintext or key material.
- Sync payload validation or conflict handling.
