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
- Comment: encrypted discussion entry tied to one note, with an optional same-note parent comment.

Stable identifiers should be UUIDs generated client-side where offline creation is required. Server-generated IDs are acceptable for strictly online entities such as sessions.

## Data Visibility

Encrypted on the client before upload:

- Note body.
- Optional note title if UX allows encrypted-title limitations.
- Comment body.

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
- `POST /api/workspaces/:workspaceId/notes/:noteId/comments` (implemented)
- `GET /api/workspaces/:workspaceId/notes/:noteId/comments` (implemented)
- `DELETE /api/workspaces/:workspaceId/notes/:noteId/comments/:commentId` (implemented as content-redacting soft delete)

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

The note detail page now includes an encrypted discussion section. Comments are online API state managed through TanStack Query rather than IndexedDB or the note sync queue.

The same React application is the mobile surface; there is no native wrapper. Responsive CSS keeps
workspace lists, note lists, editors, comments, and conflict resolution usable around 360px width,
including safe-area padding and touch targets. A web app manifest, generated PNG icons, Apple touch
metadata, and standalone display mode make the deployed HTTPS frontend installable as a PWA.

The production-only service worker is intentionally outside application data flow. It caches the
static app shell, hashed frontend assets, icons, manifest, and a plaintext-free offline page. It does
not intercept non-GET, cross-origin, `/api/*`, or `/health` requests. IndexedDB remains the only
durable local note store, and its encrypted-at-rest rules are unchanged. When lifecycle visibility
changes hide or unload the app, the key provider clears every unwrapped in-memory workspace key;
components respond to locked status by removing rendered plaintext.

## Implemented Frontend Foundation

`apps/web` is a React and TypeScript Vite application. React Router owns public authentication routes and protected workspace/note routes. TanStack Query owns remote API state and cache invalidation, while a separate Dexie repository owns durable client data and pending note mutations. A small typed fetch client sends credentials with every request so the backend's HTTP-only cookie session remains the online authentication boundary.

Local development uses Vite's same-origin `/api` proxy. The Docker web container serves the built single-page application through Nginx and proxies `/api` to the API service. Those paths remain same-origin. A separately hosted static production build instead compiles an exact public API origin from `VITE_API_BASE_URL`; the backend then allows only the exact frontend origin through credentialed CORS. Cross-site provider domains require an explicit `SameSite=None; Secure` cookie policy and trusted-edge proxy configuration, while same-origin deployments keep the stricter default.

The note UI now creates, edits, and soft-deletes local notes without waiting for the API. Successful API reads refresh workspace, note metadata, and latest-version envelope caches. When the API is unavailable, cached workspace and note screens remain usable and every local mutation is committed atomically with its pending change. The browser caches the last verified user profile, but never the HTTP-only session token, so user-scoped local data can be reopened during a network outage.

The detail page decrypts a local envelope, or the latest cached server envelope when no local envelope exists, only after the workspace key is unlocked. Plaintext exists in React memory while displayed. Owners and editors save by encrypting a fresh envelope before the note and pending operation are committed atomically. Local unsynced envelopes always take precedence over cached server versions.

Conflicted notes open a dedicated manual resolution route. It decrypts both preserved local and remote envelopes in the unlocked client, shows available base/remote metadata, and supports keep-local, accept-remote, or user-edited merge content. The selected result is encrypted before one local transaction preserves encrypted resolution history, retires divergent pending operations, and creates a single encrypted update based on the selected remote version.

The client note-mutation boundary prepares encrypted note and pending-operation envelopes through `@cipherspace/crypto`. The sync domain pushes those durable envelopes in order, pulls validated event pages, and commits remote cache changes and opaque cursors atomically. Retry metadata and encrypted conflict snapshots remain in IndexedDB. A workspace-level React provider supplies the UI with an unlocked in-memory key, and the workspace UI exposes explicit key creation/unlock plus manual sync.

Local title/body payloads exist transiently in component memory and method arguments, but the durable note, pending-change, conflict, and resolved-conflict content fields use the existing version 1 AES-GCM note envelope. A compatibility migration encrypts older plaintext records after successful unlock, then clears their plaintext fields. Locked UI renders placeholders rather than retained component plaintext.

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

The package envelope is intentionally transport-independent. The frontend maps its `ciphertext` and `nonce` fields into the API's `encryptedContent` and `contentNonce` fields and supplies the fixed version 1 key identifier in `encryptionMetadata.keyId`; local IndexedDB records retain the package envelope directly.

The v1 local unlock password is separate from the account password and is never stored or sent to the backend. It derives only a wrapping key; it is not used directly as note key material. There is no recovery, parameter migration, multi-device transfer, or member key-sharing flow yet. Losing the password or browser profile can make server ciphertext unavailable to this client.

## Database Schema Plan

The backend foundation implements the first persistence subset as `users`, `sessions`, `workspaces`, `workspace_members`, `encrypted_notes`, `note_versions`, `encrypted_comments`, and `sync_changes`. The encrypted entity names make the intended ciphertext-only content boundary explicit. The remaining tables below are still planned and may be refined through additive migrations.

Planned tables:

- `users`: id, email, password_hash, created_at, updated_at.
- `sessions`: id, user_id, token_hash, expires_at, created_at.
- `devices`: id, user_id, label, created_at, last_seen_at.
- `workspaces`: id, creator_user_id, name, created_at, updated_at.
- `workspace_members`: workspace_id, user_id, role (`owner`, `editor`, or `viewer`), wrapped_workspace_key, key_wrap_algorithm, added_at.
- `workspace_invitations`: id, workspace_id, email, role, token_hash, expires_at, accepted_at, created_at.
- `encrypted_notes`: id, workspace_id, creator_user_id, encrypted_title, current_version_id, deleted_at, created_at, updated_at.
- `note_versions`: id, note_id, version_number, parent_version_id, author_user_id, device_id, encrypted_payload, payload_nonce, payload_key_id, client_version, created_at.
- `encrypted_comments`: id, workspace_id, note_id, author_user_id, parent_comment_id, encrypted_content, content_nonce, envelope_version, encryption_algorithm, content_key_id, deleted_at, created_at, updated_at.
- `sync_operations`: id, workspace_id, note_id, author_user_id, device_id, operation_type, base_version_id, resulting_version_id, idempotency_key, created_at.
- `sync_events`: id, workspace_id, sequence_number, event_type, entity_id, created_at.
- `sync_cursors`: workspace_id, device_id, last_sequence_number, updated_at.
- `conflicts`: id, note_id, local_operation_id, server_version_id, status, created_at, resolved_at.

Add indexes for workspace membership lookup, note listing by workspace, version lookup by note, sync operation idempotency, and unresolved conflicts.

## Implemented Local Storage

`apps/web/src/local-storage` uses IndexedDB through Dexie. Records are scoped by the authenticated user ID so accounts using the same browser do not share query results. Schema version 5 contains:

- `workspaces`: workspace metadata and the current user's cached role.
- `notes`: stable note identity, encrypted local title/body envelope, tombstone, local revision, base version, and server-visible note metadata.
- `note_versions`: cached immutable encrypted server envelopes and their version metadata.
- `pending_changes`: durable `create_note`, `update_note`, and `delete_note` mutations; create/update content is an encrypted note envelope and deletes have no content.
- `local_sync_metadata`: per-workspace client ID, opaque pull cursor, last-successful-sync timestamp, and last sync error.
- `conflicts`: encrypted local and remote snapshots created by push or pull conflict detection, plus durable resolution status, action, timestamp, encrypted selected payload, and replacement pending-operation ID.
- `workspace_keys`: one user/workspace-scoped protected-key envelope containing only ciphertext, KDF parameters, salt, nonce, and authenticated format metadata.

Create/edit content is encrypted with a fresh nonce before note mutations and pending queue records share one IndexedDB transaction. Client-created notes use `crypto.randomUUID()` so their IDs remain stable before any server contact. Each mutation increments a per-note `local_revision`. Repeated pending edits are coalesced into one `update_note` record with the latest encrypted envelope, while create and delete operations remain explicit. A deleted note is retained as a tombstone and filtered from the normal local list.

Schema version 5 is additive: its structural upgrade initializes encrypted local fields but deliberately does not transform content, because the protected workspace key is unavailable to Dexie during database open. After a successful workspace unlock, the repository encrypts legacy plaintext notes, pending changes, and conflict/resolution snapshots, verifies that their revisions still match, and atomically clears the corresponding plaintext fields.

API reads and sync pulls populate caches but do not overwrite an unsynced local payload or tombstone. The UI observes Dexie queries and surfaces per-note and per-workspace unsynced and conflict counts. Queue attempts persist `pending`, `syncing`, `failed`, `conflict`, `resolved`, or `synced` state with attempt timestamps and errors. `resolved` is a local terminal audit state; only `synced` means the server accepted that exact operation.

Sensitive local storage rules:

- Do not store plaintext passwords.
- Do not store raw recovery secrets in local storage.
- Avoid logging decrypted note content.
- Prefer keeping unwrapped workspace keys in memory only after unlock.
- If persisted key material is needed, store only wrapped keys and document the risk.
- Local ciphertext and visible operational metadata remain in the browser profile after logout. Locking clears the in-memory key and readable UI state but does not erase ciphertext.

## Architecture Decisions

- Use local-first persistence before network sync.
- Use encrypted note snapshots for v1 rather than CRDTs.
- Use monotonically increasing per-note versions assigned by the server.
- Use manual conflict resolution for divergent edits.
- Keep comments note-scoped and online-only in this slice. Use optional same-note parent links for lightweight threads; do not add chat, notifications, presence, or real-time transport.
- Encrypt comment bodies in the client with the existing workspace AES-GCM key and a comment-specific authenticated-data context. Store only opaque ciphertext envelopes on the backend.
- Preserve deleted comment identity and parent linkage while clearing ciphertext, nonce, and encryption metadata. Authors with owner/editor write roles can delete their own comments, and owners can moderate any comment.
- Prefer explicit APIs and schemas over implicit transport conventions.
- Use Argon2id for password hashing and database-backed opaque sessions in HTTP-only cookies. Store only a keyed HMAC digest of each session token, expire sessions after a configured lifetime, and invalidate the current session on logout.
- Keep session cookies host-only, high priority, and `Secure` in production. Default to `SameSite=Strict`; permit the explicit `SameSite=None` production mode only for a separately hosted HTTPS frontend with exact credentialed CORS. Keep the session HMAC secret environment-provided and reject marked development/placeholder secrets in production.
- Use a bounded PostgreSQL application pool, accept provider TLS parameters in `DATABASE_URL`, and allow a separate direct `MIGRATIONS_DATABASE_URL` so schema migration does not depend on a transaction pooler.
- Apply ordered checksum-verified migrations before starting a deployed API instance. Keep this path idempotent because free services may restart or overlap during deployment.
- Rate-limit registration and login before password hashing. The v1 in-memory limiter is intentionally single-process; a multi-replica deployment requires a shared store.
- Apply exact-origin credentialed CORS, safe error responses, no-store API caching, bounded request bodies, sensitive-header log redaction, and security headers as request-lifecycle concerns rather than duplicating them in domain services.
- Derive current workspace ownership from `workspace_members` rather than a single owner column. Serialize member-management mutations per workspace and prevent removal or downgrade of the final owner.
- Store optional note titles as ciphertext/nonce pairs. The direct note API accepts opaque base64 envelopes and does not perform cryptography or plaintext processing.
- Create an immutable initial version with each note, assign later versions monotonically increasing per-note numbers under a row lock, and set their parent to the version current at append time. Base-version conflict checks remain deferred to the sync protocol.
- Use the platform Web Crypto API through the isolated `@cipherspace/crypto` package for AES-256-GCM note encryption. Version 1 envelopes use random 96-bit nonces, 128-bit tags, canonical base64, envelope version 1, and workspace key version 1.
- Keep raw workspace keys in caller-managed memory. Raw key import/export supports future wrapping but is not a persistence or sharing design.
- For the local-only v1 unlock model, persist a versioned AES-GCM-protected workspace key in user-scoped IndexedDB. Derive its wrapping key with PBKDF2-HMAC-SHA-256, a random 128-bit salt, and 600,000 iterations; bind the user and workspace identifiers through authenticated additional data.
- Require an explicit local unlock password after reload and expose manual sync only while the workspace key is unlocked. Do not reuse the account password or send protection material to the backend.
- Scope IndexedDB records by user ID and commit local note state and its pending mutation atomically.
- Encrypt local create/edit and conflict-resolution content before committing it to IndexedDB; reuse the resulting envelope for sync.
- Treat the local database as the editing source of truth; sync transport reads durable pending operations rather than submitting directly from editor forms.
- Use workspace-scoped sync routes, client operation UUIDs plus request fingerprints for idempotency, and opaque sequence cursors for resumable pulls.
- Push dependent operations sequentially so a locally created note can receive a server base before later updates or deletion are submitted.
- Commit each pulled page and its new cursor atomically; represent divergent base versions as unresolved local conflicts without overwriting drafts.
- Resolve note-edit conflicts locally and explicitly. Preserve both snapshots, rebase exactly one chosen result to the latest cached remote version, and let normal encrypted sync create the immutable server version.
- Decrypt local or server-backed note envelopes only while the workspace key is unlocked. Keep plaintext in UI memory, render placeholders immediately on lock, and encrypt every saved change before persistence.
- Use one responsive web application for desktop/mobile and install it through standards-based PWA metadata rather than a native wrapper.
- Restrict service-worker caching to public static application resources. Keep API/auth/sync/comment responses and encrypted workspace data out of Cache Storage, and do not implement background sync.
- Lock every in-memory workspace key when the document becomes hidden or receives `pagehide`; guard asynchronous unlock completion so a backgrounded app cannot become unlocked afterward.
