import type { Database } from "../database/database.js";
import type { EmailVerificationRepository } from "./email-verification.js";

export interface StoredUser {
  createdAt: Date;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  passwordHash: string;
}

export interface CreateUserInput {
  email: string;
  id: string;
  passwordHash: string;
}

export interface CreateSessionInput {
  expiresAt: Date;
  id: string;
  tokenHash: string;
  userId: string;
}

export interface AuthRepository {
  createSession(input: CreateSessionInput): Promise<void>;
  createUser(input: CreateUserInput): Promise<StoredUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserBySessionTokenHash(tokenHash: string): Promise<StoredUser | null>;
}

interface UserRow {
  created_at: Date;
  email: string;
  email_verified_at: Date | null;
  id: string;
  password_hash: string;
}

function mapUser(row: UserRow): StoredUser {
  return {
    createdAt: row.created_at,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    id: row.id,
    passwordHash: row.password_hash
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export class PostgresAuthRepository implements AuthRepository, EmailVerificationRepository {
  public constructor(private readonly database: Database) {}

  public async createUser(input: CreateUserInput): Promise<StoredUser | null> {
    try {
      const result = await this.database.query<UserRow>(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, email_verified_at, password_hash, created_at`,
        [input.id, input.email, input.passwordHash]
      );

      const user = result.rows[0];
      return user ? mapUser(user) : null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }

      throw error;
    }
  }

  public async findUserByEmail(email: string): Promise<StoredUser | null> {
    const result = await this.database.query<UserRow>(
      `SELECT id, email, email_verified_at, password_hash, created_at
       FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email]
    );

    const user = result.rows[0];
    return user ? mapUser(user) : null;
  }

  public async createSession(input: CreateSessionInput): Promise<void> {
    await this.database.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.userId, input.tokenHash, input.expiresAt]
    );
  }

  public async findUserBySessionTokenHash(tokenHash: string): Promise<StoredUser | null> {
    const result = await this.database.query<UserRow>(
      `SELECT users.id, users.email, users.email_verified_at, users.password_hash, users.created_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()
       LIMIT 1`,
      [tokenHash]
    );

    const user = result.rows[0];
    return user ? mapUser(user) : null;
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.database.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  public async replaceAccountEmailVerification(input: {
    email: string;
    expiresAt: Date;
    id: string;
    tokenHash: string;
    userId: string;
  }): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const user = await database.query(
        `SELECT id FROM users
         WHERE id = $1 AND normalized_email = lower($2) AND email_verified_at IS NULL
         FOR UPDATE`,
        [input.userId, input.email]
      );
      if (user.rowCount !== 1) return false;
      await database.query(
        "DELETE FROM email_verification_challenges WHERE kind = 'account' AND account_id = $1",
        [input.userId]
      );
      await database.query(
        `INSERT INTO email_verification_challenges
           (id, kind, account_id, normalized_email, token_hash, expires_at)
         VALUES ($1, 'account', $2, lower($3), $4, $5)`,
        [input.id, input.userId, input.email, input.tokenHash, input.expiresAt]
      );
      return true;
    });
  }

  public async replacePendingEmailReclaim(input: {
    email: string;
    expiresAt: Date;
    id: string;
    passwordHash: string;
    replacementUserId: string;
    tokenHash: string;
  }): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const claimed = await database.query<{ email_verified_at: Date | null }>(
        `SELECT email_verified_at FROM users
         WHERE normalized_email = lower($1)
         FOR UPDATE`,
        [input.email]
      );
      if (!claimed.rows[0] || claimed.rows[0].email_verified_at !== null) return false;
      await database.query(
        "DELETE FROM email_verification_challenges WHERE kind = 'reclaim' AND normalized_email = lower($1)",
        [input.email]
      );
      await database.query(
        `INSERT INTO email_verification_challenges
           (id, kind, account_id, normalized_email, token_hash, replacement_password_hash, expires_at)
         VALUES ($1, 'reclaim', $2, lower($3), $4, $5, $6)`,
        [
          input.id,
          input.replacementUserId,
          input.email,
          input.tokenHash,
          input.passwordHash,
          input.expiresAt
        ]
      );
      return true;
    });
  }

  public async consumeEmailVerification(
    tokenHash: string,
    verifiedAt: Date
  ): Promise<StoredUser | null> {
    return this.database.transaction(async (database) => {
      type ChallengeRow = {
        account_id: string;
        expires_at: Date;
        kind: "account" | "reclaim";
        normalized_email: string;
        replacement_password_hash: string | null;
      };
      const candidate = await database.query<ChallengeRow>(
        `SELECT account_id, kind, normalized_email, replacement_password_hash, expires_at
         FROM email_verification_challenges
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
      const candidateRow = candidate.rows[0];
      if (!candidateRow) return null;

      // Issuance locks users before challenges. Consumption first and then taking the same order
      // here prevents a confirm/resend race from deadlocking in PostgreSQL.
      await database.query(
        candidateRow.kind === "account"
          ? "SELECT id FROM users WHERE id = $1 FOR UPDATE"
          : "SELECT id FROM users WHERE normalized_email = $1 FOR UPDATE",
        [candidateRow.kind === "account" ? candidateRow.account_id : candidateRow.normalized_email]
      );
      const challenge = await database.query<ChallengeRow>(
        `SELECT account_id, kind, normalized_email, replacement_password_hash, expires_at
         FROM email_verification_challenges
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );
      const row = challenge.rows[0];
      if (!row || row.expires_at <= verifiedAt) {
        if (row) {
          await database.query("DELETE FROM email_verification_challenges WHERE token_hash = $1", [tokenHash]);
        }
        return null;
      }

      let result;
      if (row.kind === "account") {
        result = await database.query<UserRow>(
          `UPDATE users SET email_verified_at = $3, updated_at = $3
           WHERE id = $1 AND normalized_email = $2 AND email_verified_at IS NULL
           RETURNING id, email, email_verified_at, password_hash, created_at`,
          [row.account_id, row.normalized_email, verifiedAt]
        );
      } else {
        const currentClaim = await database.query<{ email_verified_at: Date | null; id: string }>(
          "SELECT id, email_verified_at FROM users WHERE normalized_email = $1",
          [row.normalized_email]
        );
        const current = currentClaim.rows[0];
        if (current?.email_verified_at) {
          await database.query("DELETE FROM email_verification_challenges WHERE token_hash = $1", [tokenHash]);
          return null;
        }
        if (current) {
          await database.query(
            `UPDATE users
             SET email = 'reclaimed-' || id::text || '@invalid.example', updated_at = $2
             WHERE id = $1`,
            [current.id, verifiedAt]
          );
        }
        result = await database.query<UserRow>(
          `INSERT INTO users (id, email, password_hash, email_verified_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, email_verified_at, password_hash, created_at`,
          [row.account_id, row.normalized_email, row.replacement_password_hash, verifiedAt]
        );
      }

      const user = result.rows[0];
      if (!user) return null;
      await database.query(
        "DELETE FROM email_verification_challenges WHERE normalized_email = $1",
        [row.normalized_email]
      );
      return mapUser(user);
    });
  }

  public async findEmailVerificationPasswordHash(tokenHash: string): Promise<string | null> {
    const result = await this.database.query<{ password_hash: string }>(
      `SELECT CASE
          WHEN challenges.kind = 'account' THEN users.password_hash
          ELSE challenges.replacement_password_hash
        END AS password_hash
       FROM email_verification_challenges challenges
       LEFT JOIN users ON users.id = challenges.account_id AND challenges.kind = 'account'
       WHERE challenges.token_hash = $1 AND challenges.expires_at > now()
       LIMIT 1`,
      [tokenHash]
    );
    return result.rows[0]?.password_hash ?? null;
  }
}
