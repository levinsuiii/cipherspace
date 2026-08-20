# Sync Protocol

CipherSpace v1 should use a simple local-first, version-based sync protocol. It should not use CRDTs or real-time collaborative editing until the product has proven basic encrypted note sync, version history, and manual conflict resolution.

## Sync Goals

- Local edits are durable before network sync.
- Sync works after offline edits.
- Concurrent edits never silently overwrite each other.
- The server stores encrypted note content and authoritative version ordering.
- Clients can resume sync after interruption.
- Sync operations are idempotent.

## Implementation Status

The database foundation includes a `sync_changes` sequence table for future workspace change feeds. The direct note API stores immutable encrypted versions, server-assigned version numbers, current-version pointers, parent-version pointers, and optional client revision metadata. Direct appends always parent to the current server version; they do not implement the base-version check described below.

The browser now implements only the durable first part of the local-first flow: user-scoped IndexedDB note/cache records and a pending change queue. Local create, edit, and tombstone-delete operations are stored before the UI reports success and survive reloads. There is still no queue processor, sync request schema, push/pull endpoint, cursor advancement, retry policy, idempotency processing, conflict detection, or conflict resolution.

## Non-Goals For v1

- Real-time multiplayer editing.
- CRDT merge semantics.
- Operational transform.
- Automatic semantic merges of encrypted note content.
- Push notifications or background sync.
- Server-side plaintext conflict resolution.

## Core Concepts

- Workspace sync cursor: client checkpoint for pulling changes in a workspace.
- Note version: immutable server-accepted encrypted content state for a note.
- Base version: version the client edited from.
- Pending operation: local mutation saved before upload.
- Conflict: server rejection or explicit divergent state requiring user resolution.
- Device ID: stable identifier for a client installation.
- Idempotency key: client-generated unique key for retry-safe operation submission.

## Version Model

Each note has:

- Stable `note_id`.
- `current_version_id`.
- Monotonic `version_number` assigned by the server.
- Ordered immutable `note_versions`.

Each edit operation includes:

- `operation_id`.
- `idempotency_key`.
- `workspace_id`.
- `note_id`.
- `device_id`.
- `base_version_id`.
- `encrypted_payload`.
- `payload_nonce`.
- `payload_key_id`.
- `created_at_client`.

The server accepts an edit only when `base_version_id` equals the note's current version. If the current version differs, the server returns a conflict response instead of overwriting.

## Local-First Flow

1. User edits a note.
2. Client saves the draft and pending operation to IndexedDB.
3. UI marks the note as pending sync.
4. When online, client sends pending operations to `POST /sync/push`.
5. Server validates authorization, schema, idempotency, and base version.
6. Server creates a new immutable note version or returns a conflict.
7. Client records the accepted version or creates a local conflict record.
8. Client pulls remote changes with `POST /sync/pull`.

Local persistence must happen before step 4.

## Implemented Local Change Format

IndexedDB schema version 1 stores pending changes with these fields:

- `id`: client-generated UUID and future operation/idempotency identity.
- `user_id`: local account scope; this is not part of a future wire payload.
- `workspace_id`: containing workspace UUID.
- `note_id`: stable client-generated or server-provided note UUID.
- `operation_type`: `create_note`, `update_note`, or `delete_note`.
- `encrypted_payload`: reserved for a future crypto-envelope serialization; currently `null`.
- `local_note_payload`: current local `{ title, body }` snapshot for create/update, or `null` for delete.
- `base_version_id`: cached server version edited from, or `null` for local-only notes.
- `local_revision`: monotonically increasing per-note client revision.
- `created_at` and `updated_at`: client ISO-8601 timestamps.
- `status`: `pending`, `syncing`, `failed`, or `synced`; local mutations currently produce only `pending`.

Each local note write and corresponding pending change are committed in the same IndexedDB transaction. Repeated unsent updates reuse one pending `update_note` record and replace its local payload and revision. Create and delete stay as separate operations so later sync work can preserve their ordering. The future queue processor must encrypt `local_note_payload` with `@cipherspace/crypto`, validate the envelope, define idempotency behavior, and only then construct a wire request. The current direct note API is not called by the local editor.

## Push Protocol

Request shape, conceptually:

```json
{
  "workspaceId": "uuid",
  "deviceId": "uuid",
  "operations": [
    {
      "operationId": "uuid",
      "idempotencyKey": "uuid",
      "type": "note.update",
      "noteId": "uuid",
      "baseVersionId": "uuid",
      "encryptedPayload": "base64",
      "payloadNonce": "base64",
      "payloadKeyId": "string",
      "createdAtClient": "iso-8601"
    }
  ]
}
```

Response outcomes per operation:

- `accepted`: operation produced a new server version.
- `duplicate`: idempotency key was already processed; return the original result.
- `conflict`: base version no longer matches current server version.
- `rejected`: validation or authorization failed.

The server must process operations transactionally per operation. A mixed batch may contain accepted and conflicted operations.

## Pull Protocol

Clients pull workspace changes after their last known cursor.

Request shape, conceptually:

```json
{
  "workspaceId": "uuid",
  "deviceId": "uuid",
  "cursor": "opaque-or-null"
}
```

Response shape, conceptually:

```json
{
  "workspaceId": "uuid",
  "nextCursor": "opaque",
  "changes": [
    {
      "type": "note.version.created",
      "noteId": "uuid",
      "versionId": "uuid",
      "versionNumber": 3,
      "encryptedPayload": "base64",
      "payloadNonce": "base64",
      "payloadKeyId": "string",
      "createdAtServer": "iso-8601"
    }
  ]
}
```

Cursors should be opaque to clients. The server may implement them with a monotonically increasing event sequence.

## Conflict Detection Strategy

Use version-based detection:

- Client records the base version when editing starts.
- Client submits that base version with the encrypted update.
- Server compares base version with the current version.
- If they differ, server creates or returns a conflict.
- Client shows both local pending content and latest server content after decrypting both locally.
- User chooses to keep local, keep remote, or manually combine into a new version.

Manual resolution creates a new operation based on the latest server version. The old conflicted operation remains in history for explanation and debugging.

## Conflict Resolution UI Requirements

The UI should show:

- Local unsynced version.
- Latest synced server version.
- Version timestamps and authors.
- A manual editor for the resolved content.
- Explicit save resolution action.

The UI must avoid implying that a merge was automatic when the user manually resolves it.

## Delete Semantics

For v1, deletes should be tombstones:

- A deleted note remains represented by metadata and version history.
- New edits against a deleted note are rejected unless future restore behavior is implemented.
- The encrypted payloads may remain in version history.

Cryptographic deletion is out of scope for v1.

## Comments

Comments are deferred until note sync is stable. When added, comments should follow the same principles:

- Client-side encrypted body.
- Stable comment IDs.
- Version-aware creation.
- Explicit conflict or rejection behavior for edits and deletes.

## Validation And Error Handling

Clients and server must validate:

- UUID formats.
- Workspace membership.
- Operation type.
- Base version presence.
- Payload envelope shape.
- Nonce presence and expected length for the chosen algorithm.
- Idempotency key uniqueness per actor or workspace.

Errors should use structured codes:

- `validation_failed`
- `unauthorized`
- `workspace_not_found`
- `note_not_found`
- `version_conflict`
- `duplicate_operation`
- `payload_too_large`

## Backward Awareness

Once persisted clients or databases exist, protocol changes must include:

- Envelope version fields.
- API contract versioning or compatibility notes.
- Migration behavior for local IndexedDB records.
- Migration behavior for server records.
