CREATE TABLE sync_operations (
  operation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES encrypted_notes(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  base_version_id uuid,
  client_revision bigint NOT NULL,
  request_hash text NOT NULL,
  outcome text NOT NULL,
  resulting_version_id uuid REFERENCES note_versions(id) ON DELETE SET NULL,
  conflict_version_id uuid REFERENCES note_versions(id) ON DELETE SET NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_operations_operation_type_valid
    CHECK (operation_type IN ('create_note', 'update_note', 'delete_note')),
  CONSTRAINT sync_operations_client_revision_positive CHECK (client_revision > 0),
  CONSTRAINT sync_operations_request_hash_valid CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sync_operations_outcome_valid CHECK (outcome IN ('accepted', 'conflict')),
  CONSTRAINT sync_operations_result_valid CHECK (
    (outcome = 'accepted' AND resulting_version_id IS NOT NULL AND conflict_version_id IS NULL)
    OR (outcome = 'conflict' AND resulting_version_id IS NULL AND conflict_version_id IS NOT NULL)
  )
);

CREATE INDEX sync_operations_workspace_processed_index
  ON sync_operations (workspace_id, processed_at DESC);

CREATE INDEX sync_operations_note_index ON sync_operations (note_id);
