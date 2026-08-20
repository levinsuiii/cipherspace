import type { Database, DatabaseSession } from "../database/database.js";
import type { StoredEncryptedNote, StoredNoteVersion } from "../notes/repository.js";
import type { WorkspaceRole } from "../workspaces/repository.js";

export type SyncOperationType = "create_note" | "delete_note" | "update_note";

export interface SyncEncryptedPayloadInput {
  ciphertext: Buffer;
  encryptionAlgorithm: string;
  envelopeVersion: number;
  keyId: string;
  nonce: Buffer;
}

export interface SyncOperationInput {
  baseVersionId: string | null;
  changeId: string;
  clientId: string;
  clientRevision: number;
  createdAtClient: Date;
  noteId: string;
  operationId: string;
  operationType: SyncOperationType;
  payload: SyncEncryptedPayloadInput | null;
  requestHash: string;
  userId: string;
  versionId: string;
  workspaceId: string;
}

export interface StoredAcceptedSyncOutcome {
  note: StoredEncryptedNote;
  operationType: SyncOperationType;
  status: "accepted";
  version: StoredNoteVersion;
}

export interface StoredConflictSyncOutcome {
  note: StoredEncryptedNote;
  operationType: SyncOperationType;
  remoteVersion: StoredNoteVersion;
  status: "conflict";
}

export type StoredSyncOutcome = StoredAcceptedSyncOutcome | StoredConflictSyncOutcome;

export type ProcessSyncOperationResult =
  | { outcome: StoredSyncOutcome; replayed: boolean }
  | { reason: "forbidden" | "idempotency_mismatch" | "note_not_found"; rejected: true };

export interface StoredPullChange {
  changeId: string;
  changeType: "note.deleted" | "note.version.created";
  note: StoredEncryptedNote;
  sequenceNumber: bigint;
  version: StoredNoteVersion;
}

export interface SyncRepository {
  processOperation(input: SyncOperationInput): Promise<ProcessSyncOperationResult>;
  pullChanges(workspaceId: string, afterSequence: bigint, limit: number): Promise<StoredPullChange[]>;
}

interface NoteRow {
  created_at: Date;
  creator_user_id: string;
  current_version_id: string;
  deleted_at: Date | null;
  encrypted_title: Buffer | null;
  encrypted_title_nonce: Buffer | null;
  id: string;
  role?: WorkspaceRole;
  updated_at: Date;
  workspace_id: string;
}

interface VersionRow {
  author_user_id: string;
  client_version: string | null;
  created_at: Date;
  encrypted_payload: Buffer;
  encryption_algorithm: string;
  envelope_version: number;
  id: string;
  note_id: string;
  parent_version_id: string | null;
  payload_key_id: string;
  payload_nonce: Buffer;
  version_number: string;
}

interface OperationRow {
  actor_user_id: string;
  client_id: string;
  conflict_version_id: string | null;
  note_id: string;
  operation_type: SyncOperationType;
  outcome: "accepted" | "conflict";
  request_hash: string;
  resulting_version_id: string | null;
  workspace_id: string;
}

interface PullRow {
  change_id: string;
  change_type: "note.deleted" | "note.version.created";
  note_created_at: Date;
  note_creator_user_id: string;
  note_current_version_id: string;
  note_deleted_at: Date | null;
  note_encrypted_title: Buffer | null;
  note_encrypted_title_nonce: Buffer | null;
  note_id_value: string;
  note_updated_at: Date;
  note_workspace_id: string;
  sequence_number: string;
  version_author_user_id: string;
  version_client_version: string | null;
  version_created_at: Date;
  version_encrypted_payload: Buffer;
  version_encryption_algorithm: string;
  version_envelope_version: number;
  version_id: string;
  version_note_id: string;
  version_number: string;
  version_parent_version_id: string | null;
  version_payload_key_id: string;
  version_payload_nonce: Buffer;
}

const noteColumns = `id, workspace_id, creator_user_id, encrypted_title,
  encrypted_title_nonce, current_version_id, deleted_at, created_at, updated_at`;
const versionColumns = `id, note_id, version_number, parent_version_id, author_user_id,
  envelope_version, encryption_algorithm, encrypted_payload, payload_nonce, payload_key_id,
  client_version, created_at`;

function mapNote(row: NoteRow): StoredEncryptedNote {
  return {
    createdAt: row.created_at,
    creatorUserId: row.creator_user_id,
    currentVersionId: row.current_version_id,
    deletedAt: row.deleted_at,
    encryptedTitle: row.encrypted_title,
    encryptedTitleNonce: row.encrypted_title_nonce,
    id: row.id,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id
  };
}

function mapVersion(row: VersionRow): StoredNoteVersion {
  return {
    authorUserId: row.author_user_id,
    clientVersion: row.client_version,
    createdAt: row.created_at,
    encryptedPayload: row.encrypted_payload,
    encryptionAlgorithm: row.encryption_algorithm,
    envelopeVersion: row.envelope_version,
    id: row.id,
    noteId: row.note_id,
    parentVersionId: row.parent_version_id,
    payloadKeyId: row.payload_key_id,
    payloadNonce: row.payload_nonce,
    versionNumber: Number(row.version_number)
  };
}

async function readVersion(
  database: DatabaseSession,
  noteId: string,
  versionId: string
): Promise<StoredNoteVersion> {
  const result = await database.query<VersionRow>(
    `SELECT ${versionColumns} FROM note_versions WHERE id = $1 AND note_id = $2`,
    [versionId, noteId]
  );
  const version = result.rows[0];
  if (!version) throw new Error("Sync operation references a missing note version");
  return mapVersion(version);
}

async function readNote(
  database: DatabaseSession,
  workspaceId: string,
  noteId: string
): Promise<StoredEncryptedNote> {
  const result = await database.query<NoteRow>(
    `SELECT ${noteColumns} FROM encrypted_notes WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, noteId]
  );
  const note = result.rows[0];
  if (!note) throw new Error("Sync operation references a missing note");
  return mapNote(note);
}

async function insertVersion(
  database: DatabaseSession,
  input: SyncOperationInput,
  versionNumber: number,
  parentVersionId: string | null
): Promise<StoredNoteVersion> {
  if (!input.payload) throw new Error("A note version requires an encrypted payload");
  const result = await database.query<VersionRow>(
    `INSERT INTO note_versions (
       id, note_id, version_number, parent_version_id, author_user_id, envelope_version,
       encryption_algorithm, encrypted_payload, payload_nonce, payload_key_id, client_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${versionColumns}`,
    [
      input.versionId,
      input.noteId,
      versionNumber,
      parentVersionId,
      input.userId,
      input.payload.envelopeVersion,
      input.payload.encryptionAlgorithm,
      input.payload.ciphertext,
      input.payload.nonce,
      input.payload.keyId,
      String(input.clientRevision)
    ]
  );
  const version = result.rows[0];
  if (!version) throw new Error("Sync version insert returned no row");
  return mapVersion(version);
}

async function insertOperation(
  database: DatabaseSession,
  input: SyncOperationInput,
  outcome: "accepted" | "conflict",
  versionId: string
): Promise<void> {
  await database.query(
    `INSERT INTO sync_operations (
       operation_id, workspace_id, actor_user_id, client_id, note_id, operation_type,
       base_version_id, client_revision, request_hash, outcome, resulting_version_id,
       conflict_version_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       CASE WHEN $10 = 'accepted' THEN $11::uuid ELSE NULL END,
       CASE WHEN $10 = 'conflict' THEN $11::uuid ELSE NULL END)`,
    [
      input.operationId,
      input.workspaceId,
      input.userId,
      input.clientId,
      input.noteId,
      input.operationType,
      input.baseVersionId,
      input.clientRevision,
      input.requestHash,
      outcome,
      versionId
    ]
  );
}

async function insertChange(
  database: DatabaseSession,
  input: SyncOperationInput,
  changeType: "note.deleted" | "note.version.created",
  versionId: string
): Promise<void> {
  await database.query(
    `INSERT INTO sync_changes (
       change_id, workspace_id, entity_type, entity_id, change_type, note_version_id,
       actor_user_id
     ) VALUES ($1, $2, 'note', $3, $4, $5, $6)`,
    [input.changeId, input.workspaceId, input.noteId, changeType, versionId, input.userId]
  );
}

export class PostgresSyncRepository implements SyncRepository {
  public constructor(private readonly database: Database) {}

  public async processOperation(input: SyncOperationInput): Promise<ProcessSyncOperationResult> {
    return this.database.transaction(async (database) => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `sync-operation:${input.operationId}`
      ]);
      await database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `sync-note:${input.noteId}`
      ]);
      const existingResult = await database.query<OperationRow>(
        `SELECT workspace_id, actor_user_id, client_id, note_id, operation_type, request_hash,
                outcome, resulting_version_id, conflict_version_id
         FROM sync_operations WHERE operation_id = $1`,
        [input.operationId]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (
          existing.workspace_id !== input.workspaceId ||
          existing.actor_user_id !== input.userId ||
          existing.client_id !== input.clientId ||
          existing.request_hash !== input.requestHash
        ) {
          return { reason: "idempotency_mismatch", rejected: true };
        }
        const note = await readNote(database, input.workspaceId, existing.note_id);
        const versionId = existing.resulting_version_id ?? existing.conflict_version_id;
        if (!versionId) throw new Error("Stored sync operation has no result version");
        const version = await readVersion(database, existing.note_id, versionId);
        const outcome: StoredSyncOutcome =
          existing.outcome === "accepted"
            ? { note, operationType: existing.operation_type, status: "accepted", version }
            : {
                note,
                operationType: existing.operation_type,
                remoteVersion: version,
                status: "conflict"
              };
        return { outcome, replayed: true };
      }

      if (input.operationType === "create_note") {
        const memberResult = await database.query<{ role: WorkspaceRole }>(
          `SELECT role FROM workspace_members
           WHERE workspace_id = $1 AND user_id = $2`,
          [input.workspaceId, input.userId]
        );
        const role = memberResult.rows[0]?.role;
        if (role !== "owner" && role !== "editor") {
          return { reason: "forbidden", rejected: true };
        }

        const currentResult = await database.query<NoteRow>(
          `SELECT ${noteColumns} FROM encrypted_notes
           WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [input.workspaceId, input.noteId]
        );
        const current = currentResult.rows[0];
        if (current) {
          await insertOperation(database, input, "conflict", current.current_version_id);
          return {
            outcome: {
              note: mapNote(current),
              operationType: input.operationType,
              remoteVersion: await readVersion(database, input.noteId, current.current_version_id),
              status: "conflict"
            },
            replayed: false
          };
        }

        await database.query(
          `INSERT INTO encrypted_notes (id, workspace_id, creator_user_id)
           VALUES ($1, $2, $3)`,
          [input.noteId, input.workspaceId, input.userId]
        );
        const version = await insertVersion(database, input, 1, null);
        const noteResult = await database.query<NoteRow>(
          `UPDATE encrypted_notes SET current_version_id = $2, updated_at = now()
           WHERE id = $1 RETURNING ${noteColumns}`,
          [input.noteId, version.id]
        );
        const created = noteResult.rows[0];
        if (!created) throw new Error("Sync note creation returned no row");
        await insertOperation(database, input, "accepted", version.id);
        await insertChange(database, input, "note.version.created", version.id);
        return {
          outcome: { note: mapNote(created), operationType: input.operationType, status: "accepted", version },
          replayed: false
        };
      }

      const noteResult = await database.query<NoteRow>(
        `SELECT encrypted_notes.*, workspace_members.role
         FROM encrypted_notes
         JOIN workspace_members
           ON workspace_members.workspace_id = encrypted_notes.workspace_id
          AND workspace_members.user_id = $3
         WHERE encrypted_notes.workspace_id = $1 AND encrypted_notes.id = $2
           AND encrypted_notes.deleted_at IS NULL
         FOR UPDATE OF encrypted_notes`,
        [input.workspaceId, input.noteId, input.userId]
      );
      const current = noteResult.rows[0];
      if (!current) return { reason: "note_not_found", rejected: true };
      if (
        (input.operationType === "update_note" && current.role === "viewer") ||
        (input.operationType === "delete_note" && current.role !== "owner")
      ) {
        return { reason: "forbidden", rejected: true };
      }
      if (current.current_version_id !== input.baseVersionId) {
        await insertOperation(database, input, "conflict", current.current_version_id);
        return {
          outcome: {
            note: mapNote(current),
            operationType: input.operationType,
            remoteVersion: await readVersion(database, input.noteId, current.current_version_id),
            status: "conflict"
          },
          replayed: false
        };
      }

      if (input.operationType === "delete_note") {
        const deletedResult = await database.query<NoteRow>(
          `UPDATE encrypted_notes SET deleted_at = now(), updated_at = now()
           WHERE id = $1 RETURNING ${noteColumns}`,
          [input.noteId]
        );
        const deleted = deletedResult.rows[0];
        if (!deleted) throw new Error("Sync note deletion returned no row");
        const version = await readVersion(database, input.noteId, current.current_version_id);
        await insertOperation(database, input, "accepted", version.id);
        await insertChange(database, input, "note.deleted", version.id);
        return {
          outcome: { note: mapNote(deleted), operationType: input.operationType, status: "accepted", version },
          replayed: false
        };
      }

      const currentVersion = await readVersion(database, input.noteId, current.current_version_id);
      const version = await insertVersion(
        database,
        input,
        currentVersion.versionNumber + 1,
        currentVersion.id
      );
      const updatedResult = await database.query<NoteRow>(
        `UPDATE encrypted_notes SET current_version_id = $2, updated_at = now()
         WHERE id = $1 RETURNING ${noteColumns}`,
        [input.noteId, version.id]
      );
      const updated = updatedResult.rows[0];
      if (!updated) throw new Error("Sync note update returned no row");
      await insertOperation(database, input, "accepted", version.id);
      await insertChange(database, input, "note.version.created", version.id);
      return {
        outcome: { note: mapNote(updated), operationType: input.operationType, status: "accepted", version },
        replayed: false
      };
    });
  }

  public async pullChanges(
    workspaceId: string,
    afterSequence: bigint,
    limit: number
  ): Promise<StoredPullChange[]> {
    const result = await this.database.query<PullRow>(
      `SELECT sync_changes.change_id, sync_changes.change_type,
              sync_changes.sequence_number,
              encrypted_notes.id AS note_id_value,
              encrypted_notes.workspace_id AS note_workspace_id,
              encrypted_notes.creator_user_id AS note_creator_user_id,
              encrypted_notes.encrypted_title AS note_encrypted_title,
              encrypted_notes.encrypted_title_nonce AS note_encrypted_title_nonce,
              encrypted_notes.current_version_id AS note_current_version_id,
              encrypted_notes.deleted_at AS note_deleted_at,
              encrypted_notes.created_at AS note_created_at,
              encrypted_notes.updated_at AS note_updated_at,
              note_versions.id AS version_id,
              note_versions.note_id AS version_note_id,
              note_versions.version_number,
              note_versions.parent_version_id AS version_parent_version_id,
              note_versions.author_user_id AS version_author_user_id,
              note_versions.envelope_version AS version_envelope_version,
              note_versions.encryption_algorithm AS version_encryption_algorithm,
              note_versions.encrypted_payload AS version_encrypted_payload,
              note_versions.payload_nonce AS version_payload_nonce,
              note_versions.payload_key_id AS version_payload_key_id,
              note_versions.client_version AS version_client_version,
              note_versions.created_at AS version_created_at
       FROM sync_changes
       JOIN encrypted_notes ON encrypted_notes.id = sync_changes.entity_id
       JOIN note_versions ON note_versions.id = sync_changes.note_version_id
       WHERE sync_changes.workspace_id = $1 AND sync_changes.sequence_number > $2
       ORDER BY sync_changes.sequence_number ASC
       LIMIT $3`,
      [workspaceId, afterSequence.toString(), limit]
    );
    return result.rows.map((row) => ({
      changeId: row.change_id,
      changeType: row.change_type,
      note: mapNote({
        created_at: row.note_created_at,
        creator_user_id: row.note_creator_user_id,
        current_version_id: row.note_current_version_id,
        deleted_at: row.note_deleted_at,
        encrypted_title: row.note_encrypted_title,
        encrypted_title_nonce: row.note_encrypted_title_nonce,
        id: row.note_id_value,
        updated_at: row.note_updated_at,
        workspace_id: row.note_workspace_id
      }),
      sequenceNumber: BigInt(row.sequence_number),
      version: mapVersion({
        author_user_id: row.version_author_user_id,
        client_version: row.version_client_version,
        created_at: row.version_created_at,
        encrypted_payload: row.version_encrypted_payload,
        encryption_algorithm: row.version_encryption_algorithm,
        envelope_version: row.version_envelope_version,
        id: row.version_id,
        note_id: row.version_note_id,
        parent_version_id: row.version_parent_version_id,
        payload_key_id: row.version_payload_key_id,
        payload_nonce: row.version_payload_nonce,
        version_number: row.version_number
      })
    }));
  }
}
