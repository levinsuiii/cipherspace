import { describe, expect, it } from "vitest";

import {
  decryptCommentContent,
  decryptNoteContent,
  encryptCommentContent,
  generateWorkspaceKey,
  type EncryptedCommentPayload
} from "../src/index.js";

const commentContext = {
  authorId: "20000000-0000-4000-8000-000000000001",
  commentId: "40000000-0000-4000-8000-000000000001",
  noteId: "30000000-0000-4000-8000-000000000001",
  parentCommentId: null,
  workspaceId: "10000000-0000-4000-8000-000000000001"
};

describe("encrypted comment content", () => {
  it("round-trips Unicode content and generates a fresh nonce", async () => {
    const key = await generateWorkspaceKey();
    const first = await encryptCommentContent("Review this paragraph 🔐", key, commentContext);
    const second = await encryptCommentContent("Review this paragraph 🔐", key, commentContext);

    expect(await decryptCommentContent(first, key, commentContext)).toBe("Review this paragraph 🔐");
    expect(first.envelopeVersion).toBe(2);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("authenticates comments separately from note envelopes", async () => {
    const key = await generateWorkspaceKey();
    const comment = await encryptCommentContent("context-bound comment", key, commentContext);

    await expect(decryptNoteContent(comment, key, {
      localRevision: 1,
      noteId: commentContext.noteId,
      workspaceId: commentContext.workspaceId
    })).rejects.toMatchObject({
      code: "decryption_failed"
    });
  });

  it.each([
    ["workspace", { ...commentContext, workspaceId: "10000000-0000-4000-8000-000000000002" }],
    ["note", { ...commentContext, noteId: "30000000-0000-4000-8000-000000000002" }],
    ["comment", { ...commentContext, commentId: "40000000-0000-4000-8000-000000000002" }],
    ["author", { ...commentContext, authorId: "20000000-0000-4000-8000-000000000002" }],
    [
      "parent thread",
      { ...commentContext, parentCommentId: "40000000-0000-4000-8000-000000000003" }
    ]
  ])("rejects a comment envelope moved to different %s metadata", async (_field, swappedContext) => {
    const key = await generateWorkspaceKey();
    const payload = await encryptCommentContent("bound comment", key, commentContext);

    await expect(decryptCommentContent(payload, key, swappedContext)).rejects.toMatchObject({
      code: "decryption_failed"
    });
  });

  it("requires metadata to decrypt a version 2 comment envelope", async () => {
    const key = await generateWorkspaceKey();
    const payload = await encryptCommentContent("bound comment", key, commentContext);

    await expect(decryptCommentContent(payload, key)).rejects.toMatchObject({
      code: "invalid_payload"
    });
  });

  it("still decrypts a legacy version 1 comment envelope", async () => {
    const key = await generateWorkspaceKey();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        additionalData: new TextEncoder().encode("cipherspace.comment|1|AES-GCM|1"),
        iv: nonce,
        name: "AES-GCM",
        tagLength: 128
      },
      key,
      new TextEncoder().encode("legacy comment")
    );
    const legacyPayload: EncryptedCommentPayload = {
      algorithm: "AES-GCM",
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: btoa(String.fromCharCode(...nonce))
    };

    await expect(decryptCommentContent(legacyPayload, key)).resolves.toBe("legacy comment");
  });
});
