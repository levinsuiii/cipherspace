import type {
  EncryptedNote,
  EncryptedNoteDetail,
  NoteVersion,
  SyncPullResponse,
  SyncPushResult,
  Workspace
} from "../api/types";
import type { CipherSpaceLocalDatabase } from "./database";
import type {
  ConflictResolutionInput,
  LocalConflict,
  LocalNote,
  LocalNotePayload,
  LocalNoteVersion,
  LocalSyncMetadata,
  LocalWorkspace,
  PendingChange,
  PendingChangeOperation
} from "./types";

interface RepositoryOptions {
  createClientId?: () => string;
  createId?: () => string;
  now?: () => string;
}

const maxLocalBodyLength = 1_000_000;
const maxLocalTitleLength = 200;

function scopedKey(userId: string, id: string): string {
  return `${userId}:${id}`;
}

function isOutstandingChange(change: PendingChange): boolean {
  return change.status !== "resolved" && change.status !== "synced";
}

export class LocalNotesRepository {
  private readonly createId: () => string;
  private readonly createClientId: () => string;
  private readonly now: () => string;

  public constructor(
    private readonly database: CipherSpaceLocalDatabase,
    private readonly userId: string,
    options: RepositoryOptions = {}
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.createClientId = options.createClientId ?? (() => crypto.randomUUID());
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
      .filter(isOutstandingChange)
      .sort((left, right) =>
        left.created_at === right.created_at
          ? left.local_revision - right.local_revision
          : left.created_at.localeCompare(right.created_at)
      );
  }

  public async listRetryableChanges(workspaceId: string): Promise<PendingChange[]> {
    return (await this.listPendingChanges(workspaceId)).filter(
      (change) => change.status === "pending" || change.status === "failed"
    );
  }

  public async getSyncMetadata(workspaceId: string): Promise<LocalSyncMetadata> {
    const timestamp = this.now();
    await this.ensureSyncMetadata(workspaceId, timestamp);
    const metadata = await this.database.local_sync_metadata.get(
      scopedKey(this.userId, workspaceId)
    );
    if (!metadata) throw new Error("Local sync metadata could not be created.");
    return metadata;
  }

  public async storeEncryptedPayload(
    changeId: string,
    localRevision: number,
    encryptedPayload: PendingChange["encrypted_payload"]
  ): Promise<boolean> {
    return this.database.transaction("rw", this.database.pending_changes, async () => {
      const change = await this.database.pending_changes.get(changeId);
      if (
        !change ||
        change.user_id !== this.userId ||
        change.local_revision !== localRevision ||
        (change.status !== "pending" && change.status !== "failed")
      ) {
        return false;
      }
      await this.database.pending_changes.put({
        ...change,
        encrypted_payload: encryptedPayload,
        updated_at: this.now()
      });
      return true;
    });
  }

  public async beginSyncAttempt(changes: PendingChange[]): Promise<PendingChange[]> {
    const timestamp = this.now();
    return this.database.transaction("rw", this.database.pending_changes, async () => {
      const syncing: PendingChange[] = [];
      for (const candidate of changes) {
        const current = await this.database.pending_changes.get(candidate.id);
        if (
          !current ||
          current.user_id !== this.userId ||
          current.local_revision !== candidate.local_revision ||
          (current.status !== "pending" && current.status !== "failed")
        ) {
          continue;
        }
        const updated: PendingChange = {
          ...current,
          attempt_count: current.attempt_count + 1,
          last_attempt_at: timestamp,
          last_error: null,
          status: "syncing",
          updated_at: timestamp
        };
        await this.database.pending_changes.put(updated);
        syncing.push(updated);
      }
      return syncing;
    });
  }

  public async markSyncAttemptFailed(changes: PendingChange[], message: string): Promise<void> {
    const timestamp = this.now();
    await this.database.transaction(
      "rw",
      this.database.pending_changes,
      this.database.local_sync_metadata,
      async () => {
        for (const attempted of changes) {
          const current = await this.database.pending_changes.get(attempted.id);
          if (
            current?.user_id === this.userId &&
            current.local_revision === attempted.local_revision &&
            current.status === "syncing"
          ) {
            await this.database.pending_changes.put({
              ...current,
              last_error: message,
              status: "failed",
              updated_at: timestamp
            });
          }
        }
        await this.setSyncError(attemptedWorkspace(changes), message, timestamp);
      }
    );
  }

  public async applyPushResults(
    workspaceId: string,
    attempted: PendingChange[],
    results: SyncPushResult[]
  ): Promise<void> {
    const timestamp = this.now();
    const resultById = new Map(results.map((result) => [result.operationId, result]));
    await this.database.transaction(
      "rw",
      this.database.notes,
      this.database.note_versions,
      this.database.pending_changes,
      this.database.conflicts,
      async () => {
        for (const pushed of attempted) {
          const current = await this.database.pending_changes.get(pushed.id);
          if (!current || current.user_id !== this.userId) continue;
          const result = resultById.get(pushed.id);
          if (!result) {
            await this.failCurrentChange(current, "The server omitted this operation result.", timestamp);
            continue;
          }
          const duplicateAccepted =
            result.status === "duplicate" && result.originalStatus === "accepted";
          const duplicateConflict =
            result.status === "duplicate" && result.originalStatus === "conflict";

          if (result.status === "accepted" || duplicateAccepted) {
            const accepted = result as Extract<
              SyncPushResult,
              { status: "accepted" | "duplicate"; version: NoteVersion }
            >;
            await this.database.note_versions.put(
              this.toLocalVersion(workspaceId, accepted.version)
            );
            if (
              current.local_revision === pushed.local_revision &&
              current.status === "syncing"
            ) {
              await this.database.pending_changes.put({
                ...current,
                last_error: null,
                status: "synced",
                updated_at: timestamp
              });
            }
            await this.rebaseAcceptedDescendants(pushed, accepted.note, accepted.version.id);
            continue;
          }

          if (result.status === "conflict" || duplicateConflict) {
            const conflict = result as Extract<
              SyncPushResult,
              { remoteVersion: NoteVersion; status: "conflict" | "duplicate" }
            >;
            await this.recordConflict(current, conflict.remoteVersion, workspaceId, timestamp);
            const descendants = await this.database.pending_changes
              .where("[user_id+note_id]")
              .equals([this.userId, current.note_id])
              .toArray();
            for (const descendant of descendants) {
              if (
                descendant.id !== current.id &&
                descendant.local_revision > current.local_revision &&
                isOutstandingChange(descendant) &&
                descendant.status !== "conflict"
              ) {
                await this.recordConflict(
                  descendant,
                  conflict.remoteVersion,
                  workspaceId,
                  timestamp
                );
              }
            }
            continue;
          }

          await this.failCurrentChange(
            current,
            result.status === "rejected" ? result.errorCode : "invalid_sync_result",
            timestamp
          );
        }
      }
    );
  }

  public async applyPullResponse(response: SyncPullResponse): Promise<void> {
    const timestamp = this.now();
    await this.database.transaction(
      "rw",
      this.database.notes,
      this.database.note_versions,
      this.database.pending_changes,
      this.database.conflicts,
      this.database.local_sync_metadata,
      async () => {
        for (const change of response.changes) {
          const version = this.toLocalVersion(response.workspaceId, change.version);
          await this.database.note_versions.put(version);
          const pending = (
            await this.database.pending_changes
              .where("[user_id+note_id]")
              .equals([this.userId, change.note.id])
              .toArray()
          ).filter(isOutstandingChange);

          if (pending.length > 0) {
            for (const localChange of pending) {
              if (
                localChange.status !== "conflict" &&
                localChange.base_version_id !== change.version.id
              ) {
                await this.recordConflict(
                  localChange,
                  change.version,
                  response.workspaceId,
                  timestamp
                );
              }
            }
            await this.updateServerMetadataWithoutOverwritingLocal(change.note);
            continue;
          }

          await this.putRemoteNote(change.note, change.version.id);
        }

        const key = scopedKey(this.userId, response.workspaceId);
        const existing = await this.database.local_sync_metadata.get(key);
        await this.database.local_sync_metadata.put({
          client_id: existing?.client_id ?? this.createClientId(),
          key,
          last_pull_cursor: response.nextCursor,
          last_successful_sync_at: timestamp,
          last_sync_error: null,
          updated_at: timestamp,
          user_id: this.userId,
          workspace_id: response.workspaceId
        });
      }
    );
  }

  public async recordSyncFailure(workspaceId: string, message: string): Promise<void> {
    const timestamp = this.now();
    await this.database.transaction("rw", this.database.local_sync_metadata, async () => {
      await this.setSyncError(workspaceId, message, timestamp);
    });
  }

  public async countConflicts(workspaceId?: string): Promise<number> {
    const conflicts = workspaceId
      ? await this.database.conflicts
          .where("[user_id+workspace_id]")
          .equals([this.userId, workspaceId])
          .toArray()
      : await this.database.conflicts.where("user_id").equals(this.userId).toArray();
    return conflicts.filter((conflict) => conflict.status === "unresolved").length;
  }

  public async countConflictsForNote(noteId: string): Promise<number> {
    const conflicts = await this.database.conflicts
      .where("[user_id+note_id]")
      .equals([this.userId, noteId])
      .toArray();
    return conflicts.filter((conflict) => conflict.status === "unresolved").length;
  }

  public async listConflicts(workspaceId: string): Promise<LocalConflict[]> {
    const conflicts = await this.database.conflicts
      .where("[user_id+workspace_id]")
      .equals([this.userId, workspaceId])
      .toArray();
    return conflicts
      .filter((conflict) => conflict.status === "unresolved")
      .sort((left, right) =>
        right.remote_version.version_number - left.remote_version.version_number ||
        right.detected_at.localeCompare(left.detected_at)
      );
  }

  public async getUnresolvedConflictForNote(noteId: string): Promise<LocalConflict | null> {
    const conflicts = await this.database.conflicts
      .where("[user_id+note_id]")
      .equals([this.userId, noteId])
      .toArray();
    return conflicts
      .filter((conflict) => conflict.status === "unresolved")
      .sort((left, right) =>
        right.remote_version.version_number - left.remote_version.version_number ||
        right.detected_at.localeCompare(left.detected_at)
      )[0] ?? null;
  }

  public async resolveConflict(
    conflictId: string,
    resolution: ConflictResolutionInput
  ): Promise<PendingChange> {
    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.pending_changes,
      this.database.conflicts,
      this.database.local_sync_metadata,
      async () => {
        const conflict = await this.database.conflicts.get(scopedKey(this.userId, conflictId));
        if (!conflict || conflict.status !== "unresolved") {
          throw new Error("The conflict does not exist or has already been resolved.");
        }

        const latestConflict = await this.getUnresolvedConflictForNote(conflict.note_id);
        if (latestConflict?.id !== conflict.id) {
          throw new Error("Resolve the conflict against the latest cached server version.");
        }

        const note = await this.database.notes.get(scopedKey(this.userId, conflict.note_id));
        if (!note || note.workspace_id !== conflict.workspace_id) {
          throw new Error("The conflicted local note could not be found.");
        }

        const resolvedPayload = resolution.action === "keep_local"
          ? note.local_note_payload ?? conflict.local_note_payload
          : resolution.action === "accept_remote"
            ? resolution.remote_payload
            : resolution.merged_payload;
        if (!resolvedPayload) {
          throw new Error("This conflict does not contain editable local note content.");
        }
        this.validateLocalPayload(resolvedPayload);

        const timestamp = this.now();
        const pending = await this.database.pending_changes
          .where("[user_id+note_id]")
          .equals([this.userId, conflict.note_id])
          .toArray();
        const nextRevision = Math.max(
          note.local_revision,
          ...pending.map((change) => change.local_revision)
        ) + 1;
        const resolvedNote: LocalNote = {
          ...note,
          base_version_id: conflict.remote_version.id,
          deleted_at: null,
          local_note_payload: { ...resolvedPayload },
          local_revision: nextRevision,
          updated_at: timestamp
        };
        await this.database.notes.put(resolvedNote);

        for (const change of pending) {
          if (!isOutstandingChange(change)) continue;
          await this.database.pending_changes.put({
            ...change,
            last_error: null,
            status: "resolved",
            updated_at: timestamp
          });
        }

        const resolvedChange = this.newPendingChange(
          "update_note",
          resolvedNote,
          resolvedPayload,
          timestamp
        );
        await this.database.pending_changes.add(resolvedChange);

        const noteConflicts = await this.database.conflicts
          .where("[user_id+note_id]")
          .equals([this.userId, conflict.note_id])
          .toArray();
        for (const noteConflict of noteConflicts) {
          if (noteConflict.status !== "unresolved") continue;
          await this.database.conflicts.put({
            ...noteConflict,
            resolution: resolution.action,
            resolution_pending_change_id: resolvedChange.id,
            resolved_at: timestamp,
            resolved_note_payload: { ...resolvedPayload },
            status: "resolved"
          });
        }

        const metadataKey = scopedKey(this.userId, conflict.workspace_id);
        const metadata = await this.database.local_sync_metadata.get(metadataKey);
        await this.database.local_sync_metadata.put({
          client_id: metadata?.client_id ?? this.createClientId(),
          key: metadataKey,
          last_pull_cursor: metadata?.last_pull_cursor ?? null,
          last_successful_sync_at: metadata?.last_successful_sync_at ?? null,
          last_sync_error: null,
          updated_at: timestamp,
          user_id: this.userId,
          workspace_id: conflict.workspace_id
        });

        return resolvedChange;
      }
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
    return changes.filter(isOutstandingChange).length;
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
      client_id: this.createClientId(),
      key,
      last_pull_cursor: null,
      last_sync_error: null,
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
      attempt_count: 0,
      base_version_id: note.base_version_id,
      created_at: timestamp,
      encrypted_payload: null,
      id: this.createId(),
      last_attempt_at: null,
      last_error: null,
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
      encrypted_payload: null,
      local_note_payload: payload ? { ...payload } : null,
      local_revision: note.local_revision,
      status: "pending",
      last_error: null,
      updated_at: timestamp
    });
  }

  private toLocalVersion(workspaceId: string, version: NoteVersion): LocalNoteVersion {
    return {
      client_version: version.clientVersion,
      content_nonce: version.contentNonce,
      created_at: version.createdAt,
      created_by: version.createdBy,
      encrypted_content: version.encryptedContent,
      encryption_algorithm: version.encryptionMetadata.algorithm,
      envelope_version: version.encryptionMetadata.envelopeVersion,
      id: version.id,
      key: scopedKey(this.userId, version.id),
      key_id: version.encryptionMetadata.keyId,
      note_id: version.noteId,
      parent_version_id: version.parentVersionId,
      user_id: this.userId,
      version_number: version.versionNumber,
      workspace_id: workspaceId
    };
  }

  private async failCurrentChange(
    change: PendingChange,
    message: string,
    timestamp: string
  ): Promise<void> {
    if (change.status !== "syncing") return;
    await this.database.pending_changes.put({
      ...change,
      last_error: message,
      status: "failed",
      updated_at: timestamp
    });
  }

  private async recordConflict(
    change: PendingChange,
    remoteVersion: NoteVersion,
    workspaceId: string,
    timestamp: string
  ): Promise<void> {
    const baseVersion = change.base_version_id
      ? await this.database.note_versions.get(scopedKey(this.userId, change.base_version_id))
      : undefined;
    const remote = this.toLocalVersion(workspaceId, remoteVersion);
    await this.database.note_versions.put(remote);
    const id = `${change.id}:${remoteVersion.id}`;
    await this.database.conflicts.put({
      base_version: baseVersion ?? null,
      base_version_id: change.base_version_id,
      detected_at: timestamp,
      id,
      key: scopedKey(this.userId, id),
      local_encrypted_payload: change.encrypted_payload,
      local_note_payload: change.local_note_payload
        ? { ...change.local_note_payload }
        : null,
      local_revision: change.local_revision,
      note_id: change.note_id,
      pending_change_id: change.id,
      remote_version: remote,
      resolution: null,
      resolution_pending_change_id: null,
      resolved_at: null,
      resolved_note_payload: null,
      status: "unresolved",
      user_id: this.userId,
      workspace_id: workspaceId
    });
    const current = await this.database.pending_changes.get(change.id);
    if (current && isOutstandingChange(current)) {
      await this.database.pending_changes.put({
        ...current,
        last_error: "version_conflict",
        status: "conflict",
        updated_at: timestamp
      });
    }
  }

  private async rebaseAcceptedDescendants(
    pushed: PendingChange,
    note: EncryptedNote,
    acceptedVersionId: string
  ): Promise<void> {
    const localNote = await this.database.notes.get(scopedKey(this.userId, pushed.note_id));
    if (localNote) {
      await this.database.notes.put({
        ...localNote,
        base_version_id: acceptedVersionId,
        created_by: note.createdBy,
        encrypted_title: note.encryptedTitle,
        encrypted_title_nonce: note.encryptedTitleNonce,
        server_updated_at: note.updatedAt
      });
    }
    const descendants = await this.database.pending_changes
      .where("[user_id+note_id]")
      .equals([this.userId, pushed.note_id])
      .toArray();
    for (const descendant of descendants) {
      if (
        descendant.id !== pushed.id &&
        isOutstandingChange(descendant) &&
        descendant.local_revision > pushed.local_revision &&
        descendant.base_version_id === pushed.base_version_id
      ) {
        await this.database.pending_changes.put({
          ...descendant,
          base_version_id: acceptedVersionId,
          updated_at: this.now()
        });
      }
    }
  }

  private async updateServerMetadataWithoutOverwritingLocal(note: EncryptedNote): Promise<void> {
    const key = scopedKey(this.userId, note.id);
    const local = await this.database.notes.get(key);
    if (!local) return;
    await this.database.notes.put({
      ...local,
      created_by: note.createdBy,
      encrypted_title: note.encryptedTitle,
      encrypted_title_nonce: note.encryptedTitleNonce,
      server_updated_at: note.updatedAt
    });
  }

  private async putRemoteNote(note: EncryptedNote, versionId: string): Promise<void> {
    const key = scopedKey(this.userId, note.id);
    const existing = await this.database.notes.get(key);
    await this.database.notes.put({
      base_version_id: versionId,
      created_at: existing?.created_at ?? note.createdAt,
      created_by: note.createdBy,
      deleted_at: note.deletedAt,
      encrypted_title: note.encryptedTitle,
      encrypted_title_nonce: note.encryptedTitleNonce,
      id: note.id,
      key,
      local_note_payload: existing?.local_note_payload ?? null,
      local_revision: existing?.local_revision ?? 0,
      server_updated_at: note.updatedAt,
      updated_at: note.updatedAt,
      user_id: this.userId,
      workspace_id: note.workspaceId
    });
  }

  private async setSyncError(
    workspaceId: string | undefined,
    message: string,
    timestamp: string
  ): Promise<void> {
    if (!workspaceId) return;
    const key = scopedKey(this.userId, workspaceId);
    const existing = await this.database.local_sync_metadata.get(key);
    await this.database.local_sync_metadata.put({
      client_id: existing?.client_id ?? this.createClientId(),
      key,
      last_pull_cursor: existing?.last_pull_cursor ?? null,
      last_successful_sync_at: existing?.last_successful_sync_at ?? null,
      last_sync_error: message,
      updated_at: timestamp,
      user_id: this.userId,
      workspace_id: workspaceId
    });
  }
}

function attemptedWorkspace(changes: PendingChange[]): string | undefined {
  return changes[0]?.workspace_id;
}
