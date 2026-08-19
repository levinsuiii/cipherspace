CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (btrim(email) <> '')
);

CREATE UNIQUE INDEX users_email_normalized_unique ON users (lower(email));

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  wrapped_workspace_key bytea,
  key_wrap_algorithm text,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_role_valid CHECK (role IN ('owner', 'member')),
  CONSTRAINT workspace_members_key_fields_paired CHECK (
    (wrapped_workspace_key IS NULL AND key_wrap_algorithm IS NULL)
    OR (wrapped_workspace_key IS NOT NULL AND key_wrap_algorithm IS NOT NULL)
  )
);

CREATE INDEX workspace_members_user_id_index ON workspace_members (user_id);

CREATE TABLE encrypted_notes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL REFERENCES users(id),
  encrypted_title bytea,
  encrypted_title_nonce bytea,
  current_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encrypted_notes_title_fields_paired CHECK (
    (encrypted_title IS NULL AND encrypted_title_nonce IS NULL)
    OR (encrypted_title IS NOT NULL AND encrypted_title_nonce IS NOT NULL)
  )
);

CREATE INDEX encrypted_notes_workspace_updated_index
  ON encrypted_notes (workspace_id, updated_at DESC);

CREATE TABLE note_versions (
  id uuid PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES encrypted_notes(id) ON DELETE CASCADE,
  version_number bigint NOT NULL,
  parent_version_id uuid,
  author_user_id uuid NOT NULL REFERENCES users(id),
  envelope_version smallint NOT NULL,
  encryption_algorithm text NOT NULL,
  encrypted_payload bytea NOT NULL,
  payload_nonce bytea NOT NULL,
  payload_key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_versions_version_positive CHECK (version_number > 0),
  CONSTRAINT note_versions_envelope_version_positive CHECK (envelope_version > 0),
  CONSTRAINT note_versions_encryption_algorithm_not_blank CHECK (btrim(encryption_algorithm) <> ''),
  CONSTRAINT note_versions_payload_key_id_not_blank CHECK (btrim(payload_key_id) <> ''),
  CONSTRAINT note_versions_note_version_unique UNIQUE (note_id, version_number),
  CONSTRAINT note_versions_id_note_unique UNIQUE (id, note_id),
  CONSTRAINT note_versions_parent_same_note FOREIGN KEY (parent_version_id, note_id)
    REFERENCES note_versions (id, note_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX note_versions_note_created_index
  ON note_versions (note_id, created_at DESC);

ALTER TABLE encrypted_notes
  ADD CONSTRAINT encrypted_notes_current_version_same_note
  FOREIGN KEY (current_version_id, id)
  REFERENCES note_versions (id, note_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sync_changes (
  sequence_number bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  change_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  change_type text NOT NULL,
  note_version_id uuid REFERENCES note_versions(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_changes_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
  CONSTRAINT sync_changes_change_type_not_blank CHECK (btrim(change_type) <> '')
);

CREATE INDEX sync_changes_workspace_sequence_index
  ON sync_changes (workspace_id, sequence_number);
