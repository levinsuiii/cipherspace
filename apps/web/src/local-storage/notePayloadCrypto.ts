import {
  decryptNoteContent,
  encryptNoteContent,
  type EncryptedNotePayload
} from "@cipherspace/crypto";

import type { LocalNotePayload, LocalNoteVersion } from "./types";

function parseNotePayload(plaintext: string): LocalNotePayload {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("The decrypted content is not a valid note document.");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "body,title" ||
    typeof (value as Record<string, unknown>).body !== "string" ||
    typeof (value as Record<string, unknown>).title !== "string"
  ) {
    throw new Error("The decrypted content has an invalid note document shape.");
  }

  return {
    body: (value as { body: string }).body,
    title: (value as { title: string }).title
  };
}

export async function encryptLocalNotePayload(
  payload: LocalNotePayload,
  workspaceKey: CryptoKey
): Promise<EncryptedNotePayload> {
  return encryptNoteContent(
    JSON.stringify({ body: payload.body, title: payload.title }),
    workspaceKey
  );
}

export async function decryptLocalNotePayload(
  payload: EncryptedNotePayload,
  workspaceKey: CryptoKey
): Promise<LocalNotePayload> {
  return parseNotePayload(await decryptNoteContent(payload, workspaceKey));
}

export async function decryptCachedNoteVersionPayload(
  version: LocalNoteVersion,
  workspaceKey: CryptoKey
): Promise<LocalNotePayload> {
  if (
    version.encryption_algorithm !== "AES-GCM" ||
    version.envelope_version !== 1 ||
    version.key_id !== "workspace-key-v1"
  ) {
    throw new Error("The cached server version uses unsupported encryption metadata.");
  }

  return decryptLocalNotePayload(
    {
      algorithm: "AES-GCM",
      ciphertext: version.encrypted_content,
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: version.content_nonce
    },
    workspaceKey
  );
}
