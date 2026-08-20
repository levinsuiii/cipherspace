import { encryptNoteContent, type EncryptedNotePayload } from "@cipherspace/crypto";

import type { PendingChange } from "../local-storage/types";

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
