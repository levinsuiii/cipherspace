import Dexie, { type EntityTable } from "dexie";

import type {
  LocalNote,
  LocalConflict,
  LocalNoteVersion,
  LocalProtectedWorkspaceKey,
  LocalSyncMetadata,
  LocalStoredUserCryptoIdentity,
  LocalIdentityPin,
  LocalAcceptedKeyShare,
  LocalWorkspace,
  PendingChange
} from "./types";

export class CipherSpaceLocalDatabase extends Dexie {
  accepted_key_shares!: EntityTable<LocalAcceptedKeyShare, "key">;
  conflicts!: EntityTable<LocalConflict, "key">;
  identity_pins!: EntityTable<LocalIdentityPin, "key">;
  local_sync_metadata!: EntityTable<LocalSyncMetadata, "key">;
  note_versions!: EntityTable<LocalNoteVersion, "key">;
  notes!: EntityTable<LocalNote, "key">;
  pending_changes!: EntityTable<PendingChange, "id">;
  user_crypto_identities!: EntityTable<LocalStoredUserCryptoIdentity, "key">;
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

    this.version(4)
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
        workspace_keys: "key, user_id, workspace_id, [user_id+workspace_id]",
        workspaces: "key, user_id, id, [user_id+id]"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<LocalConflict, string>("conflicts")
          .toCollection()
          .modify((conflict) => {
            conflict.resolution = null;
            conflict.resolution_pending_change_id = null;
            conflict.resolved_at = null;
            conflict.resolved_note_payload = null;
          });
      });

    this.version(5)
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
        workspace_keys: "key, user_id, workspace_id, [user_id+workspace_id]",
        workspaces: "key, user_id, id, [user_id+id]"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<LocalNote, string>("notes")
          .toCollection()
          .modify((note) => {
            note.local_encrypted_payload = null;
          });
        await transaction
          .table<LocalConflict, string>("conflicts")
          .toCollection()
          .modify((conflict) => {
            conflict.resolved_encrypted_payload = null;
          });
      });

    this.version(6).stores({
      conflicts:
        "key, id, user_id, workspace_id, note_id, pending_change_id, status, [user_id+workspace_id], [user_id+note_id]",
      local_sync_metadata: "key, user_id, workspace_id, [user_id+workspace_id]",
      note_versions:
        "key, user_id, workspace_id, note_id, id, [user_id+note_id], [user_id+workspace_id]",
      notes:
        "key, user_id, workspace_id, id, [user_id+id], [user_id+workspace_id]",
      pending_changes:
        "id, user_id, workspace_id, note_id, operation_type, status, [user_id+note_id], [user_id+workspace_id], [user_id+status]",
      user_crypto_identities: "key, user_id",
      workspace_keys: "key, user_id, workspace_id, [user_id+workspace_id]",
      workspaces: "key, user_id, id, [user_id+id]"
    });

    this.version(7).stores({
      accepted_key_shares: "key, user_id, workspace_id, operation_id, [user_id+workspace_id]",
      conflicts:
        "key, id, user_id, workspace_id, note_id, pending_change_id, status, [user_id+workspace_id], [user_id+note_id]",
      identity_pins: "key, verifier_user_id, subject_user_id, [verifier_user_id+subject_user_id], status",
      local_sync_metadata: "key, user_id, workspace_id, [user_id+workspace_id]",
      note_versions:
        "key, user_id, workspace_id, note_id, id, [user_id+note_id], [user_id+workspace_id]",
      notes:
        "key, user_id, workspace_id, id, [user_id+id], [user_id+workspace_id]",
      pending_changes:
        "id, user_id, workspace_id, note_id, operation_type, status, [user_id+note_id], [user_id+workspace_id], [user_id+status]",
      user_crypto_identities: "key, user_id",
      workspace_keys: "key, user_id, workspace_id, [user_id+workspace_id]",
      workspaces: "key, user_id, id, [user_id+id]"
    });

    this.version(8).stores({
      accepted_key_shares: "key, user_id, workspace_id, operation_id, [user_id+workspace_id]",
      conflicts:
        "key, id, user_id, workspace_id, note_id, pending_change_id, status, [user_id+workspace_id], [user_id+note_id]",
      identity_pins:
        "key, verifier_user_id, subject_user_id, [verifier_user_id+subject_user_id], &[verifier_user_id+verified_contact_email], status",
      local_sync_metadata: "key, user_id, workspace_id, [user_id+workspace_id]",
      note_versions:
        "key, user_id, workspace_id, note_id, id, [user_id+note_id], [user_id+workspace_id]",
      notes:
        "key, user_id, workspace_id, id, [user_id+id], [user_id+workspace_id]",
      pending_changes:
        "id, user_id, workspace_id, note_id, operation_type, status, [user_id+note_id], [user_id+workspace_id], [user_id+status]",
      user_crypto_identities: "key, user_id",
      workspace_keys: "key, user_id, workspace_id, [user_id+workspace_id]",
      workspaces: "key, user_id, id, [user_id+id]"
    });
  }
}

export const localDatabase = new CipherSpaceLocalDatabase();
