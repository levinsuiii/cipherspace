import type { WorkspaceRole } from "../api/types";
import type {
  EncryptedNotePayload,
  LocalUserCryptoIdentity,
  ProtectedWorkspaceKey
} from "@cipherspace/crypto";

export type PendingChangeOperation = "create_note" | "update_note" | "delete_note";
export type PendingChangeStatus =
  | "conflict"
  | "failed"
  | "pending"
  | "resolved"
  | "synced"
  | "syncing";
export type ConflictResolution = "accept_remote" | "keep_local" | "manual_merge";

export interface LocalNotePayload {
  body: string;
  title: string;
}

export interface LegacyPlaintextInspection {
  conflicts: number;
  notes: number;
  pendingChanges: number;
  totalRecords: number;
}

export interface LocalWorkspace {
  cached_at: string;
  created_at: string;
  id: string;
  key: string;
  name: string;
  role: WorkspaceRole;
  updated_at: string;
  user_id: string;
}

export interface LocalNote {
  base_version_id: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  encrypted_title: string | null;
  encrypted_title_nonce: string | null;
  id: string;
  key: string;
  local_encrypted_payload: EncryptedNotePayload | null;
  local_note_payload: LocalNotePayload | null;
  local_revision: number;
  server_updated_at: string | null;
  updated_at: string;
  user_id: string;
  workspace_id: string;
}

export interface LocalNoteVersion {
  client_version: string | null;
  content_nonce: string;
  created_at: string;
  created_by: string;
  encrypted_content: string;
  encryption_algorithm: string;
  envelope_version: number;
  id: string;
  key: string;
  key_id: string;
  note_id: string;
  parent_version_id: string | null;
  user_id: string;
  version_number: number;
  workspace_id: string;
}

export interface PendingChange {
  attempt_count: number;
  base_version_id: string | null;
  created_at: string;
  encrypted_payload: EncryptedNotePayload | null;
  id: string;
  last_attempt_at: string | null;
  last_error: string | null;
  local_note_payload: LocalNotePayload | null;
  local_revision: number;
  note_id: string;
  operation_type: PendingChangeOperation;
  status: PendingChangeStatus;
  updated_at: string;
  user_id: string;
  workspace_id: string;
}

export interface LocalSyncMetadata {
  client_id: string;
  key: string;
  last_pull_cursor: string | null;
  last_sync_error: string | null;
  last_successful_sync_at: string | null;
  updated_at: string;
  user_id: string;
  workspace_id: string;
}

export interface LocalConflict {
  base_version: LocalNoteVersion | null;
  base_version_id: string | null;
  detected_at: string;
  id: string;
  key: string;
  local_encrypted_payload: EncryptedNotePayload | null;
  local_note_payload: LocalNotePayload | null;
  local_revision: number;
  note_id: string;
  pending_change_id: string;
  remote_version: LocalNoteVersion;
  resolution: ConflictResolution | null;
  resolution_pending_change_id: string | null;
  resolved_at: string | null;
  resolved_encrypted_payload: EncryptedNotePayload | null;
  resolved_note_payload: LocalNotePayload | null;
  status: "resolved" | "unresolved";
  user_id: string;
  workspace_id: string;
}

export type ConflictResolutionInput =
  | { action: "keep_local" }
  | { action: "accept_remote"; remote_payload: LocalNotePayload }
  | { action: "manual_merge"; merged_payload: LocalNotePayload };

export interface LocalProtectedWorkspaceKey {
  created_at: string;
  key: string;
  protected_key: ProtectedWorkspaceKey;
  updated_at: string;
  user_id: string;
  workspace_id: string;
}

export interface LocalStoredUserCryptoIdentity extends LocalUserCryptoIdentity {
  created_at: string;
  key: string;
  updated_at: string;
  user_id: string;
}
