import Dexie, { type EntityTable } from "dexie";

import type {
  LocalNote,
  LocalNoteVersion,
  LocalSyncMetadata,
  LocalWorkspace,
  PendingChange
} from "./types";

export class CipherSpaceLocalDatabase extends Dexie {
  local_sync_metadata!: EntityTable<LocalSyncMetadata, "key">;
  note_versions!: EntityTable<LocalNoteVersion, "key">;
  notes!: EntityTable<LocalNote, "key">;
  pending_changes!: EntityTable<PendingChange, "id">;
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
  }
}

export const localDatabase = new CipherSpaceLocalDatabase();
