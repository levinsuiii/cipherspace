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
  shared/
docs/
```

Suggested ownership:

- `apps/web`: UI, IndexedDB persistence, client crypto, sync queue.
- `apps/api`: authentication, authorization, sync endpoints, database access.
- `packages/shared`: IDs, typed data models, Zod schemas, error codes, sync payload contracts.

## Data Model

Core entities:

- User: account identity used for authentication and membership.
- Device: client installation that creates local operations and participates in sync.
- Workspace: collaboration boundary containing notes and members.
- WorkspaceMember: user role and member-wrapped access material for a workspace.
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
- `POST /workspaces`
- `GET /workspaces`
- `GET /workspaces/:workspaceId`
- `POST /workspaces/:workspaceId/invitations`
- `POST /invitations/:invitationId/accept`
- `GET /workspaces/:workspaceId/notes`
- `POST /workspaces/:workspaceId/notes`
- `GET /notes/:noteId`
- `PATCH /notes/:noteId`
- `DELETE /notes/:noteId`
- `GET /notes/:noteId/versions`
- `POST /sync/push`
- `POST /sync/pull`
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

## Database Schema Plan

The backend foundation implements the first persistence subset as `users`, `sessions`, `workspaces`, `workspace_members`, `encrypted_notes`, `note_versions`, and `sync_changes`. The `encrypted_notes` name makes the intended ciphertext-only content boundary explicit. The remaining tables below are still planned and may be refined through additive migrations.

Planned tables:

- `users`: id, email, password_hash, created_at, updated_at.
- `sessions`: id, user_id, token_hash, expires_at, created_at.
- `devices`: id, user_id, label, created_at, last_seen_at.
- `workspaces`: id, owner_user_id, name, created_at, updated_at.
- `workspace_members`: workspace_id, user_id, role, wrapped_workspace_key, key_wrap_algorithm, added_at.
- `workspace_invitations`: id, workspace_id, email, role, token_hash, expires_at, accepted_at, created_at.
- `notes`: id, workspace_id, creator_user_id, encrypted_title, current_version_id, deleted_at, created_at, updated_at.
- `note_versions`: id, note_id, version_number, parent_version_id, author_user_id, device_id, encrypted_payload, payload_nonce, payload_key_id, created_at.
- `sync_operations`: id, workspace_id, note_id, author_user_id, device_id, operation_type, base_version_id, resulting_version_id, idempotency_key, created_at.
- `sync_events`: id, workspace_id, sequence_number, event_type, entity_id, created_at.
- `sync_cursors`: workspace_id, device_id, last_sequence_number, updated_at.
- `conflicts`: id, note_id, local_operation_id, server_version_id, status, created_at, resolved_at.

Add indexes for workspace membership lookup, note listing by workspace, version lookup by note, sync operation idempotency, and unresolved conflicts.

## Local Storage Plan

Use IndexedDB for:

- Workspaces and membership cache.
- Notes and decrypted editor drafts while the user is signed in.
- Encrypted note envelopes and version history cache.
- Pending sync operations.
- Conflict records.
- Last successful sync cursor per workspace.
- Device identity.

Sensitive local storage rules:

- Do not store plaintext passwords.
- Do not store raw recovery secrets in local storage.
- Avoid logging decrypted note content.
- Prefer keeping unwrapped workspace keys in memory only after unlock.
- If persisted key material is needed, store only wrapped keys and document the risk.

## Architecture Decisions

- Use local-first persistence before network sync.
- Use encrypted note snapshots for v1 rather than CRDTs.
- Use monotonically increasing per-note versions assigned by the server.
- Use manual conflict resolution for divergent edits.
- Keep comments out of the first implementation slice.
- Prefer explicit APIs and schemas over implicit transport conventions.
- Use Argon2id for password hashing and database-backed opaque sessions in HTTP-only cookies. Store only a keyed HMAC digest of each session token, expire sessions after a configured lifetime, and invalidate the current session on logout.
