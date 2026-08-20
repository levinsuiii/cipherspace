import type { EncryptedNotePayload } from "@cipherspace/crypto";

import {
  decryptCachedNoteVersionPayload,
  encryptLocalNotePayload
} from "../local-storage/notePayloadCrypto";
import type { LocalNotePayload, LocalNoteVersion, PendingChange } from "../local-storage/types";

export async function encryptPendingNoteChange(
  change: PendingChange,
  workspaceKey: CryptoKey
): Promise<EncryptedNotePayload> {
  if (change.encrypted_payload) return change.encrypted_payload;
  if (change.operation_type === "delete_note" || !change.local_note_payload) {
    throw new Error("Only note creates and updates have encryptable local payloads.");
  }
  return encryptLocalNotePayload(change.local_note_payload, workspaceKey);
}

export async function decryptCachedNoteVersion(
  version: LocalNoteVersion,
  workspaceKey: CryptoKey
): Promise<LocalNotePayload> {
  return decryptCachedNoteVersionPayload(version, workspaceKey);
}
