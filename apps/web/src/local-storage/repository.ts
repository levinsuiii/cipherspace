import type { EncryptedNote, EncryptedNoteDetail, Workspace } from "../api/types";
import type { CipherSpaceLocalDatabase } from "./database";
import type {
  LocalNote,
  LocalNotePayload,
  LocalNoteVersion,
  LocalSyncMetadata,
  LocalWorkspace,
  PendingChange,
  PendingChangeOperation
} from "./types";

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
}

const maxLocalBodyLength = 1_000_000;
const maxLocalTitleLength = 200;

function scopedKey(userId: string, id: string): string {
  return `${userId}:${id}`;
}

export class LocalNotesRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  public constructor(
    private readonly database: CipherSpaceLocalDatabase,
    private readonly userId: string,
    options: RepositoryOptions = {}
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async cacheWorkspace(workspace: Workspace): Promise<void> {
    const cachedAt = this.now();
    await this.database.transaction(
      "rw",
      this.database.workspaces,
      this.database.local_sync_metadata,
      async () => {
        await this.database.workspaces.put(this.toLocalWorkspace(workspace, cachedAt));
        await this.ensureSyncMetadata(workspace.id, cachedAt);
      }
    );
  }

  public async cacheWorkspaces(workspaces: Workspace[]): Promise<void> {
    const cachedAt = this.now();
    await this.database.transaction(
      "rw",
      this.database.workspaces,
      this.database.local_sync_metadata,
      async () => {
        await this.database.workspaces.bulkPut(
          workspaces.map((workspace) => this.toLocalWorkspace(workspace, cachedAt))
        );
        for (const workspace of workspaces) {
          await this.ensureSyncMetadata(workspace.id, cachedAt);
        }
      }
    );
  }

  public async getWorkspace(workspaceId: string): Promise<LocalWorkspace | undefined> {
    return this.database.workspaces.get(scopedKey(this.userId, workspaceId));
  }

  public async listWorkspaces(): Promise<LocalWorkspace[]> {
    const workspaces = await this.database.workspaces.where("user_id").equals(this.userId).toArray();
    return workspaces.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  public async cacheServerNotes(workspaceId: string, notes: EncryptedNote[]): Promise<void> {
    await this.database.transaction("rw", this.database.notes, async () => {
      for (const note of notes) {
        await this.cacheServerNote(workspaceId, note);
      }
    });
  }

  public async cacheServerNoteDetail(detail: EncryptedNoteDetail): Promise<void> {
    const { latestVersion, note } = detail;
    await this.database.transaction(
      "rw",
      this.database.notes,
      this.database.note_versions,
      async () => {
        await this.cacheServerNote(note.workspaceId, note);
        const version: LocalNoteVersion = {
          client_version: latestVersion.clientVersion,
          content_nonce: latestVersion.contentNonce,
          created_at: latestVersion.createdAt,
          created_by: latestVersion.createdBy,
          encrypted_content: latestVersion.encryptedContent,
          encryption_algorithm: latestVersion.encryptionMetadata.algorithm,
          envelope_version: latestVersion.encryptionMetadata.envelopeVersion,
          id: latestVersion.id,
          key: scopedKey(this.userId, latestVersion.id),
          key_id: latestVersion.encryptionMetadata.keyId,
          note_id: latestVersion.noteId,
          parent_version_id: latestVersion.parentVersionId,
          user_id: this.userId,
          version_number: latestVersion.versionNumber,
          workspace_id: note.workspaceId
        };
        await this.database.note_versions.put(version);
      }
    );
  }

  public async createNote(workspaceId: string, payload: LocalNotePayload): Promise<LocalNote> {
    this.validateLocalPayload(payload);
    const timestamp = this.now();
    const noteId = this.createId();
    const note: LocalNote = {
      base_version_id: null,
      created_at: timestamp,
      created_by: this.userId,
      deleted_at: null,
      encrypted_title: null,
      encrypted_title_nonce: null,
      id: noteId,
      key: scopedKey(this.userId, noteId),
      local_note_payload: { ...payload },
      local_revision: 1,
      server_updated_at: null,
      updated_at: timestamp,
      user_id: this.userId,
      workspace_id: workspaceId
    };

    await this.database.transaction(
      "rw",
      this.database.notes,
      this.database.pending_changes,
      this.database.local_sync_metadata,
      async () => {
        await this.database.notes.add(note);
        await this.database.pending_changes.add(
          this.newPendingChange("create_note", note, payload, timestamp)
        );
        await this.ensureSyncMetadata(workspaceId, timestamp);
      }
    );

    return note;
  }

  public async editNote(noteId: string, payload: LocalNotePayload): Promise<LocalNote> {
    this.validateLocalPayload(payload);
    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.pending_changes,
      async () => {
        const note = await this.requireActiveNote(noteId);
        const timestamp = this.now();
        const updatedNote: LocalNote = {
          ...note,
          local_note_payload: { ...payload },
          local_revision: note.local_revision + 1,
          updated_at: timestamp
        };
        await this.database.notes.put(updatedNote);
        await this.upsertPendingChange("update_note", updatedNote, payload, timestamp);
        return updatedNote;
      }
    );
  }

  public async deleteNote(noteId: string): Promise<LocalNote> {
    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.pending_changes,
      async () => {
        const note = await this.requireActiveNote(noteId);
        const timestamp = this.now();
        const deletedNote: LocalNote = {
          ...note,
          deleted_at: timestamp,
          local_revision: note.local_revision + 1,
          updated_at: timestamp
        };
        await this.database.notes.put(deletedNote);
        await this.upsertPendingChange("delete_note", deletedNote, null, timestamp);
        return deletedNote;
      }
    );
  }

  public async getNote(noteId: string): Promise<LocalNote | undefined> {
    return this.database.notes.get(scopedKey(this.userId, noteId));
  }

  public async listNotes(workspaceId: string): Promise<LocalNote[]> {
    const notes = await this.database.notes
      .where("[user_id+workspace_id]")
      .equals([this.userId, workspaceId])
      .toArray();
    return notes
      .filter((note) => note.deleted_at === null)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  public async getLatestVersion(noteId: string): Promise<LocalNoteVersion | undefined> {
    const versions = await this.database.note_versions
      .where("[user_id+note_id]")
      .equals([this.userId, noteId])
      .toArray();
    return versions.sort((left, right) => right.version_number - left.version_number)[0];
  }

  public async listPendingChanges(workspaceId?: string): Promise<PendingChange[]> {
    const changes = workspaceId
      ? await this.database.pending_changes
          .where("[user_id+workspace_id]")
          .equals([this.userId, workspaceId])
          .toArray()
      : await this.database.pending_changes.where("user_id").equals(this.userId).toArray();
    return changes
      .filter((change) => change.status !== "synced")
      .sort((left, right) =>
        left.created_at === right.created_at
          ? left.local_revision - right.local_revision
          : left.created_at.localeCompare(right.created_at)
      );
  }

  public async countPendingChanges(workspaceId?: string): Promise<number> {
    return (await this.listPendingChanges(workspaceId)).length;
  }

  public async countPendingChangesForNote(noteId: string): Promise<number> {
    const changes = await this.database.pending_changes
      .where("[user_id+note_id]")
      .equals([this.userId, noteId])
      .toArray();
    return changes.filter((change) => change.status !== "synced").length;
  }

  private async cacheServerNote(workspaceId: string, note: EncryptedNote): Promise<void> {
    if (note.workspaceId !== workspaceId) {
      throw new Error("The server note does not belong to the requested workspace.");
    }
    const key = scopedKey(this.userId, note.id);
    const existing = await this.database.notes.get(key);
    const hasLocalChanges = Boolean(existing?.local_revision);
    await this.database.notes.put({
      base_version_id: hasLocalChanges ? existing?.base_version_id ?? null : note.latestVersionId,
      created_at: existing?.created_at ?? note.createdAt,
      created_by: note.createdBy,
      deleted_at: hasLocalChanges ? existing?.deleted_at ?? null : note.deletedAt,
      encrypted_title: note.encryptedTitle,
      encrypted_title_nonce: note.encryptedTitleNonce,
      id: note.id,
      key,
      local_note_payload: existing?.local_note_payload ?? null,
      local_revision: existing?.local_revision ?? 0,
      server_updated_at: note.updatedAt,
      updated_at: hasLocalChanges ? existing?.updated_at ?? note.updatedAt : note.updatedAt,
      user_id: this.userId,
      workspace_id: workspaceId
    });
  }

  private async ensureSyncMetadata(workspaceId: string, timestamp: string): Promise<void> {
    const key = scopedKey(this.userId, workspaceId);
    const existing = await this.database.local_sync_metadata.get(key);
    if (existing) return;

    const metadata: LocalSyncMetadata = {
      key,
      last_pull_cursor: null,
      last_successful_sync_at: null,
      updated_at: timestamp,
      user_id: this.userId,
      workspace_id: workspaceId
    };
    await this.database.local_sync_metadata.add(metadata);
  }

  private newPendingChange(
    operationType: PendingChangeOperation,
    note: LocalNote,
    payload: LocalNotePayload | null,
    timestamp: string
  ): PendingChange {
    return {
      base_version_id: note.base_version_id,
      created_at: timestamp,
      encrypted_payload: null,
      id: this.createId(),
      local_note_payload: payload ? { ...payload } : null,
      local_revision: note.local_revision,
      note_id: note.id,
      operation_type: operationType,
      status: "pending",
      updated_at: timestamp,
      user_id: this.userId,
      workspace_id: note.workspace_id
    };
  }

  private async requireActiveNote(noteId: string): Promise<LocalNote> {
    const note = await this.getNote(noteId);
    if (!note || note.deleted_at) {
      throw new Error("The local note does not exist or has been deleted.");
    }
    return note;
  }

  private toLocalWorkspace(workspace: Workspace, cachedAt: string): LocalWorkspace {
    return {
      cached_at: cachedAt,
      created_at: workspace.createdAt,
      id: workspace.id,
      key: scopedKey(this.userId, workspace.id),
      name: workspace.name,
      role: workspace.role,
      updated_at: workspace.updatedAt,
      user_id: this.userId
    };
  }

  private validateLocalPayload(payload: LocalNotePayload): void {
    if (
      typeof payload.title !== "string" ||
      !payload.title.trim() ||
      payload.title.length > maxLocalTitleLength
    ) {
      throw new Error(`Local note titles must contain 1 to ${maxLocalTitleLength} characters.`);
    }
    if (typeof payload.body !== "string" || payload.body.length > maxLocalBodyLength) {
      throw new Error(`Local note bodies must not exceed ${maxLocalBodyLength} characters.`);
    }
  }

  private async upsertPendingChange(
    operationType: "update_note" | "delete_note",
    note: LocalNote,
    payload: LocalNotePayload | null,
    timestamp: string
  ): Promise<void> {
    const existing = await this.database.pending_changes
      .where("[user_id+note_id]")
      .equals([this.userId, note.id])
      .filter(
        (change) =>
          change.operation_type === operationType &&
          (change.status === "pending" || change.status === "failed")
      )
      .first();

    if (!existing) {
      await this.database.pending_changes.add(
        this.newPendingChange(operationType, note, payload, timestamp)
      );
      return;
    }

    await this.database.pending_changes.put({
      ...existing,
      base_version_id: note.base_version_id,
      local_note_payload: payload ? { ...payload } : null,
      local_revision: note.local_revision,
      status: "pending",
      updated_at: timestamp
    });
  }
}
