CREATE TABLE user_crypto_identities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version smallint NOT NULL,
  public_key text NOT NULL,
  algorithm text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key_version),
  CONSTRAINT user_crypto_identities_key_version_positive CHECK (key_version > 0),
  CONSTRAINT user_crypto_identities_public_key_not_blank CHECK (btrim(public_key) <> ''),
  CONSTRAINT user_crypto_identities_algorithm_valid
    CHECK (algorithm = 'RSA-OAEP-3072-SHA256')
);

CREATE INDEX user_crypto_identities_current_index
  ON user_crypto_identities (user_id, key_version DESC);

CREATE TABLE workspace_key_shares (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_workspace_key text NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  sender_key_version smallint NOT NULL,
  recipient_key_version smallint NOT NULL,
  algorithm text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (workspace_id, user_id),
  CONSTRAINT workspace_key_shares_ciphertext_not_blank
    CHECK (btrim(encrypted_workspace_key) <> ''),
  CONSTRAINT workspace_key_shares_sender_key_version_positive
    CHECK (sender_key_version > 0),
  CONSTRAINT workspace_key_shares_recipient_key_version_positive
    CHECK (recipient_key_version > 0),
  CONSTRAINT workspace_key_shares_algorithm_valid
    CHECK (algorithm = 'RSA-OAEP-3072-SHA256'),
  CONSTRAINT workspace_key_shares_sender_identity_fk
    FOREIGN KEY (sender_user_id, sender_key_version)
    REFERENCES user_crypto_identities (user_id, key_version),
  CONSTRAINT workspace_key_shares_recipient_identity_fk
    FOREIGN KEY (user_id, recipient_key_version)
    REFERENCES user_crypto_identities (user_id, key_version)
);

CREATE INDEX workspace_key_shares_recipient_index
  ON workspace_key_shares (user_id, workspace_id)
  WHERE revoked_at IS NULL;
