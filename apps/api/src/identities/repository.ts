import type { Database } from "../database/database.js";

export const userIdentityAlgorithm = "RSA-OAEP-3072-SHA256" as const;

export interface StoredUserCryptoIdentity {
  algorithm: typeof userIdentityAlgorithm;
  createdAt: Date;
  keyVersion: number;
  publicKey: string;
  updatedAt: Date;
  userId: string;
}

export type RegisterIdentityResult =
  | { identity: StoredUserCryptoIdentity; status: "created" | "unchanged" }
  | { status: "version_conflict" | "version_out_of_sequence" };

export interface IdentityRepository {
  findCurrent(userId: string): Promise<StoredUserCryptoIdentity | null>;
  register(input: {
    algorithm: typeof userIdentityAlgorithm;
    keyVersion: number;
    publicKey: string;
    userId: string;
  }): Promise<RegisterIdentityResult>;
}

interface IdentityRow {
  algorithm: typeof userIdentityAlgorithm;
  created_at: Date;
  key_version: number;
  public_key: string;
  updated_at: Date;
  user_id: string;
}

function mapIdentity(row: IdentityRow): StoredUserCryptoIdentity {
  return {
    algorithm: row.algorithm,
    createdAt: row.created_at,
    keyVersion: row.key_version,
    publicKey: row.public_key,
    updatedAt: row.updated_at,
    userId: row.user_id
  };
}

export class PostgresIdentityRepository implements IdentityRepository {
  public constructor(private readonly database: Database) {}

  public async findCurrent(userId: string): Promise<StoredUserCryptoIdentity | null> {
    const result = await this.database.query<IdentityRow>(
      `SELECT user_id, public_key, algorithm, key_version, created_at, updated_at
       FROM user_crypto_identities
       WHERE user_id = $1
       ORDER BY key_version DESC
       LIMIT 1`,
      [userId]
    );
    const identity = result.rows[0];
    return identity ? mapIdentity(identity) : null;
  }

  public async register(input: {
    algorithm: typeof userIdentityAlgorithm;
    keyVersion: number;
    publicKey: string;
    userId: string;
  }): Promise<RegisterIdentityResult> {
    return this.database.transaction(async (database) => {
      await database.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [input.userId]);
      const currentResult = await database.query<IdentityRow>(
        `SELECT user_id, public_key, algorithm, key_version, created_at, updated_at
         FROM user_crypto_identities
         WHERE user_id = $1
         ORDER BY key_version DESC
         LIMIT 1`,
        [input.userId]
      );
      const current = currentResult.rows[0];
      if (current && input.keyVersion === current.key_version) {
        if (current.public_key !== input.publicKey || current.algorithm !== input.algorithm) {
          return { status: "version_conflict" };
        }
        return { identity: mapIdentity(current), status: "unchanged" };
      }
      if (input.keyVersion !== (current?.key_version ?? 0) + 1) {
        return { status: "version_out_of_sequence" };
      }
      const created = await database.query<IdentityRow>(
        `INSERT INTO user_crypto_identities
           (user_id, public_key, algorithm, key_version)
         VALUES ($1, $2, $3, $4)
         RETURNING user_id, public_key, algorithm, key_version, created_at, updated_at`,
        [input.userId, input.publicKey, input.algorithm, input.keyVersion]
      );
      const identity = created.rows[0];
      if (!identity) throw new Error("Identity registration did not return a record");
      return { identity: mapIdentity(identity), status: "created" };
    });
  }
}
