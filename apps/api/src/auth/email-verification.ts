import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { StoredUser } from "./repository.js";

export const emailVerificationTokenBytes = 32;

export interface EmailVerificationDeliveryMessage {
  email: string;
  expiresAt: Date;
  token: string;
}

export interface EmailVerificationDelivery {
  sendVerification(message: EmailVerificationDeliveryMessage): Promise<void>;
}

export class DisabledEmailVerificationDelivery implements EmailVerificationDelivery {
  public async sendVerification(_message: EmailVerificationDeliveryMessage): Promise<void> {
    // Intentionally does not log or otherwise expose the bearer token. Deployments must replace
    // this adapter with a provider-backed implementation before enabling real user registration.
  }
}

type ResendFetch = typeof fetch;

export class ResendEmailVerificationDelivery implements EmailVerificationDelivery {
  public constructor(
    private readonly apiKey: string,
    private readonly emailFrom: string,
    private readonly webAppUrl: string,
    private readonly resendFetch: ResendFetch = fetch
  ) {}

  public async sendVerification(message: EmailVerificationDeliveryMessage): Promise<void> {
    const verificationUrl = new URL("/verify-email", this.webAppUrl);
    verificationUrl.hash = new URLSearchParams({ token: message.token }).toString();
    const verificationUrlText = verificationUrl.toString();
    const response = await this.resendFetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: this.emailFrom,
        html: `<p>Best\u00e4tige deine E-Mail-Adresse f\u00fcr CipherSpace:</p><p><a href="${verificationUrlText}">E-Mail-Adresse best\u00e4tigen</a></p><p>Dieser Link ist bis ${message.expiresAt.toISOString()} g\u00fcltig.</p>`,
        subject: "CipherSpace E-Mail-Adresse best\u00e4tigen",
        text: `Best\u00e4tige deine E-Mail-Adresse f\u00fcr CipherSpace:\n\n${verificationUrlText}\n\nDieser Link ist bis ${message.expiresAt.toISOString()} g\u00fcltig.`,
        to: [message.email]
      }),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Email verification delivery failed");
    }
  }
}

export class InMemoryEmailVerificationDelivery implements EmailVerificationDelivery {
  public readonly messages: EmailVerificationDeliveryMessage[] = [];

  public constructor(nodeEnvironment: "development" | "test" | "production") {
    if (nodeEnvironment === "production") {
      throw new Error("The in-memory email verification delivery cannot run in production");
    }
  }

  public async sendVerification(message: EmailVerificationDeliveryMessage): Promise<void> {
    this.messages.push(message);
  }
}

export interface EmailVerificationRepository {
  consumeEmailVerification(tokenHash: string, verifiedAt: Date): Promise<StoredUser | null>;
  findEmailVerificationPasswordHash(tokenHash: string): Promise<string | null>;
  replaceAccountEmailVerification(input: {
    email: string;
    expiresAt: Date;
    id: string;
    tokenHash: string;
    userId: string;
  }): Promise<boolean>;
  replacePendingEmailReclaim(input: {
    email: string;
    expiresAt: Date;
    id: string;
    passwordHash: string;
    replacementUserId: string;
    tokenHash: string;
  }): Promise<boolean>;
}

export function createEmailVerificationToken(): string {
  return randomBytes(emailVerificationTokenBytes).toString("base64url");
}

export function hashEmailVerificationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createEmailVerificationChallenge(
  email: string,
  ttlMinutes: number,
  now: Date
) {
  const token = createEmailVerificationToken();
  return {
    email,
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
    id: randomUUID(),
    token,
    tokenHash: hashEmailVerificationToken(token)
  };
}
