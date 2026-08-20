import type { Database, DatabaseSession } from "../database/database.js";

export interface StoredEncryptedNote {
  createdAt: Date;
  creatorUserId: string;
  currentVersionId: string;
  deletedAt: Date | null;
  encryptedTitle: Buffer | null;
  encryptedTitleNonce: Buffer | null;
  id: string;
  updatedAt: Date;
  workspaceId: string;
}

export interface StoredNoteVersion {
  authorUserId: string;
  clientVersion: string | null;
  createdAt: Date;
  encryptedPayload: Buffer;
  encryptionAlgorithm: string;
  envelopeVersion: number;
  id: string;
  noteId: string;
  parentVersionId: string | null;
  payloadKeyId: string;
  payloadNonce: Buffer;
  versionNumber: number;
}

export interface StoredNoteWithLatestVersion {
  latestVersion: StoredNoteVersion;
  note: StoredEncryptedNote;
}

export interface EncryptedVersionInput {
  authorUserId: string;
  clientVersion: string | null;
  encryptedPayload: Buffer;
  encryptionAlgorithm: string;
  envelopeVersion: number;
  id: string;
  payloadKeyId: string;
  payloadNonce: Buffer;
}

export interface NoteRepository {
  appendVersion(input: {
    noteId: string;
    syncChangeId: string;
    version: EncryptedVersionInput;
    workspaceId: string;
  }): Promise<StoredNoteVersion | null>;
  createNote(input: {
    encryptedTitle: Buffer | null;
    encryptedTitleNonce: Buffer | null;
    id: string;
    syncChangeId: string;
    userId: string;
    version: EncryptedVersionInput;
    workspaceId: string;
  }): Promise<StoredNoteWithLatestVersion | null>;
  findNoteWithLatestVersion(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<StoredNoteWithLatestVersion | null>;
  listNotes(workspaceId: string, userId: string): Promise<StoredEncryptedNote[]>;
  listVersions(workspaceId: string, noteId: string, userId: string): Promise<StoredNoteVersion[]>;
  softDeleteNote(
    workspaceId: string,
    noteId: string,
    userId: string,
    syncChangeId: string
  ): Promise<boolean>;
}

interface NoteRow {
  created_at: Date;
  creator_user_id: string;
  current_version_id: string;
  deleted_at: Date | null;
  encrypted_title: Buffer | null;
  encrypted_title_nonce: Buffer | null;
  id: string;
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

const noteColumns = `id, workspace_id, creator_user_id, encrypted_title,
  encrypted_title_nonce, current_version_id, deleted_at, created_at, updated_at`;
const versionColumns = `id, note_id, version_number, parent_version_id, author_user_id,
  envelope_version, encryption_algorithm, encrypted_payload, payload_nonce, payload_key_id,
  client_version, created_at`;
const qualifiedNoteColumns = `encrypted_notes.id, encrypted_notes.workspace_id,
  encrypted_notes.creator_user_id, encrypted_notes.encrypted_title,
  encrypted_notes.encrypted_title_nonce, encrypted_notes.current_version_id,
  encrypted_notes.deleted_at, encrypted_notes.created_at, encrypted_notes.updated_at`;
const qualifiedVersionColumns = `note_versions.id, note_versions.note_id,
  note_versions.version_number, note_versions.parent_version_id, note_versions.author_user_id,
  note_versions.envelope_version, note_versions.encryption_algorithm,
  note_versions.encrypted_payload, note_versions.payload_nonce, note_versions.payload_key_id,
  note_versions.client_version, note_versions.created_at`;

async function insertVersion(
  database: DatabaseSession,
  noteId: string,
  versionNumber: number,
  parentVersionId: string | null,
  version: EncryptedVersionInput
): Promise<StoredNoteVersion> {
  const result = await database.query<VersionRow>(
    `INSERT INTO note_versions (
       id, note_id, version_number, parent_version_id, author_user_id, envelope_version,
       encryption_algorithm, encrypted_payload, payload_nonce, payload_key_id, client_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${versionColumns}`,
    [
      version.id,
      noteId,
      versionNumber,
      parentVersionId,
      version.authorUserId,
      version.envelopeVersion,
      version.encryptionAlgorithm,
      version.encryptedPayload,
      version.payloadNonce,
      version.payloadKeyId,
      version.clientVersion
    ]
  );
  const created = result.rows[0];
  if (!created) {
    throw new Error("Note version creation did not return a version");
  }
  return mapVersion(created);
}

export class PostgresNoteRepository implements NoteRepository {
  public constructor(private readonly database: Database) {}

  public async createNote(input: {
    encryptedTitle: Buffer | null;
    encryptedTitleNonce: Buffer | null;
    id: string;
    syncChangeId: string;
    userId: string;
    version: EncryptedVersionInput;
    workspaceId: string;
  }): Promise<StoredNoteWithLatestVersion | null> {
    return this.database.transaction(async (database) => {
      const noteResult = await database.query<NoteRow>(
        `INSERT INTO encrypted_notes (
           id, workspace_id, creator_user_id, encrypted_title, encrypted_title_nonce
         )
         SELECT $1, $2, $3, $4, $5
         FROM workspace_members
         WHERE workspace_id = $2 AND user_id = $3 AND role IN ('owner', 'editor')
         RETURNING ${noteColumns}`,
        [
          input.id,
          input.workspaceId,
          input.userId,
          input.encryptedTitle,
          input.encryptedTitleNonce
        ]
      );
      const note = noteResult.rows[0];
      if (!note) {
        return null;
      }

      const latestVersion = await insertVersion(database, input.id, 1, null, input.version);
      const updatedNote = await database.query<NoteRow>(
        `UPDATE encrypted_notes
         SET current_version_id = $2, updated_at = now()
         WHERE id = $1
         RETURNING ${noteColumns}`,
        [input.id, latestVersion.id]
      );
      const createdNote = updatedNote.rows[0];
      if (!createdNote) {
        throw new Error("Encrypted note creation did not return a note");
      }
      await database.query(
        `INSERT INTO sync_changes (
           change_id, workspace_id, entity_type, entity_id, change_type, note_version_id,
           actor_user_id
         ) VALUES ($1, $2, 'note', $3, 'note.version.created', $4, $5)`,
        [input.syncChangeId, input.workspaceId, input.id, latestVersion.id, input.userId]
      );
      return { latestVersion, note: mapNote(createdNote) };
    });
  }

  public async listNotes(workspaceId: string, userId: string): Promise<StoredEncryptedNote[]> {
    const result = await this.database.query<NoteRow>(
      `SELECT ${qualifiedNoteColumns}
       FROM encrypted_notes
       JOIN workspace_members
         ON workspace_members.workspace_id = encrypted_notes.workspace_id
        AND workspace_members.user_id = $2
       WHERE encrypted_notes.workspace_id = $1 AND encrypted_notes.deleted_at IS NULL
       ORDER BY encrypted_notes.updated_at DESC, encrypted_notes.id ASC`,
      [workspaceId, userId]
    );
    return result.rows.map(mapNote);
  }

  public async findNoteWithLatestVersion(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<StoredNoteWithLatestVersion | null> {
    const noteResult = await this.database.query<NoteRow>(
      `SELECT ${qualifiedNoteColumns}
       FROM encrypted_notes
       JOIN workspace_members
         ON workspace_members.workspace_id = encrypted_notes.workspace_id
        AND workspace_members.user_id = $3
       WHERE encrypted_notes.workspace_id = $1 AND encrypted_notes.id = $2
         AND encrypted_notes.deleted_at IS NULL
       LIMIT 1`,
      [workspaceId, noteId, userId]
    );
    const note = noteResult.rows[0];
    if (!note) {
      return null;
    }

    const versionResult = await this.database.query<VersionRow>(
      `SELECT ${versionColumns}
       FROM note_versions
       WHERE id = $1 AND note_id = $2
       LIMIT 1`,
      [note.current_version_id, noteId]
    );
    const latestVersion = versionResult.rows[0];
    if (!latestVersion) {
      throw new Error("Encrypted note has no current version");
    }
    return { latestVersion: mapVersion(latestVersion), note: mapNote(note) };
  }

  public async appendVersion(input: {
    noteId: string;
    syncChangeId: string;
    version: EncryptedVersionInput;
    workspaceId: string;
  }): Promise<StoredNoteVersion | null> {
    return this.database.transaction(async (database) => {
      const current = await database.query<{ current_version_id: string }>(
        `SELECT encrypted_notes.current_version_id
         FROM encrypted_notes
         JOIN workspace_members
           ON workspace_members.workspace_id = encrypted_notes.workspace_id
          AND workspace_members.user_id = $3
          AND workspace_members.role IN ('owner', 'editor')
         WHERE encrypted_notes.workspace_id = $1 AND encrypted_notes.id = $2
           AND encrypted_notes.deleted_at IS NULL
         FOR UPDATE OF encrypted_notes`,
        [input.workspaceId, input.noteId, input.version.authorUserId]
      );
      const currentVersion = current.rows[0];
      if (!currentVersion) {
        return null;
      }

      const currentVersionNumber = await database.query<{ version_number: string }>(
        `SELECT version_number
         FROM note_versions
         WHERE id = $1 AND note_id = $2`,
        [currentVersion.current_version_id, input.noteId]
      );
      const versionNumber = currentVersionNumber.rows[0];
      if (!versionNumber) {
        throw new Error("Encrypted note has no current version");
      }

      const version = await insertVersion(
        database,
        input.noteId,
        Number(versionNumber.version_number) + 1,
        currentVersion.current_version_id,
        input.version
      );
      await database.query(
        `UPDATE encrypted_notes
         SET current_version_id = $2, updated_at = now()
         WHERE id = $1`,
        [input.noteId, version.id]
      );
      await database.query(
        `INSERT INTO sync_changes (
           change_id, workspace_id, entity_type, entity_id, change_type, note_version_id,
           actor_user_id
         ) VALUES ($1, $2, 'note', $3, 'note.version.created', $4, $5)`,
        [
          input.syncChangeId,
          input.workspaceId,
          input.noteId,
          version.id,
          input.version.authorUserId
        ]
      );
      return version;
    });
  }

  public async listVersions(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<StoredNoteVersion[]> {
    const result = await this.database.query<VersionRow>(
      `SELECT ${qualifiedVersionColumns}
       FROM note_versions
       JOIN encrypted_notes ON encrypted_notes.id = note_versions.note_id
       JOIN workspace_members
         ON workspace_members.workspace_id = encrypted_notes.workspace_id
        AND workspace_members.user_id = $3
       WHERE encrypted_notes.workspace_id = $1 AND encrypted_notes.id = $2
         AND encrypted_notes.deleted_at IS NULL
       ORDER BY note_versions.version_number ASC`,
      [workspaceId, noteId, userId]
    );
    return result.rows.map(mapVersion);
  }

  public async softDeleteNote(
    workspaceId: string,
    noteId: string,
    userId: string,
    syncChangeId: string
  ): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const result = await database.query<{ current_version_id: string; id: string }>(
        `UPDATE encrypted_notes
         SET deleted_at = now(), updated_at = now()
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM workspace_members
             WHERE workspace_id = $1 AND user_id = $3 AND role = 'owner'
           )
         RETURNING id, current_version_id`,
        [workspaceId, noteId, userId]
      );
      const deleted = result.rows[0];
      if (!deleted) return false;
      await database.query(
        `INSERT INTO sync_changes (
           change_id, workspace_id, entity_type, entity_id, change_type, note_version_id,
           actor_user_id
         ) VALUES ($1, $2, 'note', $3, 'note.deleted', $4, $5)`,
        [syncChangeId, workspaceId, noteId, deleted.current_version_id, userId]
      );
      return true;
    });
  }
}
