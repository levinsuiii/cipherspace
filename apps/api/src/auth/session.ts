import { createHmac, randomBytes } from "node:crypto";

export const sessionCookieName = "cipherspace_session";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(token).digest("hex");
}
