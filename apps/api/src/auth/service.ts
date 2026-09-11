import { randomUUID } from "node:crypto";

import { hashPassword, verifyPassword } from "./password.js";
import {
  createEmailVerificationChallenge,
  hashEmailVerificationToken,
  type EmailVerificationDelivery,
  type EmailVerificationRepository
} from "./email-verification.js";
import type { AuthRepository, StoredUser } from "./repository.js";
import { createSessionToken, hashSessionToken } from "./session.js";

export interface AuthenticatedUser {
  createdAt: string;
  email: string;
  emailVerifiedAt: string | null;
  id: string;
}

export interface AuthenticatedSession {
  expiresAt: Date;
  token: string;
  user: AuthenticatedUser;
}

export class InvalidCredentialsError extends Error {}
export class InvalidEmailVerificationError extends Error {}

function publicUser(user: StoredUser): AuthenticatedUser {
  return {
    createdAt: user.createdAt.toISOString(),
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
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
    private readonly sessionTtlHours: number,
    private readonly emailVerificationRepository: EmailVerificationRepository,
    private readonly emailVerificationDelivery: EmailVerificationDelivery,
    private readonly emailVerificationTtlMinutes: number
  ) {}

  public async register(email: string, password: string): Promise<AuthenticatedSession | null> {
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const user = await this.repository.createUser({
      email,
      id: userId,
      passwordHash
    });

    if (!user) {
      const challenge = createEmailVerificationChallenge(
        email,
        this.emailVerificationTtlMinutes,
        new Date()
      );
      const reclaimCreated = await this.emailVerificationRepository.replacePendingEmailReclaim({
        email,
        expiresAt: challenge.expiresAt,
        id: challenge.id,
        passwordHash,
        replacementUserId: userId,
        tokenHash: challenge.tokenHash
      });
      if (reclaimCreated) {
        await this.emailVerificationDelivery.sendVerification(challenge);
      }
      return null;
    }

    await this.issueEmailVerification(user.id, user.email);
    return this.createSession(user);
  }

  public async requestEmailVerification(userId: string, email: string): Promise<void> {
    await this.issueEmailVerification(userId, email);
  }

  public async confirmEmailVerification(token: string, password: string): Promise<AuthenticatedUser> {
    const tokenHash = hashEmailVerificationToken(token);
    const expectedPasswordHash = await this.emailVerificationRepository
      .findEmailVerificationPasswordHash(tokenHash);
    if (!expectedPasswordHash || !(await verifyPassword(expectedPasswordHash, password))) {
      throw new InvalidEmailVerificationError();
    }
    const user = await this.emailVerificationRepository.consumeEmailVerification(
      tokenHash,
      new Date()
    );
    if (!user) throw new InvalidEmailVerificationError();
    return publicUser(user);
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

  private async issueEmailVerification(userId: string, email: string): Promise<void> {
    const challenge = createEmailVerificationChallenge(
      email,
      this.emailVerificationTtlMinutes,
      new Date()
    );
    const created = await this.emailVerificationRepository.replaceAccountEmailVerification({
      email,
      expiresAt: challenge.expiresAt,
      id: challenge.id,
      tokenHash: challenge.tokenHash,
      userId
    });
    if (created) {
      await this.emailVerificationDelivery.sendVerification(challenge);
    }
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
