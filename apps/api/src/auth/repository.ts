import type { Database } from "../database/database.js";

export interface StoredUser {
  createdAt: Date;
  email: string;
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
  id: string;
  password_hash: string;
}

function mapUser(row: UserRow): StoredUser {
  return {
    createdAt: row.created_at,
    email: row.email,
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

export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly database: Database) {}

  public async createUser(input: CreateUserInput): Promise<StoredUser | null> {
    try {
      const result = await this.database.query<UserRow>(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, password_hash, created_at`,
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
      `SELECT id, email, password_hash, created_at
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
      `SELECT users.id, users.email, users.password_hash, users.created_at
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
}
