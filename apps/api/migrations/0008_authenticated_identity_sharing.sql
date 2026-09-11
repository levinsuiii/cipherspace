CREATE TABLE user_identity_bundles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bundle_sequence smallint NOT NULL,
  bundle_hash text NOT NULL,
  previous_bundle_hash text,
  signing_key_fingerprint text NOT NULL,
  encryption_key_fingerprint text NOT NULL,
  encryption_key_version smallint NOT NULL,
  bundle jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bundle_sequence),
  UNIQUE (user_id, bundle_hash),
  CONSTRAINT user_identity_bundles_sequence_positive CHECK (bundle_sequence > 0),
  CONSTRAINT user_identity_bundles_key_version_positive CHECK (encryption_key_version > 0),
  CONSTRAINT user_identity_bundles_hash_format CHECK (bundle_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_identity_bundles_previous_hash_format
    CHECK (previous_bundle_hash IS NULL OR previous_bundle_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_identity_bundles_signing_fingerprint_format
    CHECK (signing_key_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_identity_bundles_encryption_fingerprint_format
    CHECK (encryption_key_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX user_identity_bundles_current_index
  ON user_identity_bundles (user_id, bundle_sequence DESC);

CREATE INDEX user_identity_bundles_signing_fingerprint_index
  ON user_identity_bundles (signing_key_fingerprint);

CREATE INDEX user_identity_bundles_encryption_version_index
  ON user_identity_bundles (user_id, encryption_key_version);

ALTER TABLE workspace_key_shares
  ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN share_operation_id uuid,
  ADD COLUMN signed_share jsonb;

ALTER TABLE workspace_key_shares
  ADD CONSTRAINT workspace_key_shares_protocol_version_valid
    CHECK (protocol_version IN (1, 2)),
  ADD CONSTRAINT workspace_key_shares_v2_complete
    CHECK (
      (protocol_version = 1 AND share_operation_id IS NULL AND signed_share IS NULL)
      OR
      (protocol_version = 2 AND share_operation_id IS NOT NULL AND signed_share IS NOT NULL)
    ),
  ADD CONSTRAINT workspace_key_shares_operation_unique UNIQUE (share_operation_id);
