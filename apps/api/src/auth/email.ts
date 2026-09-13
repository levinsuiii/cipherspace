import { z } from "zod";

export const canonicalEmailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());

export function normalizeEmailAddress(value: string): string | null {
  const result = canonicalEmailSchema.safeParse(value);
  return result.success ? result.data : null;
}
