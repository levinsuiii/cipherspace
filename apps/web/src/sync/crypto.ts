import {
  decryptNoteContent,
  encryptNoteContent,
  type EncryptedNotePayload
} from "@cipherspace/crypto";

import type {
  LocalNotePayload,
  LocalNoteVersion,
  PendingChange
} from "../local-storage/types";

export async function encryptPendingNoteChange(
  change: PendingChange,
  workspaceKey: CryptoKey
): Promise<EncryptedNotePayload> {
  if (change.operation_type === "delete_note" || !change.local_note_payload) {
    throw new Error("Only note creates and updates have encryptable local payloads.");
  }
  return encryptNoteContent(
    JSON.stringify({
      body: change.local_note_payload.body,
      title: change.local_note_payload.title
    }),
    workspaceKey
  );
}

export async function decryptCachedNoteVersion(
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

  const plaintext = await decryptNoteContent(
    {
      algorithm: "AES-GCM",
      ciphertext: version.encrypted_content,
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: version.content_nonce
    },
    workspaceKey
  );

  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("The decrypted server version is not a valid note document.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "body,title" ||
    typeof (value as Record<string, unknown>).body !== "string" ||
    typeof (value as Record<string, unknown>).title !== "string"
  ) {
    throw new Error("The decrypted server version has an invalid note document shape.");
  }

  return {
    body: (value as { body: string }).body,
    title: (value as { title: string }).title
  };
}
