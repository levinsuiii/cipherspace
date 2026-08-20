ALTER TABLE encrypted_notes
  ADD CONSTRAINT encrypted_notes_id_workspace_unique UNIQUE (id, workspace_id);

CREATE TABLE encrypted_comments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  note_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id),
  parent_comment_id uuid,
  encrypted_content bytea,
  content_nonce bytea,
  envelope_version smallint,
  encryption_algorithm text,
  content_key_id text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encrypted_comments_id_note_unique UNIQUE (id, note_id),
  CONSTRAINT encrypted_comments_note_workspace_foreign
    FOREIGN KEY (note_id, workspace_id)
    REFERENCES encrypted_notes (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT encrypted_comments_parent_same_note
    FOREIGN KEY (parent_comment_id, note_id)
    REFERENCES encrypted_comments (id, note_id),
  CONSTRAINT encrypted_comments_envelope_version_positive
    CHECK (envelope_version IS NULL OR envelope_version > 0),
  CONSTRAINT encrypted_comments_algorithm_not_blank
    CHECK (encryption_algorithm IS NULL OR btrim(encryption_algorithm) <> ''),
  CONSTRAINT encrypted_comments_key_id_not_blank
    CHECK (content_key_id IS NULL OR btrim(content_key_id) <> ''),
  CONSTRAINT encrypted_comments_content_lifecycle_valid CHECK (
    (
      deleted_at IS NULL
      AND encrypted_content IS NOT NULL
      AND content_nonce IS NOT NULL
      AND envelope_version IS NOT NULL
      AND encryption_algorithm IS NOT NULL
      AND content_key_id IS NOT NULL
    )
    OR
    (
      deleted_at IS NOT NULL
      AND encrypted_content IS NULL
      AND content_nonce IS NULL
      AND envelope_version IS NULL
      AND encryption_algorithm IS NULL
      AND content_key_id IS NULL
    )
  )
);

CREATE INDEX encrypted_comments_note_created_index
  ON encrypted_comments (note_id, created_at ASC, id ASC);

CREATE INDEX encrypted_comments_parent_index
  ON encrypted_comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

CREATE INDEX encrypted_comments_workspace_index
  ON encrypted_comments (workspace_id);
