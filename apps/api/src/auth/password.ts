import argon2 from "argon2";

const argon2idOptions = {
  hashLength: 32,
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, argon2idOptions);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
