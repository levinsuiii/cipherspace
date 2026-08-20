import Dexie, { type EntityTable } from "dexie";

import type {
  LocalNote,
  LocalConflict,
  LocalNoteVersion,
  LocalProtectedWorkspaceKey,
  LocalSyncMetadata,
  LocalWorkspace,
  PendingChange
} from "./types";

export class CipherSpaceLocalDatabase extends Dexie {
  conflicts!: EntityTable<LocalConflict, "key">;
  local_sync_metadata!: EntityTable<LocalSyncMetadata, "key">;
  note_versions!: EntityTable<LocalNoteVersion, "key">;
  notes!: EntityTable<LocalNote, "key">;
  pending_changes!: EntityTable<PendingChange, "id">;
  workspace_keys!: EntityTable<LocalProtectedWorkspaceKey, "key">;
  workspaces!: EntityTable<LocalWorkspace, "key">;

  public constructor(name = "cipherspace-local") {
    super(name);

    this.version(1).stores({
      local_sync_metadata: "key, user_id, workspace_id, [user_id+workspace_id]",
      note_versions:
        "key, user_id, workspace_id, note_id, id, [user_id+note_id], [user_id+workspace_id]",
      notes:
        "key, user_id, workspace_id, id, [user_id+id], [user_id+workspace_id]",
      pending_changes:
        "id, user_id, workspace_id, note_id, operation_type, status, [user_id+note_id], [user_id+workspace_id], [user_id+status]",
      workspaces: "key, user_id, id, [user_id+id]"
    });

    this.version(2)
      .stores({
        conflicts:
          "key, id, user_id, workspace_id, note_id, pending_change_id, status, [user_id+workspace_id], [user_id+note_id]",
        local_sync_metadata: "key, user_id, workspace_id, [user_id+workspace_id]",
        note_versions:
          "key, user_id, workspace_id, note_id, id, [user_id+note_id], [user_id+workspace_id]",
        notes:
          "key, user_id, workspace_id, id, [user_id+id], [user_id+workspace_id]",
        pending_changes:
          "id, user_id, workspace_id, note_id, operation_type, status, [user_id+note_id], [user_id+workspace_id], [user_id+status]",
        workspaces: "key, user_id, id, [user_id+id]"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<PendingChange, string>("pending_changes")
          .toCollection()
          .modify((change) => {
            change.attempt_count = 0;
            change.last_attempt_at = null;
            change.last_error = null;
          });
        await transaction
          .table<LocalSyncMetadata, string>("local_sync_metadata")
          .toCollection()
          .modify((metadata) => {
            metadata.client_id = crypto.randomUUID();
            metadata.last_sync_error = null;
          });
      });

    this.version(3).stores({
      conflicts:
        "key, id, user_id, workspace_id, note_id, pending_change_id, status, [user_id+workspace_id], [user_id+note_id]",
      local_sync_metadata: "key, user_id, workspace_id, [user_id+workspace_id]",
      note_versions:
        "key, user_id, workspace_id, note_id, id, [user_id+note_id], [user_id+workspace_id]",
      notes:
        "key, user_id, workspace_id, id, [user_id+id], [user_id+workspace_id]",
      pending_changes:
        "id, user_id, workspace_id, note_id, operation_type, status, [user_id+note_id], [user_id+workspace_id], [user_id+status]",
      workspace_keys: "key, user_id, workspace_id, [user_id+workspace_id]",
      workspaces: "key, user_id, id, [user_id+id]"
    });
  }
}

export const localDatabase = new CipherSpaceLocalDatabase();
