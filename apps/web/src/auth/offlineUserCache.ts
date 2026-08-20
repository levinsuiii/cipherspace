import type { User } from "../api/types";

const storageKey = "cipherspace:offline-user";

export function cacheOfflineUser(user: User): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(user));
  } catch {
    // Authentication must still work when browser storage is disabled or unavailable.
  }
}

export function clearOfflineUser(): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // There is no cached profile to clear when browser storage is unavailable.
  }
}

export function readOfflineUser(): User | null {
  let stored: string | null;
  try {
    stored = localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (!stored) return null;

  try {
    const value = JSON.parse(stored) as Partial<User>;
    if (
      typeof value.id !== "string" ||
      typeof value.email !== "string" ||
      typeof value.createdAt !== "string"
    ) {
      clearOfflineUser();
      return null;
    }
    return { createdAt: value.createdAt, email: value.email, id: value.id };
  } catch {
    clearOfflineUser();
    return null;
  }
}
