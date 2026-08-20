import { encryptNoteContent, generateWorkspaceKey } from "@cipherspace/crypto";
import { describe, expect, it } from "vitest";

import type { LocalNoteVersion } from "../local-storage/types";
import { decryptCachedNoteVersion } from "./crypto";

describe("conflict snapshot crypto", () => {
  it("decrypts and validates a cached remote note document", async () => {
    const key = await generateWorkspaceKey();
    const encrypted = await encryptNoteContent(
      JSON.stringify({ body: "Remote body", title: "Remote title" }),
      key
    );
    const version: LocalNoteVersion = {
      client_version: "2",
      content_nonce: encrypted.nonce,
      created_at: "2026-08-20T10:02:00.000Z",
      created_by: "00000000-0000-4000-8000-000000000003",
      encrypted_content: encrypted.ciphertext,
      encryption_algorithm: encrypted.algorithm,
      envelope_version: encrypted.envelopeVersion,
      id: "50000000-0000-4000-8000-000000000002",
      key: "user:version",
      key_id: "workspace-key-v1",
      note_id: "30000000-0000-4000-8000-000000000001",
      parent_version_id: "50000000-0000-4000-8000-000000000001",
      user_id: "00000000-0000-4000-8000-000000000001",
      version_number: 2,
      workspace_id: "10000000-0000-4000-8000-000000000001"
    };

    await expect(decryptCachedNoteVersion(version, key)).resolves.toEqual({
      body: "Remote body",
      title: "Remote title"
    });
  });
});
