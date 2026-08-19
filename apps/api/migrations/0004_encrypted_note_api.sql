ALTER TABLE note_versions
  ADD COLUMN client_version text,
  ADD CONSTRAINT note_versions_client_version_not_blank
    CHECK (client_version IS NULL OR btrim(client_version) <> ''),
  ADD CONSTRAINT note_versions_client_version_length
    CHECK (client_version IS NULL OR char_length(client_version) <= 255);

CREATE INDEX encrypted_notes_active_workspace_updated_index
  ON encrypted_notes (workspace_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;
