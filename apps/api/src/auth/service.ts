import { randomUUID } from "node:crypto";

import { hashPassword, verifyPassword } from "./password.js";
import type { AuthRepository, StoredUser } from "./repository.js";
import { createSessionToken, hashSessionToken } from "./session.js";

export interface AuthenticatedUser {
  createdAt: string;
  email: string;
  id: string;
}

export interface AuthenticatedSession {
  expiresAt: Date;
  token: string;
  user: AuthenticatedUser;
}

export class DuplicateAccountError extends Error {}
export class InvalidCredentialsError extends Error {}

function publicUser(user: StoredUser): AuthenticatedUser {
  return {
    createdAt: user.createdAt.toISOString(),
    email: user.email,
    id: user.id
  };
}

let dummyPasswordHash: Promise<string> | undefined;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword("not-a-real-user-password");
  return dummyPasswordHash;
}

export class AuthService {
  public constructor(
    private readonly repository: AuthRepository,
    private readonly sessionSecret: string,
    private readonly sessionTtlHours: number
  ) {}

  public async register(email: string, password: string): Promise<AuthenticatedSession> {
    const passwordHash = await hashPassword(password);
    const user = await this.repository.createUser({
      email,
      id: randomUUID(),
      passwordHash
    });

    if (!user) {
      throw new DuplicateAccountError();
    }

    return this.createSession(user);
  }

  public async login(email: string, password: string): Promise<AuthenticatedSession> {
    const user = await this.repository.findUserByEmail(email);
    const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash());
    const passwordIsValid = await verifyPassword(passwordHash, password);

    if (!user || !passwordIsValid) {
      throw new InvalidCredentialsError();
    }

    return this.createSession(user);
  }

  public async authenticate(token: string): Promise<AuthenticatedUser | null> {
    const tokenHash = hashSessionToken(token, this.sessionSecret);
    const user = await this.repository.findUserBySessionTokenHash(tokenHash);
    return user ? publicUser(user) : null;
  }

  public async logout(token: string): Promise<void> {
    await this.repository.deleteSession(hashSessionToken(token, this.sessionSecret));
  }

  private async createSession(user: StoredUser): Promise<AuthenticatedSession> {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1_000);

    await this.repository.createSession({
      expiresAt,
      id: randomUUID(),
      tokenHash: hashSessionToken(token, this.sessionSecret),
      userId: user.id
    });

    return { expiresAt, token, user: publicUser(user) };
  }
}
