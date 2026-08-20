# Architecture

CipherSpace should be built as a local-first encrypted collaboration workspace with clear boundaries between domain logic, local persistence, sync, crypto, transport, and UI.

## Goals

- Keep note content encrypted before it leaves the client.
- Make local edits durable before sync.
- Support multiple users in shared workspaces.
- Detect concurrent edits deterministically.
- Preserve version history.
- Keep v1 simple enough to implement and audit.

## Recommended System Architecture

Recommended high-level components:

- Frontend app: React + TypeScript browser app.
- Local persistence layer: IndexedDB through Dexie.
- Client domain layer: workspace, note, version, conflict, and sync state transitions.
- Client crypto layer: Web Crypto wrappers and encrypted envelope handling.
- API client: typed HTTP client with validation at boundaries.
- Backend API: Fastify + TypeScript.
- Backend persistence: PostgreSQL.
- Shared package: TypeScript domain types, API contracts, and Zod schemas shared by frontend and backend.

The frontend must be able to create and edit notes while offline. The backend is the synchronization authority for workspace membership, version ordering, encrypted note envelopes, and conflict reporting, but it must not require plaintext note content.

## Recommended Repository Layout

Create this layout only when implementation begins:

```text
apps/
  web/
  api/
packages/
  crypto/
  shared/
docs/
```

Suggested ownership:

- `apps/web`: UI, IndexedDB persistence, crypto-package integration, and sync queue.
- `apps/api`: authentication, authorization, sync endpoints, database access.
- `packages/crypto`: isolated Web Crypto wrappers, workspace-key serialization, and encrypted note envelope validation.
- `packages/shared`: IDs, typed data models, Zod schemas, error codes, sync payload contracts.

## Data Model

Core entities:

- User: account identity used for authentication and membership.
- Device: client installation that creates local operations and participates in sync.
- Workspace: collaboration boundary containing notes and members.
- WorkspaceMember: user role and future member-wrapped access material for a workspace.
- Invitation: pending membership offer by email.
- Note: stable identity and server-visible metadata for an encrypted document.
- NoteVersion: immutable encrypted content snapshot or operation record.
- SyncOperation: client-created mutation with idempotency key and base version.
- Conflict: explicit record when an operation cannot be applied cleanly.
- Comment: deferred v1.1 entity tied to notes and note versions.

Stable identifiers should be UUIDs generated client-side where offline creation is required. Server-generated IDs are acceptable for strictly online entities such as sessions.

## Data Visibility

Encrypted on the client before upload:

- Note body.
- Optional note title if UX allows encrypted-title limitations.
- Future comment body.

Visible to the server in v1:

- User email addresses.
- Workspace names unless a later design encrypts them.
- Membership relationships and roles.
- Note IDs, workspace IDs, creator IDs, timestamps, deleted status, version numbers, and ciphertext sizes.
- Invitation email addresses.
- Sync timing and client/device identifiers.

The product must not market v1 as hiding all metadata.

## Backend API Plan

Initial API areas:

- `POST /api/auth/register` (implemented)
- `POST /api/auth/login` (implemented)
- `POST /api/auth/logout` (implemented)
- `GET /api/auth/me` (implemented)
- `POST /api/workspaces` (implemented)
- `GET /api/workspaces` (implemented)
- `GET /api/workspaces/:workspaceId` (implemented)
- `POST /api/workspaces/:workspaceId/members` (implemented for existing users)
- `GET /api/workspaces/:workspaceId/members` (implemented)
- `PATCH /api/workspaces/:workspaceId/members/:userId` (implemented)
- `DELETE /api/workspaces/:workspaceId/members/:userId` (implemented)
- `POST /api/workspaces/:workspaceId/notes` (implemented)
- `GET /api/workspaces/:workspaceId/notes` (implemented)
- `GET /api/workspaces/:workspaceId/notes/:noteId` (implemented)
- `POST /api/workspaces/:workspaceId/notes/:noteId/versions` (implemented)
- `GET /api/workspaces/:workspaceId/notes/:noteId/versions` (implemented)
- `DELETE /api/workspaces/:workspaceId/notes/:noteId` (implemented as a soft delete)
- `POST /workspaces/:workspaceId/invitations`
- `POST /invitations/:invitationId/accept`
- `POST /api/workspaces/:workspaceId/sync/push` (implemented)
- `GET /api/workspaces/:workspaceId/sync/pull` (implemented)
- `POST /conflicts/:conflictId/resolve`

API rules:

- Validate every request and response with shared schemas.
- Authorize every workspace-scoped operation against membership.
- Treat sync payloads as untrusted, even from authenticated users.
- Use idempotency keys for client-created operations.
- Return structured error codes for validation, authorization, version conflict, and replay cases.

## Frontend Page Plan

Initial pages:

- Login and register.
- Workspace list.
- Workspace detail with note list.
- Note editor.
- Sync status and pending changes surface.
- Conflict resolution view.
- Version history view.
- Invitation acceptance.

Defer comments UI until notes and sync are stable.

## Implemented Frontend Foundation

`apps/web` is a React and TypeScript Vite application. React Router owns public authentication routes and protected workspace/note routes. TanStack Query owns remote API state and cache invalidation, while a separate Dexie repository owns durable client data and pending note mutations. A small typed fetch client sends credentials with every request so the backend's HTTP-only cookie session remains the online authentication boundary.

Local development uses Vite's same-origin `/api` proxy. The Docker web container serves the built single-page application through Nginx and proxies `/api` to the API service. This avoids adding cross-origin credential handling to the backend for the initial frontend slice.

The note UI now creates, edits, and soft-deletes local notes without waiting for the API. Successful API reads refresh workspace, note metadata, and latest-version envelope caches. When the API is unavailable, cached workspace and note screens remain usable and every local mutation is committed atomically with its pending change. The browser caches the last verified user profile, but never the HTTP-only session token, so user-scoped local data can be reopened during a network outage.

Conflicted notes open a dedicated manual resolution route. It compares the preserved local snapshot with the remote envelope decrypted by the unlocked client, shows available base/remote metadata, and supports keep-local, accept-remote, or user-edited merge content. Resolution is one local transaction that preserves the conflict record, retires divergent pending operations, and creates a single update based on the selected remote version for the existing encrypted sync path.

The client sync domain now prepares encrypted pending operations through `@cipherspace/crypto`, pushes dependent operations in order, pulls validated event pages, and commits remote cache changes and opaque cursors atomically. Retry metadata and explicit conflict snapshots remain in IndexedDB. A workspace-level React provider supplies the engine with an unlocked in-memory key, and the workspace UI exposes explicit key creation/unlock plus manual sync.

Local editor payloads intentionally remain plaintext structured-clone values in v1. Pending payloads must pass through `@cipherspace/crypto` before upload; the queue is never an authorization to send plaintext to the backend. Protecting the workspace key does not provide encrypted-at-rest local drafts.

## Implemented Client Crypto Package

`packages/crypto` is a browser-compatible TypeScript package built directly on the platform Web Crypto API. It is isolated from backend, transport, persistence, and UI logic and has no runtime dependencies.

The implemented v1 primitives are:

- Generate an extractable 256-bit AES-GCM workspace key with `encrypt` and `decrypt` usages.
- Generate a fresh 96-bit nonce through `crypto.getRandomValues()` for every note encryption.
- Encrypt and decrypt UTF-8 note content with AES-256-GCM and a 128-bit authentication tag.
- Serialize ciphertext and nonces as canonical base64 in a strict envelope containing algorithm, envelope version, and workspace key version.
- Authenticate the fixed envelope metadata as AES-GCM additional authenticated data.
- Export and import 32-byte raw workspace keys for a future key-wrapping flow. Raw exports are sensitive and must not be persisted or transmitted without wrapping.
- Protect a workspace key locally with an independently chosen unlock password using PBKDF2-HMAC-SHA-256 with a random 128-bit salt and 600,000 iterations, then AES-256-GCM wrapping with a fresh 96-bit nonce and a 128-bit tag.
- Authenticate the protection format, user ID, and workspace ID as wrapping additional data. Persist only the versioned protected-key envelope in IndexedDB and keep the unwrapped `CryptoKey` in memory.
- Reject malformed, unsupported, oversized, or unauthenticated envelopes before returning plaintext. Wrong keys and authentication failures use the same safe error boundary.

The package envelope is intentionally transport-independent. The later frontend integration will map its `ciphertext` and `nonce` fields into the existing API's `encryptedContent` and `contentNonce` fields and provide a key-management identifier for `encryptionMetadata.keyId`; the backend contract is unchanged in this slice.

The v1 local unlock password is separate from the account password and is never stored or sent to the backend. It derives only a wrapping key; it is not used directly as note key material. There is no recovery, parameter migration, multi-device transfer, or member key-sharing flow yet. Losing the password or browser profile can make server ciphertext unavailable to this client.

## Database Schema Plan

The backend foundation implements the first persistence subset as `users`, `sessions`, `workspaces`, `workspace_members`, `encrypted_notes`, `note_versions`, and `sync_changes`. The `encrypted_notes` name makes the intended ciphertext-only content boundary explicit. The remaining tables below are still planned and may be refined through additive migrations.

Planned tables:

- `users`: id, email, password_hash, created_at, updated_at.
- `sessions`: id, user_id, token_hash, expires_at, created_at.
- `devices`: id, user_id, label, created_at, last_seen_at.
- `workspaces`: id, creator_user_id, name, created_at, updated_at.
- `workspace_members`: workspace_id, user_id, role (`owner`, `editor`, or `viewer`), wrapped_workspace_key, key_wrap_algorithm, added_at.
- `workspace_invitations`: id, workspace_id, email, role, token_hash, expires_at, accepted_at, created_at.
- `encrypted_notes`: id, workspace_id, creator_user_id, encrypted_title, current_version_id, deleted_at, created_at, updated_at.
- `note_versions`: id, note_id, version_number, parent_version_id, author_user_id, device_id, encrypted_payload, payload_nonce, payload_key_id, client_version, created_at.
- `sync_operations`: id, workspace_id, note_id, author_user_id, device_id, operation_type, base_version_id, resulting_version_id, idempotency_key, created_at.
- `sync_events`: id, workspace_id, sequence_number, event_type, entity_id, created_at.
- `sync_cursors`: workspace_id, device_id, last_sequence_number, updated_at.
- `conflicts`: id, note_id, local_operation_id, server_version_id, status, created_at, resolved_at.

Add indexes for workspace membership lookup, note listing by workspace, version lookup by note, sync operation idempotency, and unresolved conflicts.

## Implemented Local Storage

`apps/web/src/local-storage` uses IndexedDB through Dexie. Records are scoped by the authenticated user ID so accounts using the same browser do not share query results. Schema version 4 contains:

- `workspaces`: workspace metadata and the current user's cached role.
- `notes`: stable note identity, local title/body payload, tombstone, local revision, base version, and server-visible note metadata.
- `note_versions`: cached immutable encrypted server envelopes and their version metadata.
- `pending_changes`: durable `create_note`, `update_note`, and `delete_note` mutations.
- `local_sync_metadata`: per-workspace client ID, opaque pull cursor, last-successful-sync timestamp, and last sync error.
- `conflicts`: local/base/remote snapshots created by push or pull conflict detection, plus durable resolution status, action, timestamp, selected payload, and replacement pending-operation ID.
- `workspace_keys`: one user/workspace-scoped protected-key envelope containing only ciphertext, KDF parameters, salt, nonce, and authenticated format metadata.

Note mutations and their pending queue records share one IndexedDB transaction. Client-created notes use `crypto.randomUUID()` so their IDs remain stable before any server contact. Each mutation increments a per-note `local_revision`. Repeated pending edits are coalesced into one `update_note` record with the latest payload, while create and delete operations remain explicit. A deleted note is retained as a tombstone and filtered from the normal local list.

API reads and sync pulls populate caches but do not overwrite an unsynced local payload or tombstone. The UI observes Dexie queries and surfaces per-note and per-workspace unsynced and conflict counts. Queue attempts persist `pending`, `syncing`, `failed`, `conflict`, `resolved`, or `synced` state with attempt timestamps and errors. `resolved` is a local terminal audit state; only `synced` means the server accepted that exact operation.

Sensitive local storage rules:

- Do not store plaintext passwords.
- Do not store raw recovery secrets in local storage.
- Avoid logging decrypted note content.
- Prefer keeping unwrapped workspace keys in memory only after unlock.
- If persisted key material is needed, store only wrapped keys and document the risk.
- Local plaintext drafts remain in the browser profile after logout and must be treated as device-local sensitive data; locking the workspace clears the in-memory key but does not encrypt or erase drafts.

## Architecture Decisions

- Use local-first persistence before network sync.
- Use encrypted note snapshots for v1 rather than CRDTs.
- Use monotonically increasing per-note versions assigned by the server.
- Use manual conflict resolution for divergent edits.
- Keep comments out of the first implementation slice.
- Prefer explicit APIs and schemas over implicit transport conventions.
- Use Argon2id for password hashing and database-backed opaque sessions in HTTP-only cookies. Store only a keyed HMAC digest of each session token, expire sessions after a configured lifetime, and invalidate the current session on logout.
- Derive current workspace ownership from `workspace_members` rather than a single owner column. Serialize member-management mutations per workspace and prevent removal or downgrade of the final owner.
- Store optional note titles as ciphertext/nonce pairs. The direct note API accepts opaque base64 envelopes and does not perform cryptography or plaintext processing.
- Create an immutable initial version with each note, assign later versions monotonically increasing per-note numbers under a row lock, and set their parent to the version current at append time. Base-version conflict checks remain deferred to the sync protocol.
- Use the platform Web Crypto API through the isolated `@cipherspace/crypto` package for AES-256-GCM note encryption. Version 1 envelopes use random 96-bit nonces, 128-bit tags, canonical base64, envelope version 1, and workspace key version 1.
- Keep raw workspace keys in caller-managed memory. Raw key import/export supports future wrapping but is not a persistence or sharing design.
- For the local-only v1 unlock model, persist a versioned AES-GCM-protected workspace key in user-scoped IndexedDB. Derive its wrapping key with PBKDF2-HMAC-SHA-256, a random 128-bit salt, and 600,000 iterations; bind the user and workspace identifiers through authenticated additional data.
- Require an explicit local unlock password after reload and expose manual sync only while the workspace key is unlocked. Do not reuse the account password or send protection material to the backend.
- Scope IndexedDB records by user ID and commit local note state and its pending mutation atomically.
- Treat the local database as the editing source of truth; sync transport reads durable pending operations rather than submitting directly from editor forms.
- Use workspace-scoped sync routes, client operation UUIDs plus request fingerprints for idempotency, and opaque sequence cursors for resumable pulls.
- Push dependent operations sequentially so a locally created note can receive a server base before later updates or deletion are submitted.
- Commit each pulled page and its new cursor atomically; represent divergent base versions as unresolved local conflicts without overwriting drafts.
- Resolve note-edit conflicts locally and explicitly. Preserve both snapshots, rebase exactly one chosen result to the latest cached remote version, and let normal encrypted sync create the immutable server version.
