import type { Database } from "../database/database.js";

export const userIdentityAlgorithm = "RSA-OAEP-3072-SHA256" as const;
export const userSigningAlgorithm = "ECDSA-P256-SHA256" as const;

export interface StoredIdentityBundle {
  bundleHash: string;
  bundleSequence: number;
  bundleVersion: 1;
  createdAt: string;
  encryptionKey: {
    algorithm: typeof userIdentityAlgorithm;
    fingerprint: string;
    keyVersion: number;
    publicKey: string;
  };
  previousBundleHash: string | null;
  signature: { algorithm: typeof userSigningAlgorithm; value: string };
  signingKey: {
    algorithm: typeof userSigningAlgorithm;
    fingerprint: string;
    keyVersion: number;
    publicKey: string;
  };
  userId: string;
}

export type StoredUserCryptoIdentity = StoredIdentityBundle;

export type RegisterIdentityResult =
  | { identity: StoredIdentityBundle; status: "created" | "unchanged" }
  | { status: "version_conflict" | "version_out_of_sequence" };

export interface IdentityRepository {
  findBySequence(userId: string, bundleSequence: number): Promise<StoredIdentityBundle | null>;
  findCurrent(userId: string): Promise<StoredIdentityBundle | null>;
  register(bundle: StoredIdentityBundle): Promise<RegisterIdentityResult>;
}

interface IdentityBundleRow {
  bundle: StoredIdentityBundle;
  bundle_hash: string;
  bundle_sequence: number;
  user_id: string;
}

interface LegacyIdentityRow {
  algorithm: typeof userIdentityAlgorithm;
  key_version: number;
  public_key: string;
}

function mapBundle(row: IdentityBundleRow): StoredIdentityBundle {
  return row.bundle;
}

export class PostgresIdentityRepository implements IdentityRepository {
  public constructor(private readonly database: Database) {}

  public async findBySequence(userId: string, bundleSequence: number): Promise<StoredIdentityBundle | null> {
    const result = await this.database.query<IdentityBundleRow>(
      `SELECT user_id, bundle_sequence, bundle_hash, bundle
       FROM user_identity_bundles
       WHERE user_id = $1 AND bundle_sequence = $2`,
      [userId, bundleSequence]
    );
    const row = result.rows[0];
    return row ? mapBundle(row) : null;
  }

  public async findCurrent(userId: string): Promise<StoredIdentityBundle | null> {
    const result = await this.database.query<IdentityBundleRow>(
      `SELECT user_id, bundle_sequence, bundle_hash, bundle
       FROM user_identity_bundles
       WHERE user_id = $1
       ORDER BY bundle_sequence DESC
       LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? mapBundle(row) : null;
  }

  public async register(bundle: StoredIdentityBundle): Promise<RegisterIdentityResult> {
    return this.database.transaction(async (database) => {
      await database.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [bundle.userId]);
      const currentResult = await database.query<IdentityBundleRow>(
        `SELECT user_id, bundle_sequence, bundle_hash, bundle
         FROM user_identity_bundles
         WHERE user_id = $1
         ORDER BY bundle_sequence DESC
         LIMIT 1`,
        [bundle.userId]
      );
      const current = currentResult.rows[0];
      if (current && bundle.bundleSequence === current.bundle_sequence) {
        return bundle.bundleHash === current.bundle_hash
          ? { identity: mapBundle(current), status: "unchanged" }
          : { status: "version_conflict" };
      }
      if (
        bundle.bundleSequence !== (current?.bundle_sequence ?? 0) + 1 ||
        bundle.previousBundleHash !== (current?.bundle_hash ?? null) ||
        (current && bundle.encryptionKey.keyVersion === current.bundle.encryptionKey.keyVersion &&
          bundle.encryptionKey.fingerprint !== current.bundle.encryptionKey.fingerprint) ||
        (current && bundle.encryptionKey.keyVersion !== current.bundle.encryptionKey.keyVersion &&
          bundle.encryptionKey.keyVersion !== current.bundle.encryptionKey.keyVersion + 1)
      ) {
        return { status: "version_out_of_sequence" };
      }
      await database.query(
        `INSERT INTO user_crypto_identities (user_id, public_key, algorithm, key_version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key_version) DO NOTHING`,
        [bundle.userId, bundle.encryptionKey.publicKey, bundle.encryptionKey.algorithm, bundle.encryptionKey.keyVersion]
      );
      const legacyResult = await database.query<LegacyIdentityRow>(
        `SELECT public_key, algorithm, key_version
         FROM user_crypto_identities
         WHERE user_id = $1 AND key_version = $2`,
        [bundle.userId, bundle.encryptionKey.keyVersion]
      );
      const legacy = legacyResult.rows[0];
      if (
        !legacy || legacy.public_key !== bundle.encryptionKey.publicKey ||
        legacy.algorithm !== bundle.encryptionKey.algorithm ||
        legacy.key_version !== bundle.encryptionKey.keyVersion
      ) {
        return { status: "version_conflict" };
      }
      const created = await database.query<IdentityBundleRow>(
        `INSERT INTO user_identity_bundles
           (user_id, bundle_sequence, bundle_hash, previous_bundle_hash,
            signing_key_fingerprint, encryption_key_fingerprint, encryption_key_version, bundle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING user_id, bundle_sequence, bundle_hash, bundle`,
        [
          bundle.userId,
          bundle.bundleSequence,
          bundle.bundleHash,
          bundle.previousBundleHash,
          bundle.signingKey.fingerprint,
          bundle.encryptionKey.fingerprint,
          bundle.encryptionKey.keyVersion,
          JSON.stringify(bundle)
        ]
      );
      const row = created.rows[0];
      if (!row) throw new Error("Identity bundle registration did not return a record");
      return { identity: mapBundle(row), status: "created" };
    });
  }
}
