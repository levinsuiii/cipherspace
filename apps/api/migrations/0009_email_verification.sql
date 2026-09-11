ALTER TABLE users
  ADD COLUMN normalized_email text GENERATED ALWAYS AS (lower(email)) STORED,
  ADD COLUMN email_verified_at timestamptz;

DROP INDEX users_email_normalized_unique;
CREATE UNIQUE INDEX users_normalized_email_unique ON users (normalized_email);

CREATE TABLE email_verification_challenges (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  account_id uuid NOT NULL,
  normalized_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  replacement_password_hash text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_verification_challenges_kind_valid CHECK (kind IN ('account', 'reclaim')),
  CONSTRAINT email_verification_challenges_email_normalized
    CHECK (normalized_email = lower(normalized_email) AND btrim(normalized_email) <> ''),
  CONSTRAINT email_verification_challenges_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_verification_challenges_reclaim_password CHECK (
    (kind = 'account' AND replacement_password_hash IS NULL)
    OR (
      kind = 'reclaim'
      AND replacement_password_hash IS NOT NULL
      AND btrim(replacement_password_hash) <> ''
    )
  ),
  CONSTRAINT email_verification_challenges_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX email_verification_challenges_account_index
  ON email_verification_challenges (account_id, kind);
CREATE INDEX email_verification_challenges_email_index
  ON email_verification_challenges (normalized_email, kind);
CREATE INDEX email_verification_challenges_expiry_index
  ON email_verification_challenges (expires_at);

-- Existing accounts intentionally remain unverified. Historical registration did not prove
-- mailbox control, so users must complete the new verification flow after deployment.
